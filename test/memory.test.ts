import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../src/memory/memory-store.ts';

async function tempDir(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-memory-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('persists and reloads remembered facts', async (t) => {
  const directory = await tempDir(t);
  const file = join(directory, 'nested', 'memory.json');

  const store = await createMemoryStore(file);
  await store.remember('name', 'Tony Stark');

  assert.equal(store.recall('name'), 'Tony Stark');
  assert.match(store.factsBlock(), /name: Tony Stark/);

  const reloaded = await createMemoryStore(file);
  assert.equal(reloaded.recall('name'), 'Tony Stark');

  const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, string>;
  assert.equal(raw.name, 'Tony Stark');
});

test('validates memory keys and values', async (t) => {
  const directory = await tempDir(t);
  const store = await createMemoryStore(join(directory, 'memory.json'));

  await assert.rejects(() => store.remember('   ', 'value'), /key must not be empty/);
  await assert.rejects(() => store.remember('key', '   '), /value must not be empty/);
  await assert.rejects(() => store.remember('x'.repeat(65), 'value'), /at most 64/);
});

test('backs up a corrupt memory file and starts empty', async (t) => {
  const directory = await tempDir(t);
  const file = join(directory, 'memory.json');
  await writeFile(file, 'this is not json', 'utf8');

  const store = await createMemoryStore(file);

  assert.equal(store.recall('name'), undefined);
  assert.ok(store.corruptBackup);
  await readFile(store.corruptBackup, 'utf8');
});
