export type MessageRole = 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: MessageRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type FinishReason = 'stop' | 'tool_calls' | 'length';

export interface CompletionRequest {
  system: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface CompletionResult {
  content: string;
  toolCalls: ToolCall[];
  usage: Usage;
  finishReason: FinishReason;
}

export interface LlmProvider {
  readonly name: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

export class ProviderError extends Error {
  readonly provider: string;

  constructor(provider: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ProviderError';
    this.provider = provider;
  }
}
