import { z } from 'zod';
import type { MemoryStore } from '../memory/memory-store.ts';
import type { Tool } from './registry.ts';

const rememberSchema = z
  .object({
    key: z.string().trim().min(1).max(64),
    value: z.string().trim().min(1).max(2000),
  })
  .strict();

const recallSchema = z
  .object({
    key: z.string().trim().min(1).max(64),
  })
  .strict();

export function createRememberTool(memory: MemoryStore): Tool {
  return {
    name: 'remember',
    description:
      'Permanently remember a fact about the user. Use this whenever the user asks you to remember something.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Short label for the fact.' },
        value: { type: 'string', description: 'What to remember.' },
      },
      required: ['key', 'value'],
      additionalProperties: false,
    },
    async run(rawArguments) {
      const { key, value } = rememberSchema.parse(rawArguments);
      const stored = await memory.remember(key, value);
      return { remembered: true, ...stored };
    },
  };
}

export function createRecallTool(memory: MemoryStore): Tool {
  return {
    name: 'recall',
    description: 'Recall something you previously remembered about the user.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Label to look up.' },
      },
      required: ['key'],
      additionalProperties: false,
    },
    async run(rawArguments) {
      const { key } = recallSchema.parse(rawArguments);
      const value = memory.recall(key);
      return value === undefined ? { found: false, key } : { found: true, key, value };
    },
  };
}
