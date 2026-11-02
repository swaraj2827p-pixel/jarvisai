import { z } from 'zod';
import { HttpError } from './errors.ts';

export function validate<T>(schema: z.ZodType<T>, value: unknown, source: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      `Request ${source} is invalid.`,
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}
