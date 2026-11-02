import type { FastifyReply, FastifyRequest } from 'fastify';

interface Bucket {
  count: number;
  resetAt: number;
}

export function createRateLimitHook(max: number, windowMs: number) {
  const buckets = new Map<string, Bucket>();

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const now = Date.now();
    if (buckets.size >= 10_000) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
      }
    }

    const key = request.ip;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    reply.header('x-ratelimit-limit', String(max));
    reply.header('x-ratelimit-remaining', String(Math.max(0, max - bucket.count)));
    reply.header('x-ratelimit-reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      await reply
        .code(429)
        .header('retry-after', String(retryAfter))
        .send({
          error: {
            code: 'RATE_LIMITED',
            message: `Too many requests. Retry in ${retryAfter}s.`,
          },
          requestId: request.id,
        });
    }
  };
}
