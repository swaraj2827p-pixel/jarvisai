import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

export function createAuthHook(apiKey?: string) {
  const expected = apiKey ? Buffer.from(apiKey, 'utf8') : undefined;

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!expected) return;

    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    const provided = Buffer.from(token, 'utf8');
    const valid = provided.length === expected.length && timingSafeEqual(provided, expected);
    if (valid) return;

    await reply.code(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: token ? 'Invalid API key.' : 'Missing bearer token.',
      },
      requestId: request.id,
    });
  };
}
