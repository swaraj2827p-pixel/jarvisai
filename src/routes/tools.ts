import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { ToolRegistry } from '../tools/registry.ts';

export function createToolRoutes(tools: ToolRegistry): FastifyPluginAsync {
  return async (app: FastifyInstance) => {
    app.get('/tools', async () => ({ tools: tools.definitions() }));
  };
}
