import { z } from 'zod';

export type LlmProviderName = 'mock' | 'openai' | 'anthropic' | 'xai' | 'gemini';

export interface Config {
  port: number;
  host: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  bodyLimitBytes: number;
  llmProvider: LlmProviderName;
  llmTimeoutMs: number;
  openAiApiKey?: string;
  openAiBaseUrl: string;
  openAiModel: string;
  anthropicApiKey?: string;
  anthropicBaseUrl: string;
  anthropicModel: string;
  xaiApiKey?: string;
  xaiBaseUrl: string;
  xaiModel: string;
  geminiApiKey?: string;
  geminiBaseUrl: string;
  geminiModel: string;
  apiKey?: string;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  maxToolIterations: number;
  sessionTtlMs: number;
  maxSessionMessages: number;
  memoryFile: string;
}

const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

const EnvSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    HOST: z.string().trim().min(1).default('127.0.0.1'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(262_144),
    LLM_PROVIDER: z.enum(['mock', 'openai', 'anthropic', 'xai', 'gemini']).default('mock'),
    LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    OPENAI_API_KEY: optionalString,
    OPENAI_BASE_URL: z.string().trim().min(1).default('https://api.openai.com/v1'),
    OPENAI_MODEL: z.string().trim().min(1).default('gpt-4o-mini'),
    ANTHROPIC_API_KEY: optionalString,
    ANTHROPIC_BASE_URL: z.string().trim().min(1).default('https://api.anthropic.com'),
    ANTHROPIC_MODEL: z.string().trim().min(1).default('claude-3-5-haiku-latest'),
    XAI_API_KEY: optionalString,
    XAI_BASE_URL: z.string().trim().min(1).default('https://api.x.ai/v1'),
    XAI_MODEL: z.string().trim().min(1).default('grok-4'),
    GEMINI_API_KEY: optionalString,
    GEMINI_BASE_URL: z
      .string()
      .trim()
      .min(1)
      .default('https://generativelanguage.googleapis.com/v1beta/openai'),
    GEMINI_MODEL: z.string().trim().min(1).default('gemini-2.5-flash'),
    JARVIS_API_KEY: optionalString,
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    MAX_TOOL_ITERATIONS: z.coerce.number().int().min(1).max(10).default(6),
    SESSION_TTL_MS: z.coerce.number().int().positive().default(3_600_000),
    MAX_SESSION_MESSAGES: z.coerce.number().int().min(4).max(500).default(40),
    MEMORY_FILE: z.string().trim().min(1).default('data/jarvis-memory.json'),
  })
  .superRefine((env, ctx) => {
    if (env.LLM_PROVIDER === 'openai' && !env.OPENAI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        message: 'required when LLM_PROVIDER=openai',
        path: ['OPENAI_API_KEY'],
      });
    }
    if (env.LLM_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        message: 'required when LLM_PROVIDER=anthropic',
        path: ['ANTHROPIC_API_KEY'],
      });
    }
    if (env.LLM_PROVIDER === 'xai' && !env.XAI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        message: 'required when LLM_PROVIDER=xai',
        path: ['XAI_API_KEY'],
      });
    }
    if (env.LLM_PROVIDER === 'gemini' && !env.GEMINI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        message: 'required when LLM_PROVIDER=gemini',
        path: ['GEMINI_API_KEY'],
      });
    }
  });

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${details}`);
  }

  const value = parsed.data;
  return {
    port: value.PORT,
    host: value.HOST,
    logLevel: value.LOG_LEVEL,
    bodyLimitBytes: value.BODY_LIMIT_BYTES,
    llmProvider: value.LLM_PROVIDER,
    llmTimeoutMs: value.LLM_TIMEOUT_MS,
    openAiApiKey: value.OPENAI_API_KEY,
    openAiBaseUrl: value.OPENAI_BASE_URL,
    openAiModel: value.OPENAI_MODEL,
    anthropicApiKey: value.ANTHROPIC_API_KEY,
    anthropicBaseUrl: value.ANTHROPIC_BASE_URL,
    anthropicModel: value.ANTHROPIC_MODEL,
    xaiApiKey: value.XAI_API_KEY,
    xaiBaseUrl: value.XAI_BASE_URL,
    xaiModel: value.XAI_MODEL,
    geminiApiKey: value.GEMINI_API_KEY,
    geminiBaseUrl: value.GEMINI_BASE_URL,
    geminiModel: value.GEMINI_MODEL,
    apiKey: value.JARVIS_API_KEY,
    rateLimitMax: value.RATE_LIMIT_MAX,
    rateLimitWindowMs: value.RATE_LIMIT_WINDOW_MS,
    maxToolIterations: value.MAX_TOOL_ITERATIONS,
    sessionTtlMs: value.SESSION_TTL_MS,
    maxSessionMessages: value.MAX_SESSION_MESSAGES,
    memoryFile: value.MEMORY_FILE,
  };
}
