import type { MastraModelConfig } from '@mastra/core/llm';

export const BAQYT_PRIMARY_MODEL_ID =
  process.env.BAQYT_PRIMARY_MODEL_ID ?? 'openrouter/z-ai/glm-4.5-air';
export const BAQYT_EVALUATION_MODEL_ID =
  process.env.BAQYT_EVALUATION_MODEL_ID ?? 'openai/gpt-4o-mini';
export const BAQYT_MODERATION_MODEL_ID =
  process.env.BAQYT_MODERATION_MODEL_ID ?? 'openai/gpt-4o-mini';

export const makeLanguageModel = (modelId: string): MastraModelConfig => modelId;
