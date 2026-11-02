import { isRecord } from './guards.ts';
import { normalizeUsage, postJson } from './http.ts';
import {
  ProviderError,
  type ChatMessage,
  type CompletionRequest,
  type CompletionResult,
  type LlmProvider,
  type ToolCall,
} from './types.ts';

export interface AnthropicProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
}

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicBlock[];
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export function createAnthropicProvider({
  apiKey,
  baseUrl,
  model,
}: AnthropicProviderOptions): LlmProvider {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/v1/messages`;

  return {
    name: 'anthropic',
    async complete(request: CompletionRequest): Promise<CompletionResult> {
      const body: Record<string, unknown> = {
        model,
        max_tokens: request.maxTokens ?? 1024,
        messages: toAnthropicMessages(request.messages),
      };
      if (request.system) body.system = request.system;
      if (request.tools.length > 0) {
        body.tools = request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters,
        }));
      }
      if (request.temperature !== undefined) body.temperature = request.temperature;

      const payload = (await postJson(
        'anthropic',
        endpoint,
        { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body,
        request.signal,
      )) as AnthropicResponse;

      const blocks = payload.content ?? [];
      const text = blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('\n')
        .trim();

      const toolCalls: ToolCall[] = blocks
        .filter((block) => block.type === 'tool_use' && block.id && block.name)
        .map((block) => ({
          id: block.id ?? '',
          name: block.name ?? '',
          arguments: isRecord(block.input) ? block.input : {},
        }));

      return {
        content: text,
        toolCalls,
        usage: normalizeUsage(payload.usage?.input_tokens, payload.usage?.output_tokens),
        finishReason:
          payload.stop_reason === 'tool_use'
            ? 'tool_calls'
            : payload.stop_reason === 'max_tokens'
              ? 'length'
              : 'stop',
      };
    },
  };
}

function toAnthropicMessages(messages: ChatMessage[]): AnthropicMessage[] {
  const output: AnthropicMessage[] = [];

  function push(role: AnthropicMessage['role'], blocks: AnthropicBlock[]): void {
    if (blocks.length === 0) return;
    const last = output[output.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else output.push({ role, content: blocks });
  }

  for (const message of messages) {
    if (message.role === 'tool') {
      if (!message.toolCallId) {
        throw new ProviderError('anthropic', 'Tool message is missing its toolCallId.');
      }
      push('user', [
        { type: 'tool_result', tool_use_id: message.toolCallId, content: message.content },
      ]);
      continue;
    }

    if (message.role === 'assistant') {
      const blocks: AnthropicBlock[] = [];
      if (message.content) blocks.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
      }
      push('assistant', blocks);
      continue;
    }

    push('user', [{ type: 'text', text: message.content }]);
  }

  return output;
}
