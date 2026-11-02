import { lookup as defaultLookup } from 'node:dns/promises';
import { z } from 'zod';
import type { Tool } from './registry.ts';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_CHARS = 8_000;
const MAX_TEXT_CHARS = 20_000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 5;
const USER_AGENT = 'JarvisAPI/0.1 (+https://github.com/swaraj2827p-pixel/jarvisai)';

interface AddressRecord {
  address: string;
  family: number;
}

type Lookup = (hostname: string) => Promise<AddressRecord[]>;

export interface FetchUrlToolOptions {
  fetchImpl?: typeof fetch;
  lookup?: Lookup;
  timeoutMs?: number;
  maxBytes?: number;
}

const argumentsSchema = z
  .object({
    url: z.string().trim().min(1).max(2048),
    maxChars: z.number().int().min(200).max(MAX_TEXT_CHARS).optional(),
  })
  .strict();

export function createFetchUrlTool(options: FetchUrlToolOptions = {}): Tool {
  const fetchImpl = options.fetchImpl ?? fetch;
  const lookup: Lookup =
    options.lookup ??
    (async (hostname) => defaultLookup(hostname, { all: true, verbatim: true }));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_BYTES;

  return {
    name: 'fetch_url',
    description:
      'Fetch a public web page, documentation page or JSON/text document over HTTP(S) and return readable text. ' +
      'Use it when the user shares a link or asks about information that may be on the web. ' +
      'Private, local and non-HTTP addresses are blocked.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Absolute http:// or https:// URL to read.',
        },
        maxChars: {
          type: 'integer',
          minimum: 200,
          maximum: MAX_TEXT_CHARS,
          description: 'Maximum characters of extracted text to return. Defaults to 8000.',
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
    async run(rawArguments) {
      const { url, maxChars = DEFAULT_MAX_CHARS } = argumentsSchema.parse(rawArguments);
      return fetchReadableText(url, maxChars, {
        fetchImpl,
        lookup,
        timeoutMs,
        maxBytes,
      });
    },
  };
}

interface FetchContext {
  fetchImpl: typeof fetch;
  lookup: Lookup;
  timeoutMs: number;
  maxBytes: number;
}

async function fetchReadableText(url: string, maxChars: number, context: FetchContext) {
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    throw new Error(`Invalid URL "${url}". Provide an absolute http:// or https:// URL.`);
  }

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    await assertPublicUrl(current, context.lookup);

    let response: Response;
    try {
      response = await context.fetchImpl(current, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5',
        },
        signal: AbortSignal.timeout(context.timeoutMs),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        throw new Error(`Request to ${current.href} timed out after ${context.timeoutMs} ms.`);
      }
      throw new Error(
        `Could not fetch ${current.href}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (isRedirect(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`Redirect from ${current.href} did not include a location.`);
      if (redirects === MAX_REDIRECTS) {
        throw new Error(`Too many redirects while fetching ${current.href}.`);
      }
      current = new URL(location, current);
      continue;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!isTextual(contentType)) {
      throw new Error(
        `Unsupported content type "${contentType || 'unknown'}" from ${current.href}.`,
      );
    }

    const body = await readLimitedText(response, context.maxBytes);
    const base = { url: current.href, status: response.status, contentType };

    if (/html|xml/i.test(contentType) || /<html[\s>]/i.test(body)) {
      const extracted = extractHtml(body);
      return { ...base, title: extracted.title, text: truncate(extracted.text, maxChars) };
    }

    return { ...base, text: truncate(body.trim(), maxChars) };
  }

  throw new Error(`Too many redirects while fetching ${current.href}.`);
}

async function assertPublicUrl(url: URL, lookup: Lookup): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported protocol "${url.protocol}". Only http:// and https:// are allowed.`);
  }
  if (url.username || url.password) {
    throw new Error('URLs with embedded credentials are not allowed.');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!hostname) throw new Error('URL has no hostname.');
  if (isBlockedHostname(hostname)) {
    throw new Error(`Refusing to fetch the private or local address "${hostname}".`);
  }

  if (!isIpLiteral(hostname)) {
    let records: AddressRecord[];
    try {
      records = await lookup(hostname);
    } catch {
      throw new Error(`Could not resolve the hostname "${hostname}".`);
    }
    if (records.length === 0) throw new Error(`The hostname "${hostname}" did not resolve.`);
    for (const record of records) {
      if (isBlockedAddress(record.address)) {
        throw new Error(`Refusing to fetch "${hostname}" because it resolves to a private address.`);
      }
    }
  } else if (isBlockedAddress(hostname)) {
    throw new Error(`Refusing to fetch the private or local address "${hostname}".`);
  }
}

function isBlockedHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.home.arpa') ||
    hostname.endsWith('.lan')
  );
}

function isIpLiteral(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
}

export function isBlockedAddress(address: string): boolean {
  const value = (address.split('%')[0] ?? '').trim().toLowerCase();
  if (!value) return true;
  if (value.includes(':')) return isBlockedIpv6(value);
  return isBlockedIpv4(value);
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split('.');
  if (parts.length !== 4) return true;
  const octets = parts.map(Number);
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;

  const [a, b, c] = octets;
  if (a === undefined || b === undefined || c === undefined) return true;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isBlockedIpv6(address: string): boolean {
  if (address === '::' || address === '::1') return true;
  if (address.startsWith('::ffff:')) {
    const embedded = address.slice('::ffff:'.length);
    return embedded.includes('.') ? isBlockedIpv4(embedded) : true;
  }
  if (address.startsWith('64:ff9b:')) return true;
  if (address.startsWith('fc') || address.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(address)) return true;
  if (address.startsWith('ff')) return true;
  if (address.startsWith('2001:db8')) return true;
  return false;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isTextual(contentType: string): boolean {
  const value = contentType.toLowerCase();
  return (
    value.startsWith('text/') ||
    value.includes('json') ||
    value.includes('xml') ||
    value.startsWith('application/javascript')
  );
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Response is too large (${declared} bytes; limit ${maxBytes} bytes).`);
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`Response exceeded the ${maxBytes}-byte limit.`);
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks).toString('utf8');
}

export function extractHtml(html: string): { title: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch
    ? decodeEntities(titleMatch[1]?.replace(/<[^>]+>/g, '') ?? '')
        .replace(/\s+/g, ' ')
        .trim()
    : '';

  const withoutNoise = html
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, ' ')
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  const text = decodeEntities(withoutNoise)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { title, text };
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

function fromCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated]`;
}
