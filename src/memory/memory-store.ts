import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const MAX_KEY_LENGTH = 64;
const MAX_VALUE_LENGTH = 2000;

export interface MemoryStore {
  readonly corruptBackup?: string;
  all(): Record<string, string>;
  factsBlock(): string;
  remember(key: string, value: string): Promise<{ key: string; value: string }>;
  recall(key: string): string | undefined;
}

export async function createMemoryStore(filePath: string): Promise<MemoryStore> {
  const loaded = await load(filePath);
  const memories = loaded.memories;
  let writes: Promise<void> = Promise.resolve();

  function persist(): Promise<void> {
    const snapshot = JSON.stringify(memories, null, 2);
    writes = writes.then(
      () => writeSnapshot(filePath, snapshot),
      () => writeSnapshot(filePath, snapshot),
    );
    return writes;
  }

  return {
    ...(loaded.corruptBackup ? { corruptBackup: loaded.corruptBackup } : {}),
    all() {
      return { ...memories };
    },
    factsBlock() {
      const entries = Object.entries(memories);
      if (entries.length === 0) return '';
      const facts = entries.map(([key, value]) => `- ${key}: ${value}`).join('\n');
      return `Things you remember about the user:\n${facts}`;
    },
    async remember(key, value) {
      const normalizedKey = normalizeKey(key);
      const normalizedValue = normalizeValue(value);
      memories[normalizedKey] = normalizedValue;
      await persist();
      return { key: normalizedKey, value: normalizedValue };
    },
    recall(key) {
      return memories[normalizeKey(key)];
    },
  };
}

async function load(
  filePath: string,
): Promise<{ memories: Record<string, string>; corruptBackup?: string }> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { memories: {} };
    throw error;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isStringRecord(parsed)) {
      throw new Error('Memory file must contain a JSON object of string values.');
    }
    return { memories: { ...parsed } };
  } catch {
    const corruptBackup = `${filePath}.corrupt-${Date.now()}`;
    try {
      await rename(filePath, corruptBackup);
    } catch {
      // Keep serving with empty memory even if the backup cannot be written.
    }
    return { memories: {}, corruptBackup };
  }
}

async function writeSnapshot(filePath: string, contents: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  try {
    await writeFile(tempPath, contents, 'utf8');
    await rename(tempPath, filePath);
  } catch {
    await writeFile(filePath, contents, 'utf8');
    await rm(tempPath, { force: true });
  }
}

function normalizeKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) throw new Error('Memory key must not be empty.');
  if (trimmed.length > MAX_KEY_LENGTH) {
    throw new Error(`Memory key must be at most ${MAX_KEY_LENGTH} characters.`);
  }
  return trimmed;
}

function normalizeValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Memory value must not be empty.');
  if (trimmed.length > MAX_VALUE_LENGTH) {
    throw new Error(`Memory value must be at most ${MAX_VALUE_LENGTH} characters.`);
  }
  return trimmed;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}
