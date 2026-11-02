import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import type { ChatResponse } from '../src/chat/chat-service.ts';
import { loadConfig } from '../src/config.ts';
import type { LlmProvider } from '../src/llm/types.ts';
import { createMemoryStore } from '../src/memory/memory-store.ts';

function testConfig(overrides: Record<string, string> = {}) {
  return loadConfig({ LLM_PROVIDER: 'mock', LOG_LEVEL: 'silent', ...overrides });
}

async function makeApp(
  t: TestContext,
  overrides: Record<string, string> = {},
  provider?: LlmProvider,
): Promise<FastifyInstance> {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-api-'));
  const { app } = await buildApp({
    config: testConfig({ MEMORY_FILE: join(directory, 'memory.json'), ...overrides }),
    provider,
    logger: false,
  });
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  return app;
}

async function chat(
  app: FastifyInstance,
  message: string,
  sessionId?: string,
): Promise<ChatResponse> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/chat',
    payload: sessionId ? { message, sessionId } : { message },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as ChatResponse;
}

test('health and tool discovery', async (t) => {
  const app = await makeApp(t);

  const health = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(health.statusCode, 200);
  const healthBody = health.json() as { status: string; provider: string };
  assert.equal(healthBody.status, 'ok');
  assert.equal(healthBody.provider, 'mock');

  const tools = await app.inject({ method: 'GET', url: '/v1/tools' });
  assert.equal(tools.statusCode, 200);
  const names = (tools.json() as { tools: Array<{ name: string }> }).tools
    .map((tool) => tool.name)
    .sort();
  assert.deepEqual(names, [
    'calculate',
    'fetch_url',
    'get_current_time',
    'get_system_info',
    'recall',
    'remember',
  ]);
});

test('chat runs the calculator tool and replies with the result', async (t) => {
  const app = await makeApp(t);

  const body = await chat(app, 'calc: (2 + 3) * 4');

  assert.equal(body.toolRuns.length, 1);
  assert.equal(body.toolRuns[0]?.name, 'calculate');
  assert.equal(body.toolRuns[0]?.ok, true);
  assert.match(body.reply, /20/);
  assert.equal(body.finishReason, 'stop');
  assert.equal(body.provider, 'mock');
});

test('keeps session context and routes timezones to the time tool', async (t) => {
  const app = await makeApp(t);

  const first = await chat(app, 'what time is it?');
  assert.equal(first.toolRuns[0]?.name, 'get_current_time');
  assert.match(first.reply, /UTC/);

  const second = await chat(app, 'what time is it in Europe/London?', first.sessionId);
  assert.equal(second.sessionId, first.sessionId);
  assert.equal(second.toolRuns[0]?.name, 'get_current_time');
  assert.match(second.reply, /Europe\/London/);

  const view = await app.inject({ method: 'GET', url: `/v1/sessions/${first.sessionId}` });
  assert.equal(view.statusCode, 200);
  const session = view.json() as { messageCount: number };
  assert.ok(session.messageCount >= 4);
});

test('remember and recall persist across app restarts', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-memory-'));
  const memoryFile = join(directory, 'memory.json');
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const first = await buildApp({
    config: testConfig({ MEMORY_FILE: memoryFile }),
    logger: false,
  });
  try {
    const remembered = await chat(first.app, 'remember name = Tony Stark');
    assert.equal(remembered.toolRuns[0]?.name, 'remember');
    assert.match(remembered.reply, /Tony Stark/);
  } finally {
    await first.app.close();
  }

  const second = await buildApp({
    config: testConfig({ MEMORY_FILE: memoryFile }),
    logger: false,
  });
  t.after(async () => {
    await second.app.close();
  });

  const recalled = await chat(second.app, 'recall name');
  assert.equal(recalled.toolRuns[0]?.name, 'recall');
  assert.match(recalled.reply, /Tony Stark/);
});

test('remembered facts are injected into the system prompt', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-memory-'));
  const memoryFile = join(directory, 'memory.json');
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const seed = await createMemoryStore(memoryFile);
  await seed.remember('name', 'Tony Stark');

  let capturedSystem = '';
  const capturing: LlmProvider = {
    name: 'capturing',
    async complete(request) {
      capturedSystem = request.system;
      return {
        content: 'Acknowledged.',
        toolCalls: [],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        finishReason: 'stop',
      };
    },
  };

  const { app } = await buildApp({
    config: testConfig({ MEMORY_FILE: memoryFile }),
    provider: capturing,
    logger: false,
  });
  t.after(async () => {
    await app.close();
  });

  const response = await chat(app, 'hello');

  assert.match(capturedSystem, /Things you remember about the user/);
  assert.match(capturedSystem, /Tony Stark/);
  assert.equal(response.reply, 'Acknowledged.');
});

test('creates and deletes sessions', async (t) => {
  const app = await makeApp(t);

  const created = await app.inject({
    method: 'POST',
    url: '/v1/sessions',
    payload: { systemPrompt: 'Be brief.' },
  });
  assert.equal(created.statusCode, 201);
  const { id } = created.json() as { id: string };

  const fetched = await app.inject({ method: 'GET', url: `/v1/sessions/${id}` });
  assert.equal(fetched.statusCode, 200);

  const removed = await app.inject({ method: 'DELETE', url: `/v1/sessions/${id}` });
  assert.equal(removed.statusCode, 204);

  const missing = await app.inject({ method: 'GET', url: `/v1/sessions/${id}` });
  assert.equal(missing.statusCode, 404);
});

test('returns 404 for unknown sessions', async (t) => {
  const app = await makeApp(t);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/chat',
    payload: { message: 'hello', sessionId: randomUUID() },
  });

  assert.equal(response.statusCode, 404);
  assert.equal((response.json() as { error: { code: string } }).error.code, 'SESSION_NOT_FOUND');
});

test('rejects invalid request bodies', async (t) => {
  const app = await makeApp(t);

  const response = await app.inject({
    method: 'POST',
    url: '/v1/chat',
    payload: { message: '   ' },
  });

  assert.equal(response.statusCode, 400);
  const body = response.json() as { error: { code: string; details: unknown } };
  assert.equal(body.error.code, 'VALIDATION_ERROR');
  assert.ok(body.error.details);
});

test('requires a bearer token when JARVIS_API_KEY is set', async (t) => {
  const app = await makeApp(t, { JARVIS_API_KEY: 'test-secret-key' });

  const unauthorized = await app.inject({
    method: 'POST',
    url: '/v1/chat',
    payload: { message: 'hi' },
  });
  assert.equal(unauthorized.statusCode, 401);

  const badToken = await app.inject({
    method: 'POST',
    url: '/v1/chat',
    payload: { message: 'hi' },
    headers: { authorization: 'Bearer wrong-key' },
  });
  assert.equal(badToken.statusCode, 401);

  const authorized = await app.inject({
    method: 'POST',
    url: '/v1/chat',
    payload: { message: 'hi' },
    headers: { authorization: 'Bearer test-secret-key' },
  });
  assert.equal(authorized.statusCode, 200);

  const health = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(health.statusCode, 200);
});

test('rate limits /v1 routes per client', async (t) => {
  const app = await makeApp(t, { RATE_LIMIT_MAX: '2' });

  const first = await app.inject({ method: 'POST', url: '/v1/chat', payload: { message: 'hi' } });
  assert.equal(first.statusCode, 200);

  const second = await app.inject({ method: 'POST', url: '/v1/chat', payload: { message: 'hi' } });
  assert.equal(second.statusCode, 200);

  const third = await app.inject({ method: 'POST', url: '/v1/chat', payload: { message: 'hi' } });
  assert.equal(third.statusCode, 429);
  assert.ok(third.headers['retry-after']);
  assert.equal((third.json() as { error: { code: string } }).error.code, 'RATE_LIMITED');
});

test('stops after the configured number of tool iterations', async (t) => {
  const looping: LlmProvider = {
    name: 'looping',
    async complete() {
      return {
        content: '',
        toolCalls: [{ id: randomUUID(), name: 'get_current_time', arguments: {} }],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        finishReason: 'tool_calls',
      };
    },
  };
  const app = await makeApp(t, { MAX_TOOL_ITERATIONS: '2' }, looping);

  const body = await chat(app, 'loop forever');

  assert.equal(body.finishReason, 'max_iterations');
  assert.equal(body.iterations, 2);
  assert.equal(body.toolRuns.length, 2);
});

test('system info tool returns machine details', async (t) => {
  const app = await makeApp(t);

  const body = await chat(app, 'system info');

  assert.equal(body.toolRuns[0]?.name, 'get_system_info');
  assert.match(body.reply, /running on/);
});
