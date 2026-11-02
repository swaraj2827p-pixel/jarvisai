import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Config } from './config.ts';
import { createChatService, type ChatService } from './chat/chat-service.ts';
import { createSessionStore, type SessionStore } from './chat/session-store.ts';
import { DEFAULT_SYSTEM_PROMPT } from './chat/system-prompt.ts';
import { createAuthHook } from './http/auth.ts';
import { HttpError } from './http/errors.ts';
import { createRateLimitHook } from './http/rate-limit.ts';
import { createProvider } from './llm/factory.ts';
import { ProviderError, type LlmProvider } from './llm/types.ts';
import { createMemoryStore, type MemoryStore } from './memory/memory-store.ts';
import { createChatRoutes } from './routes/chat.ts';
import { createSessionRoutes } from './routes/sessions.ts';
import { createToolRoutes } from './routes/tools.ts';
import { createDefaultToolRegistry, type ToolRegistry } from './tools/index.ts';

export interface BuildAppOptions {
  config: Config;
  provider?: LlmProvider;
  logger?: boolean | { level: string };
}

export interface JarvisApp {
  app: FastifyInstance;
  store: SessionStore;
  memory: MemoryStore;
  provider: LlmProvider;
  tools: ToolRegistry;
  chat: ChatService;
}

export async function buildApp({
  config,
  provider,
  logger,
}: BuildAppOptions): Promise<JarvisApp> {
  const memory = await createMemoryStore(config.memoryFile);
  const activeProvider = provider ?? createProvider(config);
  const tools = createDefaultToolRegistry(memory);
  const store = createSessionStore({
    ttlMs: config.sessionTtlMs,
    maxMessages: config.maxSessionMessages,
  });
  const chat = createChatService({
    provider: activeProvider,
    store,
    memory,
    tools,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    maxToolIterations: config.maxToolIterations,
    timeoutMs: config.llmTimeoutMs,
  });

  const app = Fastify({
    logger: logger ?? { level: config.logLevel },
    genReqId: () => randomUUID(),
    bodyLimit: config.bodyLimitBytes,
  });

  if (memory.corruptBackup) {
    app.log.warn(
      { backup: memory.corruptBackup },
      'memory file was unreadable and was backed up; starting with empty memory',
    );
  }

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof HttpError) {
      if (error.statusCode >= 500) request.log.error({ err: error }, 'request failed');
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
        requestId: request.id,
      });
    }

    if (error instanceof ProviderError) {
      request.log.error({ err: error, provider: error.provider }, 'provider request failed');
      return reply.code(502).send({
        error: { code: 'PROVIDER_ERROR', message: error.message },
        requestId: request.id,
      });
    }

    const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (statusCode >= 500) request.log.error({ err: error }, 'unhandled error');
    return reply.code(statusCode).send({
      error: {
        code:
          statusCode === 413
            ? 'PAYLOAD_TOO_LARGE'
            : statusCode < 500
              ? 'BAD_REQUEST'
              : 'INTERNAL_ERROR',
        message: statusCode < 500 ? error.message : 'An unexpected error occurred.',
      },
      requestId: request.id,
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${request.method} ${request.url} not found.`,
      },
      requestId: request.id,
    }),
  );

  app.get('/health', async () => ({
    status: 'ok',
    provider: activeProvider.name,
    sessions: store.size(),
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  }));

  app.register(
    async (scope) => {
      scope.addHook('onRequest', createRateLimitHook(config.rateLimitMax, config.rateLimitWindowMs));
      scope.addHook('onRequest', createAuthHook(config.apiKey));
      await scope.register(createChatRoutes(chat));
      await scope.register(createSessionRoutes(store));
      await scope.register(createToolRoutes(tools));
    },
    { prefix: '/v1' },
  );

  return { app, store, memory, provider: activeProvider, tools, chat };
}
