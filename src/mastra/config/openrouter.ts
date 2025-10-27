const ensureEnv = (key: string): string => {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(
      `[BaqytAgent] Missing required environment variable "${key}". Add it to your .env before running Mastra.`,
    );
  }
  return value;
};

const OPENROUTER_API_KEY = ensureEnv('OPENROUTER_API_KEY');

const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
const OPENROUTER_REFERRER = process.env.OPENROUTER_REFERRER ?? 'https://baqyt-group.kz';
const OPENROUTER_APP_TITLE = process.env.OPENROUTER_APP_TITLE ?? 'BaqytAgent';

export const BAQYT_PRIMARY_MODEL_ID =
  process.env.BAQYT_PRIMARY_MODEL_ID ?? 'z-ai/glm-4.5-air';
export const BAQYT_EVALUATION_MODEL_ID =
  process.env.BAQYT_EVALUATION_MODEL_ID ?? 'anthropic/claude-3.5-haiku';
export const BAQYT_MODERATION_MODEL_ID =
  process.env.BAQYT_MODERATION_MODEL_ID ?? 'openai/gpt-4o-mini';

/**
 * Builds a Mastra-compatible OpenRouter model configuration.
 * Reference: frameworks/agentic-uis/openrouter.mdx
 */
export const makeOpenRouterModel = (modelId: string) => ({
  providerId: 'openrouter',
  modelId,
  url: OPENROUTER_BASE_URL,
  apiKey: OPENROUTER_API_KEY,
  headers: {
    'HTTP-Referer': OPENROUTER_REFERRER,
    'X-Title': OPENROUTER_APP_TITLE,
  },
});

