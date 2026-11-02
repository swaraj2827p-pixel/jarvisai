import { randomUUID } from 'node:crypto';
import { isRecord } from './guards.ts';
import type {
  ChatMessage,
  CompletionRequest,
  CompletionResult,
  LlmProvider,
  ToolCall,
  Usage,
} from './types.ts';

const CALC_PATTERN = /^(?:please\s+)?(?:calc|calculate|compute)\b\s*[:\-]?\s*(.+)$/i;
const TIME_PATTERN = /\b(time|clock|date|today)\b/i;
const TIMEZONE_PATTERN =
  /\b([A-Za-z][A-Za-z_]*\/[A-Za-z][A-Za-z_]*(?:\/[A-Za-z][A-Za-z_]*)?)\b/;
const SYSTEM_INFO_PATTERN =
  /\b(system info|system information|computer specs|machine info|what system|operating system|os version)\b/i;
const REMEMBER_PATTERN = /^remember\s+(?:that\s+)?(.+?)\s*(?:=|:)\s*(.+)$/i;
const RECALL_PATTERN = /^recall\s+(?:the\s+)?(.+)$/i;

export function createMockProvider(): LlmProvider {
  return {
    name: 'mock',
    async complete(request: CompletionRequest): Promise<CompletionResult> {
      const promptTokens = estimatePromptTokens(request);

      const trailingTools = collectTrailingToolMessages(request.messages);
      if (trailingTools.length > 0) {
        return finalResult(summarizeToolResults(trailingTools), promptTokens);
      }

      const lastUser = [...request.messages]
        .reverse()
        .find((message) => message.role === 'user');
      const text = lastUser?.content.trim() ?? '';
      const toolCall = chooseToolCall(text);
      if (toolCall) {
        return {
          content: '',
          toolCalls: [toolCall],
          usage: makeUsage(promptTokens, 20),
          finishReason: 'tool_calls',
        };
      }

      return finalResult(chooseReply(text), promptTokens);
    },
  };
}

function chooseToolCall(text: string): ToolCall | undefined {
  const remembered = REMEMBER_PATTERN.exec(text);
  const rememberedKey = remembered?.[1]?.trim();
  const rememberedValue = remembered?.[2]?.trim();
  if (rememberedKey && rememberedValue) {
    return {
      id: randomUUID(),
      name: 'remember',
      arguments: {
        key: stripQuotes(rememberedKey),
        value: stripQuotes(rememberedValue),
      },
    };
  }
  if (/^remember\b/i.test(text)) {
    const value = text.replace(/^remember\s+(?:that\s+)?/i, '').trim();
    if (value) {
      return { id: randomUUID(), name: 'remember', arguments: { key: 'note', value } };
    }
  }

  const recalledKey = RECALL_PATTERN.exec(text)?.[1]?.trim();
  if (recalledKey) {
    return { id: randomUUID(), name: 'recall', arguments: { key: stripQuotes(recalledKey) } };
  }

  const calculation = CALC_PATTERN.exec(text)?.[1]?.trim();
  if (calculation) {
    return {
      id: randomUUID(),
      name: 'calculate',
      arguments: { expression: calculation },
    };
  }

  if (TIME_PATTERN.test(text)) {
    const timezone = TIMEZONE_PATTERN.exec(text)?.[1];
    return {
      id: randomUUID(),
      name: 'get_current_time',
      arguments: timezone ? { timezone } : {},
    };
  }

  if (SYSTEM_INFO_PATTERN.test(text)) {
    return { id: randomUUID(), name: 'get_system_info', arguments: {} };
  }

  return undefined;
}

function collectTrailingToolMessages(messages: ChatMessage[]): ChatMessage[] {
  const trailing: ChatMessage[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'tool') break;
    trailing.unshift(message);
  }
  return trailing;
}

function summarizeToolResults(messages: ChatMessage[]): string {
  return messages
    .map((message) => {
      let payload: unknown;
      try {
        payload = JSON.parse(message.content);
      } catch {
        return 'A tool returned an unreadable result.';
      }
      if (!isRecord(payload)) return 'A tool returned an unexpected result.';
      if (payload.ok === false) {
        const reason = typeof payload.error === 'string' ? payload.error : 'unknown error';
        return `I could not complete ${message.toolName ?? 'the tool call'}: ${reason}.`;
      }

      const data = isRecord(payload.data) ? payload.data : {};
      if (data.remembered === true) {
        return `Remembered ${String(data.key ?? 'it')}: ${String(data.value ?? '')}.`;
      }
      if (typeof data.found === 'boolean') {
        return data.found
          ? `I remember ${String(data.key ?? 'that')}: ${String(data.value ?? '')}.`
          : `I have no memory of "${String(data.key ?? 'that')}".`;
      }
      if (typeof data.formatted === 'string') {
        const timezone = typeof data.timezone === 'string' ? data.timezone : 'UTC';
        return `The current time in ${timezone} is ${data.formatted}.`;
      }
      if (typeof data.result === 'number') {
        const expression = typeof data.expression === 'string' ? data.expression : 'The expression';
        return `${expression} = ${data.result}.`;
      }
      if (typeof data.platform === 'string') {
        return `You are running on ${data.platform} ${String(data.release ?? '')} (${String(
          data.architecture ?? 'unknown',
        )}) with Node ${String(data.nodeVersion ?? 'unknown')}.`;
      }
      return 'The tool finished successfully.';
    })
    .join(' ');
}

function chooseReply(text: string): string {
  if (!text) return 'At your service. (mock provider)';
  if (/^(hi|hello|hey|yo)\b/i.test(text)) {
    return 'At your service. Try "calc: (12 + 8) * 3", "what time is it in Europe/London", "system info", or "remember name = Tony Stark". (mock provider)';
  }
  return `I heard: "${text}". This is the mock provider, so it does not generate real reasoning. Try "calc: ...", ask for the time or system info, use "remember key = value" / "recall key", or set LLM_PROVIDER=openai or anthropic.`;
}

function finalResult(content: string, promptTokens: number): CompletionResult {
  return {
    content,
    toolCalls: [],
    usage: makeUsage(promptTokens, roughTokens(content)),
    finishReason: 'stop',
  };
}

function estimatePromptTokens(request: CompletionRequest): number {
  const messageTokens = request.messages.reduce((total, message) => {
    const toolPayload = message.toolCalls ? JSON.stringify(message.toolCalls) : '';
    return total + roughTokens(message.content) + roughTokens(toolPayload);
  }, 0);
  return roughTokens(request.system) + messageTokens;
}

function makeUsage(promptTokens: number, completionTokens: number): Usage {
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

function roughTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / 4);
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '').trim();
}
