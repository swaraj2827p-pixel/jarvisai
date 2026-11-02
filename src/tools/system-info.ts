import { arch, cpus, freemem, platform, release, totalmem } from 'node:os';
import type { Tool } from './registry.ts';

export const systemInfoTool: Tool = {
  name: 'get_system_info',
  description:
    'Get basic information about the machine running Jarvis: operating system, CPU, memory, Node.js version and uptime.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  async run() {
    const cores = cpus();
    return {
      platform: platform(),
      release: release(),
      architecture: arch(),
      cpuModel: cores[0]?.model.trim() ?? 'unknown',
      cpuCores: cores.length,
      totalMemoryMb: Math.round(totalmem() / (1024 * 1024)),
      freeMemoryMb: Math.round(freemem() / (1024 * 1024)),
      nodeVersion: process.version,
      uptimeSeconds: Math.round(process.uptime()),
    };
  },
};
