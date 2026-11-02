import type { Config } from '../config.ts';
import { createAnthropicProvider } from './anthropic.ts';
import { createMockProvider } from './mock.ts';
import { createOpenAiProvider } from './openai.ts';
import { createXaiProvider } from './xai.ts';
import type { LlmProvider } from './types.ts';

export function createProvider(config: Config): LlmProvider {
  switch (config.llmProvider) {
    case 'openai':
      if (!config.openAiApiKey) {
        throw new Error('OPENAI_API_KEY is required for the openai provider.');
      }
      return createOpenAiProvider({
        apiKey: config.openAiApiKey,
        baseUrl: config.openAiBaseUrl,
        model: config.openAiModel,
      });
    case 'anthropic':
      if (!config.anthropicApiKey) {
        throw new Error('ANTHROPIC_API_KEY is required for the anthropic provider.');
      }
      return createAnthropicProvider({
        apiKey: config.anthropicApiKey,
        baseUrl: config.anthropicBaseUrl,
        model: config.anthropicModel,
      });
    case 'xai':
      if (!config.xaiApiKey) {
        throw new Error('XAI_API_KEY is required for the xai provider.');
      }
      return createXaiProvider({
        apiKey: config.xaiApiKey,
        baseUrl: config.xaiBaseUrl,
        model: config.xaiModel,
      });
    case 'mock':
      return createMockProvider();
    default: {
      const exhaustive: never = config.llmProvider;
      throw new Error(`Unsupported provider: ${String(exhaustive)}`);
    }
  }
}
