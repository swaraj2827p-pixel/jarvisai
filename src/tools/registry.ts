import { z } from 'zod';
import type { ToolDefinition } from '../llm/types.ts';

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  run(rawArguments: unknown): Promise<unknown>;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface ToolRegistry {
  definitions(): ToolDefinition[];
  run(name: string, arguments_: Record<string, unknown>): Promise<ToolResult>;
}

export function createToolRegistry(tools: Tool[]): ToolRegistry {
  const index = new Map<string, Tool>();
  for (const tool of tools) {
    if (index.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
    index.set(tool.name, tool);
  }

  return {
    definitions() {
      return [...index.values()].map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));
    },
    async run(name, rawArguments) {
      const tool = index.get(name);
      if (!tool) return { ok: false, error: `Unknown tool "${name}".` };
      try {
        return { ok: true, data: await tool.run(rawArguments) };
      } catch (error) {
        return { ok: false, error: describeError(error) };
      }
    },
  };
}

function describeError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`)
      .join('; ');
  }
  return error instanceof Error ? error.message : String(error);
}
