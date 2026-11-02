import { createOpenAiProvider, type OpenAiProviderOptions } from './openai.ts';
import type { LlmProvider } from './types.ts';

export function createXaiProvider(options: OpenAiProviderOptions): LlmProvider {
  return createOpenAiProvider({
    ...options,
    providerName: 'xai',
    maxTokensField: 'max_tokens',
  });
}
