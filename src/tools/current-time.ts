import { z } from 'zod';
import type { Tool } from './registry.ts';

const argumentsSchema = z
  .object({
    timezone: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export const currentTimeTool: Tool = {
  name: 'get_current_time',
  description:
    'Get the current date and time. Optionally pass an IANA timezone such as "Europe/London"; defaults to UTC.',
  parameters: {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        description: 'IANA timezone name, for example "America/New_York". Defaults to UTC.',
      },
    },
    additionalProperties: false,
  },
  async run(rawArguments) {
    const { timezone = 'UTC' } = argumentsSchema.parse(rawArguments);
    const now = new Date();

    let formatted: string;
    try {
      formatted = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        dateStyle: 'full',
        timeStyle: 'long',
      }).format(now);
    } catch {
      throw new Error(`Unknown timezone "${timezone}". Use an IANA name such as "Europe/London".`);
    }

    return {
      timezone,
      iso: now.toISOString(),
      epochMs: now.getTime(),
      formatted,
    };
  },
};
