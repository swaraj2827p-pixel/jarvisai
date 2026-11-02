import type { MemoryStore } from '../memory/memory-store.ts';
import { calculateTool } from './calculator.ts';
import { currentTimeTool } from './current-time.ts';
import { createRecallTool, createRememberTool } from './memory.ts';
import { systemInfoTool } from './system-info.ts';
import { createToolRegistry, type ToolRegistry } from './registry.ts';

export type { ToolRegistry } from './registry.ts';

export function createDefaultToolRegistry(memory: MemoryStore): ToolRegistry {
  return createToolRegistry([
    currentTimeTool,
    calculateTool,
    systemInfoTool,
    createRememberTool(memory),
    createRecallTool(memory),
  ]);
}
