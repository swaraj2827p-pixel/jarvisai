import { createOpenAiProvider, type OpenAiProviderOptions } from './openai.ts';
import type { LlmProvider } from './types.ts';

export function createGeminiProvider(options: OpenAiProviderOptions): LlmProvider {
  return createOpenAiProvider({
    ...options,
    providerName: 'gemini',
    maxTokensField: 'max_tokens',
  });
}
