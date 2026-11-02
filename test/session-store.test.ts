import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionStore } from '../src/chat/session-store.ts';
import type { ToolCall } from '../src/llm/types.ts';

test('trims history without leaving an orphaned tool result first', () => {
  const store = createSessionStore({ ttlMs: 60_000, maxMessages: 3 });
  const session = store.create();
  const call: ToolCall = { id: 'call_1', name: 'get_current_time', arguments: {} };

  store.append(
    session,
    { role: 'user', content: 'a' },
    { role: 'assistant', content: '', toolCalls: [call] },
    { role: 'tool', content: '{}', toolCallId: 'call_1', toolName: 'get_current_time' },
    { role: 'user', content: 'b' },
    { role: 'assistant', content: 'c' },
  );

  assert.ok(session.messages.length <= 3);
  assert.notEqual(session.messages[0]?.role, 'tool');
});

test('expires sessions after the ttl', async () => {
  const store = createSessionStore({ ttlMs: 10, maxMessages: 10 });
  const session = store.create();

  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(store.get(session.id), undefined);
  assert.throws(() => store.require(session.id), /No session with id/);
});

test('sweep removes expired sessions', async () => {
  const store = createSessionStore({ ttlMs: 10, maxMessages: 10 });
  const session = store.create();

  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(store.sweep(), 1);
  assert.equal(store.size(), 0);
  assert.equal(store.get(session.id), undefined);
});
