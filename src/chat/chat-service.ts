import type { MemoryStore } from '../memory/memory-store.ts';
import type { LlmProvider, Usage } from '../llm/types.ts';
import type { SessionStore, Session } from './session-store.ts';
import type { ToolRegistry } from '../tools/registry.ts';

export interface ChatRequest {
  message: string;
  sessionId?: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ToolRun {
  name: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface ChatResponse {
  sessionId: string;
  reply: string;
  toolRuns: ToolRun[];
  usage: Usage;
  provider: string;
  iterations: number;
  finishReason: 'stop' | 'length' | 'max_iterations';
}

export interface ChatServiceOptions {
  provider: LlmProvider;
  store: SessionStore;
  memory: MemoryStore;
  tools: ToolRegistry;
  systemPrompt: string;
  maxToolIterations: number;
  timeoutMs: number;
}

export interface ChatService {
  chat(request: ChatRequest): Promise<ChatResponse>;
}

export function createChatService(options: ChatServiceOptions): ChatService {
  const { provider, store, memory, tools, systemPrompt, maxToolIterations, timeoutMs } = options;
  const locks = new Map<string, Promise<unknown>>();

  function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve();
    const result = previous.then(task, task);
    locks.set(key, result);
    const cleanup = () => {
      if (locks.get(key) === result) locks.delete(key);
    };
    result.then(cleanup, cleanup);
    return result;
  }

  function composeSystem(base: string): string {
    const facts = memory.factsBlock();
    return facts ? `${base}\n\n${facts}` : base;
  }

  async function run(session: Session, request: ChatRequest): Promise<ChatResponse> {
    const baseSystem = session.systemPrompt ?? systemPrompt;
    store.append(session, { role: 'user', content: request.message });

    const toolRuns: ToolRun[] = [];
    const usage: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    for (let iteration = 1; iteration <= maxToolIterations; iteration += 1) {
      const result = await provider.complete({
        system: composeSystem(baseSystem),
        messages: session.messages,
        tools: tools.definitions(),
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        signal: AbortSignal.timeout(timeoutMs),
      });

      usage.promptTokens += result.usage.promptTokens;
      usage.completionTokens += result.usage.completionTokens;
      usage.totalTokens += result.usage.totalTokens;

      if (result.toolCalls.length === 0) {
        store.append(session, { role: 'assistant', content: result.content });
        return {
          sessionId: session.id,
          reply: result.content,
          toolRuns,
          usage,
          provider: provider.name,
          iterations: iteration,
          finishReason: result.finishReason === 'length' ? 'length' : 'stop',
        };
      }

      store.append(session, {
        role: 'assistant',
        content: result.content,
        toolCalls: result.toolCalls,
      });

      for (const call of result.toolCalls) {
        const outcome = await tools.run(call.name, call.arguments);
        const errorMessage = outcome.error ?? 'Tool failed.';
        toolRuns.push(
          outcome.ok
            ? { name: call.name, arguments: call.arguments, ok: true, result: outcome.data }
            : { name: call.name, arguments: call.arguments, ok: false, error: errorMessage },
        );
        store.append(session, {
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          content: JSON.stringify(
            outcome.ok ? { ok: true, data: outcome.data } : { ok: false, error: errorMessage },
          ),
        });
      }
    }

    const reply = 'I reached the tool-call limit before I could finish. Try a narrower request.';
    store.append(session, { role: 'assistant', content: reply });
    return {
      sessionId: session.id,
      reply,
      toolRuns,
      usage,
      provider: provider.name,
      iterations: maxToolIterations,
      finishReason: 'max_iterations',
    };
  }

  async function chat(request: ChatRequest): Promise<ChatResponse> {
    const session = request.sessionId
      ? store.require(request.sessionId)
      : store.create(request.system);

    if (session.systemPrompt === undefined && request.system !== undefined) {
      session.systemPrompt = request.system;
    }

    return serialize(session.id, () => run(session, request));
  }

  return { chat };
}
