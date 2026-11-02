import test from 'node:test';
import assert from 'node:assert/strict';
import { createFetchUrlTool, extractHtml, isBlockedAddress } from '../src/tools/fetch-url.ts';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

test('classifies private, local and public addresses', () => {
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '224.0.0.1',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ]) {
    assert.equal(isBlockedAddress(address), true, `${address} should be blocked`);
  }

  for (const address of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111']) {
    assert.equal(isBlockedAddress(address), false, `${address} should be allowed`);
  }
});

test('rejects local and non-http targets before any request', async () => {
  let calls = 0;
  const tool = createFetchUrlTool({
    lookup: publicLookup,
    fetchImpl: (async () => {
      calls += 1;
      return htmlResponse('should not be reached');
    }) as unknown as typeof fetch,
  });

  await assert.rejects(() => tool.run({ url: 'file:///etc/passwd' }), /only http/i);
  await assert.rejects(() => tool.run({ url: 'http://localhost:3000/admin' }), /private or local/i);
  await assert.rejects(() => tool.run({ url: 'http://127.0.0.1/' }), /private or local/i);
  await assert.rejects(() => tool.run({ url: 'http://[::1]/' }), /private or local/i);
  assert.equal(calls, 0);
});

test('rejects hostnames that resolve to private addresses', async () => {
  const tool = createFetchUrlTool({
    fetchImpl: (async () => htmlResponse('nope')) as unknown as typeof fetch,
    lookup: async () => [{ address: '10.0.0.5', family: 4 }],
  });

  await assert.rejects(
    () => tool.run({ url: 'https://internal.example.com/data' }),
    /private address/i,
  );
});

test('fetches html and returns readable text without scripts or styles', async () => {
  let seenUrl = '';
  const tool = createFetchUrlTool({
    lookup: publicLookup,
    fetchImpl: (async (input: string | URL | Request) => {
      seenUrl = String(input);
      return htmlResponse(
        '<html><head><title>Docs &amp; API</title><style>.x{color:red}</style>' +
          '<script>alert(1)</script></head>' +
          '<body><h1>Hello</h1><p>World &lt;3</p></body></html>',
      );
    }) as unknown as typeof fetch,
  });

  const result = (await tool.run({ url: 'https://example.com/docs', maxChars: 1000 })) as {
    title: string;
    text: string;
    url: string;
    status: number;
  };

  assert.equal(seenUrl, 'https://example.com/docs');
  assert.equal(result.url, 'https://example.com/docs');
  assert.equal(result.status, 200);
  assert.equal(result.title, 'Docs & API');
  assert.match(result.text, /Hello/);
  assert.match(result.text, /World <3/);
  assert.doesNotMatch(result.text, /alert|color:red/);
});

test('follows redirects and revalidates every hop', async () => {
  const calls: string[] = [];
  const tool = createFetchUrlTool({
    lookup: publicLookup,
    fetchImpl: (async (input: string | URL | Request) => {
      const href = String(input);
      calls.push(href);
      if (href.endsWith('/start')) {
        return new Response(null, { status: 302, headers: { location: '/final' } });
      }
      return htmlResponse('<title>Done</title><p>ok</p>');
    }) as unknown as typeof fetch,
  });

  const result = (await tool.run({ url: 'https://example.com/start' })) as {
    url: string;
    title: string;
  };
  assert.deepEqual(calls, ['https://example.com/start', 'https://example.com/final']);
  assert.equal(result.url, 'https://example.com/final');
  assert.equal(result.title, 'Done');
});

test('rejects redirects that point at private addresses', async () => {
  let calls = 0;
  const tool = createFetchUrlTool({
    lookup: publicLookup,
    fetchImpl: (async () => {
      calls += 1;
      return new Response(null, {
        status: 301,
        headers: { location: 'http://127.0.0.1/admin' },
      });
    }) as unknown as typeof fetch,
  });

  await assert.rejects(() => tool.run({ url: 'https://example.com/' }), /private or local/i);
  assert.equal(calls, 1);
});

test('truncates long text output', async () => {
  const tool = createFetchUrlTool({
    lookup: publicLookup,
    fetchImpl: (async () =>
      new Response('a'.repeat(500), {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })) as unknown as typeof fetch,
  });

  const result = (await tool.run({ url: 'https://example.com/big.txt', maxChars: 200 })) as {
    text: string;
  };
  assert.equal(result.text.length, 200 + '\n\n[truncated]'.length);
  assert.match(result.text, /\[truncated\]$/);
});

test('extractHtml strips markup and decodes entities', () => {
  const { title, text } = extractHtml(
    '<title>A &amp; B</title><div>One</div><div>Two &quot;quoted&quot; &#39;x&#39;</div>',
  );
  assert.equal(title, 'A & B');
  assert.equal(text, 'One\nTwo "quoted" \'x\'');
});
