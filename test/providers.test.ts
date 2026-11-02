import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnthropicProvider } from '../src/llm/anthropic.ts';
import { createOpenAiProvider } from '../src/llm/openai.ts';

const originalFetch = globalThis.fetch;

test('openai adapter translates tools, tool calls and usage', async () => {
  let capturedUrl = '';
  let capturedBody: Record<string, unknown> = {};

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: 'Let me calculate that.',
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'calculate', arguments: '{"expression":"2+2"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;

  try {
    const provider = createOpenAiProvider({
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1/',
      model: 'test-model',
    });

    const result = await provider.complete({
      system: 'Be terse.',
      messages: [{ role: 'user', content: 'what is 2+2?' }],
      tools: [{ name: 'calculate', description: 'math', parameters: { type: 'object' } }],
    });

    assert.equal(capturedUrl, 'https://example.test/v1/chat/completions');
    const messages = capturedBody.messages as Array<Record<string, unknown>>;
    assert.deepEqual(messages[0], { role: 'system', content: 'Be terse.' });
    assert.deepEqual(messages[1], { role: 'user', content: 'what is 2+2?' });

    const tools = capturedBody.tools as Array<{
      type: string;
      function: { name: string };
    }>;
    assert.equal(tools[0]?.type, 'function');
    assert.equal(tools[0]?.function.name, 'calculate');

    assert.equal(result.finishReason, 'tool_calls');
    assert.equal(result.content, 'Let me calculate that.');
    assert.equal(result.toolCalls[0]?.name, 'calculate');
    assert.deepEqual(result.toolCalls[0]?.arguments, { expression: '2+2' });
    assert.equal(result.usage.totalTokens, 15);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('openai adapter surfaces upstream failures', async () => {
  globalThis.fetch = (async () =>
    new Response('invalid key', { status: 401 })) as unknown as typeof fetch;

  try {
    const provider = createOpenAiProvider({
      apiKey: 'bad',
      baseUrl: 'https://example.test/v1',
      model: 'test-model',
    });
    await assert.rejects(
      () =>
        provider.complete({
          system: '',
          messages: [{ role: 'user', content: 'hi' }],
          tools: [],
        }),
      /HTTP 401/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('anthropic adapter translates system, tools and tool results', async () => {
  let capturedUrl = '';
  let capturedBody: Record<string, unknown> = {};

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        content: [
          { type: 'text', text: 'The answer is 4.' },
          { type: 'tool_use', id: 'toolu_2', name: 'calculate', input: { expression: '2+2' } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 12, output_tokens: 6 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;

  try {
    const provider = createAnthropicProvider({
      apiKey: 'test-key',
      baseUrl: 'https://example.test',
      model: 'test-model',
    });

    const result = await provider.complete({
      system: 'Be useful.',
      messages: [
        { role: 'user', content: 'calc 2+2' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'toolu_1', name: 'calculate', arguments: { expression: '2+2' } }],
        },
        {
          role: 'tool',
          toolCallId: 'toolu_1',
          toolName: 'calculate',
          content: '{"ok":true,"data":{"result":4}}',
        },
      ],
      tools: [{ name: 'calculate', description: 'math', parameters: { type: 'object' } }],
    });

    assert.equal(capturedUrl, 'https://example.test/v1/messages');
    assert.equal(capturedBody.system, 'Be useful.');

    const messages = capturedBody.messages as Array<{
      role: string;
      content: Array<Record<string, unknown>>;
    }>;
    assert.equal(messages[0]?.role, 'user');
    assert.equal(messages[1]?.role, 'assistant');
    assert.equal(messages[1]?.content[0]?.type, 'tool_use');
    assert.equal(messages[1]?.content[0]?.name, 'calculate');
    assert.equal(messages[2]?.role, 'user');
    assert.equal(messages[2]?.content[0]?.type, 'tool_result');
    assert.equal(messages[2]?.content[0]?.tool_use_id, 'toolu_1');

    assert.equal(result.finishReason, 'tool_calls');
    assert.equal(result.toolCalls[0]?.id, 'toolu_2');
    assert.deepEqual(result.toolCalls[0]?.arguments, { expression: '2+2' });
    assert.equal(result.usage.totalTokens, 18);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
