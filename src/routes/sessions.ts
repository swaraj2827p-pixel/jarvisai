import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Session, SessionStore } from '../chat/session-store.ts';
import { HttpError } from '../http/errors.ts';
import { validate } from '../http/validate.ts';

const CreateSessionBody = z
  .object({
    systemPrompt: z.string().trim().min(1).max(4000).optional(),
  })
  .strict();

const SessionParams = z.object({
  id: z.string().trim().min(8).max(64),
});

function toView(session: Session) {
  return {
    id: session.id,
    createdAt: new Date(session.createdAt).toISOString(),
    updatedAt: new Date(session.updatedAt).toISOString(),
    systemPrompt: session.systemPrompt,
    messageCount: session.messages.length,
    messages: session.messages,
  };
}

export function createSessionRoutes(store: SessionStore): FastifyPluginAsync {
  return async (app: FastifyInstance) => {
    app.post('/sessions', async (request, reply) => {
      const body = validate(CreateSessionBody, request.body ?? {}, 'body');
      const session = store.create(body.systemPrompt);
      return reply.code(201).send(toView(session));
    });

    app.get('/sessions/:id', async (request) => {
      const { id } = validate(SessionParams, request.params, 'params');
      return toView(store.require(id));
    });

    app.delete('/sessions/:id', async (request, reply) => {
      const { id } = validate(SessionParams, request.params, 'params');
      if (!store.remove(id)) {
        throw new HttpError(404, 'SESSION_NOT_FOUND', `No session with id "${id}".`);
      }
      return reply.code(204).send();
    });
  };
}
