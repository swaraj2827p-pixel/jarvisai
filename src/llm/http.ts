import { ProviderError, type Usage } from './types.ts';

export async function postJson(
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    const timedOut =
      error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new ProviderError(
      provider,
      timedOut
        ? `${provider} request timed out.`
        : `${provider} request failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300).trim();
    throw new ProviderError(
      provider,
      `${provider} request failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
    );
  }

  try {
    return (await response.json()) as unknown;
  } catch (error) {
    throw new ProviderError(provider, `${provider} returned a response that was not JSON.`, {
      cause: error,
    });
  }
}

export function normalizeUsage(
  promptTokens?: number,
  completionTokens?: number,
  totalTokens?: number,
): Usage {
  const prompt = Math.max(0, promptTokens ?? 0);
  const completion = Math.max(0, completionTokens ?? 0);
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: Math.max(0, totalTokens ?? prompt + completion),
  };
}
