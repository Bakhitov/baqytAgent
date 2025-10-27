import { createScorer } from '@mastra/core/scores';
import {
  createAnswerRelevancyScorer,
  createPromptAlignmentScorerLLM,
} from '@mastra/evals/scorers/llm';
import {
  createKeywordCoverageScorer,
  createToneScorer,
} from '@mastra/evals/scorers/code';
import { BAQYT_EVALUATION_MODEL_ID, makeOpenRouterModel } from '../config/openrouter';

type AssistantMessage = {
  content?: unknown;
};

const normalizeWhitespace = (value: string) => value.trim().replace(/\s+/g, ' ');

const flattenContent = (value: unknown): string => {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(flattenContent).join(' ');
  }

  if (typeof value === 'object') {
    const maybeRecord = value as Record<string, unknown>;

    if (typeof maybeRecord.text === 'string') {
      return maybeRecord.text;
    }

    const content = maybeRecord.content;

    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content.map(flattenContent).join(' ');
    }

    if (Array.isArray(maybeRecord.parts)) {
      return maybeRecord.parts.map(flattenContent).join(' ');
    }

    if (typeof maybeRecord.value === 'string') {
      return maybeRecord.value;
    }
  }

  return '';
};

const extractAssistantText = (output: AssistantMessage[] | undefined) => {
  if (!Array.isArray(output) || output.length === 0) {
    return '';
  }

  const aggregated = output
    .map((message) => flattenContent(message?.content))
    .filter((content) => content && content.trim().length > 0)
    .join(' ');

  return normalizeWhitespace(aggregated);
};

const evaluationModel = makeOpenRouterModel(BAQYT_EVALUATION_MODEL_ID);
export const tenWordResponseScorer = createScorer({
  name: 'Ten Word Compliance',
  description: 'Validates that the agent answers with exactly ten words.',
  type: 'agent',
})
  .preprocess(({ run }) => {
    const assistantText = extractAssistantText(run.output as AssistantMessage[]);
    const words = assistantText.length ? assistantText.split(' ') : [];
    return { assistantText, words };
  })
  .generateScore(({ results }) => (results.preprocessStepResult.words.length === 10 ? 1 : 0))
  .generateReason(({ results }) => {
    const { assistantText, words } = results.preprocessStepResult;
    return `Expected 10 words, received ${words.length}. Response: "${assistantText}"`;
  });

const BRAND_PATTERNS = [/baqyt/iu, /бақыт/iu, /бакыт/iu];

export const brandMentionScorer = createScorer({
  name: 'Brand Mention Compliance',
  description: 'Ensures Baqyt-Group is mentioned in every response.',
  type: 'agent',
})
  .preprocess(({ run }) => {
    const assistantText = extractAssistantText(run.output as AssistantMessage[]);
    return { assistantText };
  })
  .generateScore(({ results }) =>
    BRAND_PATTERNS.some((pattern) => pattern.test(results.preprocessStepResult.assistantText))
      ? 1
      : 0,
  )
  .generateReason(({ results, score }) => {
    const snippet = results.preprocessStepResult.assistantText.slice(0, 160);
    return score === 1
      ? `Baqyt-Group mentioned. Snippet: "${snippet}"`
      : `Brand mention missing. Snippet: "${snippet}"`;
  });

const HOUSING_EMOJI = ['🏠', '🏡', '🏢', '🏘', '🏙', '🏚', '🏗', '🏘️', '🏙️', '🏗️', '🏠️'];

export const housingEmojiScorer = createScorer({
  name: 'Housing Emoji Presence',
  description: 'Checks that at least one relevant housing emoji is present.',
  type: 'agent',
})
  .preprocess(({ run }) => {
    const assistantText = extractAssistantText(run.output as AssistantMessage[]);
    const containsEmoji = HOUSING_EMOJI.some((emoji) => assistantText.includes(emoji));
    return { assistantText, containsEmoji };
  })
  .generateScore(({ results }) => (results.preprocessStepResult.containsEmoji ? 1 : 0))
  .generateReason(({ results, score }) =>
    score === 1
      ? 'Housing emoji detected in response.'
      : `Add at least one housing-related emoji. Response: "${results.preprocessStepResult.assistantText}"`,
  );

const MEETING_PATTERNS = [
  'встрет',
  'офис',
  'подъед',
  'приед',
  'приход',
  'кездес',
  'келіңіз',
  'зустр',
];

export const meetingInviteScorer = createScorer({
  name: 'Meeting Invitation',
  description: 'Evaluates whether the agent nudges the client toward a meeting.',
  type: 'agent',
})
  .preprocess(({ run }) => {
    const assistantText = extractAssistantText(run.output as AssistantMessage[]).toLowerCase();
    return { assistantText };
  })
  .generateScore(({ results }) =>
    MEETING_PATTERNS.some((pattern) => results.preprocessStepResult.assistantText.includes(pattern))
      ? 1
      : 0,
  )
  .generateReason(({ results, score }) => {
    const snippet = results.preprocessStepResult.assistantText.slice(0, 160);
    return score === 1
      ? `Meeting CTA detected. Snippet: "${snippet}"`
      : `Invite the client to the office or a meeting. Snippet: "${snippet}"`;
  });

export const answerRelevancyScorer = createAnswerRelevancyScorer({
  model: evaluationModel,
});

export const promptAlignmentScorer = createPromptAlignmentScorerLLM({
  model: evaluationModel,
});

export const keywordCoverageScorer = createKeywordCoverageScorer();

export const toneConsistencyScorer = createToneScorer();

export const scorers = {
  tenWordResponseScorer,
  brandMentionScorer,
  housingEmojiScorer,
  meetingInviteScorer,
  answerRelevancyScorer,
  promptAlignmentScorer,
  keywordCoverageScorer,
  toneConsistencyScorer,
};
