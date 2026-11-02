import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ChatService } from '../chat/chat-service.ts';
import { validate } from '../http/validate.ts';

const ChatBody = z
  .object({
    message: z.string().trim().min(1).max(8000),
    sessionId: z.string().trim().min(8).max(64).optional(),
    system: z.string().trim().min(1).max(4000).optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().min(16).max(8192).optional(),
  })
  .strict();

export function createChatRoutes(chat: ChatService): FastifyPluginAsync {
  return async (app: FastifyInstance) => {
    app.post('/chat', async (request) => {
      const body = validate(ChatBody, request.body ?? {}, 'body');
      return chat.chat(body);
    });
  };
}
