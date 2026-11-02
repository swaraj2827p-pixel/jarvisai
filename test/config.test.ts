import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';

test('defaults to the mock provider and a local server', () => {
  const config = loadConfig({});
  assert.equal(config.llmProvider, 'mock');
  assert.equal(config.port, 3000);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.maxToolIterations, 6);
  assert.equal(config.memoryFile, 'data/jarvis-memory.json');
});

test('requires an API key for cloud providers', () => {
  assert.throws(() => loadConfig({ LLM_PROVIDER: 'openai' }), /OPENAI_API_KEY/);
  assert.throws(() => loadConfig({ LLM_PROVIDER: 'anthropic' }), /ANTHROPIC_API_KEY/);
});

test('treats empty optional values as missing', () => {
  const config = loadConfig({ OPENAI_API_KEY: '', JARVIS_API_KEY: '   ' });
  assert.equal(config.openAiApiKey, undefined);
  assert.equal(config.apiKey, undefined);
});

test('rejects out-of-range values', () => {
  assert.throws(() => loadConfig({ PORT: '70000' }), /Invalid configuration/);
  assert.throws(() => loadConfig({ MAX_TOOL_ITERATIONS: '0' }), /Invalid configuration/);
  assert.throws(() => loadConfig({ LLM_PROVIDER: 'bogus' }), /Invalid configuration/);
});
