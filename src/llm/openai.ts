import { normalizeUsage, postJson } from './http.ts';
import {
  ProviderError,
  type ChatMessage,
  type CompletionRequest,
  type CompletionResult,
  type LlmProvider,
  type ToolCall,
} from './types.ts';

export interface OpenAiProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface OpenAiToolCall {
  id: string;
  type?: string;
  function: { name: string; arguments: string };
}

interface OpenAiResponse {
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: OpenAiToolCall[] };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export function createOpenAiProvider({
  apiKey,
  baseUrl,
  model,
}: OpenAiProviderOptions): LlmProvider {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  return {
    name: 'openai',
    async complete(request: CompletionRequest): Promise<CompletionResult> {
      const body: Record<string, unknown> = {
        model,
        messages: [
          ...(request.system ? [{ role: 'system', content: request.system }] : []),
          ...request.messages.map(toOpenAiMessage),
        ],
      };

      if (request.tools.length > 0) {
        body.tools = request.tools.map((tool) => ({ type: 'function', function: tool }));
        body.tool_choice = 'auto';
      }
      if (request.temperature !== undefined) body.temperature = request.temperature;
      if (request.maxTokens !== undefined) body.max_completion_tokens = request.maxTokens;

      const payload = (await postJson(
        'openai',
        endpoint,
        { authorization: `Bearer ${apiKey}` },
        body,
        request.signal,
      )) as OpenAiResponse;

      const choice = payload.choices?.[0];
      if (!choice?.message) {
        throw new ProviderError('openai', 'OpenAI returned an empty response.');
      }

      const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((call) => ({
        id: call.id,
        name: call.function.name,
        arguments: parseArguments(call.function.arguments),
      }));

      return {
        content: choice.message.content ?? '',
        toolCalls,
        usage: normalizeUsage(
          payload.usage?.prompt_tokens,
          payload.usage?.completion_tokens,
          payload.usage?.total_tokens,
        ),
        finishReason:
          toolCalls.length > 0
            ? 'tool_calls'
            : choice.finish_reason === 'length'
              ? 'length'
              : 'stop',
      };
    },
  };
}

function toOpenAiMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId ?? '', content: message.content };
  }
  if (message.role === 'assistant') {
    if (message.toolCalls && message.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
      };
    }
    return { role: 'assistant', content: message.content };
  }
  return { role: 'user', content: message.content };
}

function parseArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new Error('Tool arguments must be a JSON object.');
  } catch (error) {
    throw new ProviderError(
      'openai',
      `OpenAI returned invalid tool arguments: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
