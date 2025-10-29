import type { MastraModelConfig } from '@mastra/core/llm';

export const BAQYT_PRIMARY_MODEL_ID =
  process.env.BAQYT_PRIMARY_MODEL_ID ?? 'openai/gpt-5-mini';
export const BAQYT_EVALUATION_MODEL_ID =
  process.env.BAQYT_EVALUATION_MODEL_ID ?? 'openai/gpt-5-nano';
export const BAQYT_MODERATION_MODEL_ID =
  process.env.BAQYT_MODERATION_MODEL_ID ?? 'openai/omni-moderation-latest';

export const makeLanguageModel = (modelId: string): MastraModelConfig => modelId;
