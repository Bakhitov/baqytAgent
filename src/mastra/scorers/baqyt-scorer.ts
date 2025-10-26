import { createScorer } from '@mastra/core/scores';

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ');

export const tenWordResponseScorer = createScorer({
  name: 'Ten Word Compliance',
  description: 'Ensures the assistant responds using exactly ten words.',
  type: 'agent',
})
  .preprocess(({ run }) => {
    const assistantText = (run.output?.[0]?.content as string) || '';
    return { assistantText };
  })
  .generateScore(({ results }) => {
    const text = normalize(results.preprocessStepResult.assistantText);
    const words = text.length ? text.split(' ') : [];
    return words.length === 10 ? 1 : 0;
  })
  .generateReason(({ results }) => {
    const text = normalize(results.preprocessStepResult.assistantText);
    const words = text.length ? text.split(' ') : [];
    return `Expected 10 words, received ${words.length}. Response: "${text}"`;
  });

export const companyMentionScorer = createScorer({
  name: 'Company Mention Compliance',
  description: 'Checks that the assistant highlights Shefer-Group in every response.',
  type: 'agent',
})
  .preprocess(({ run }) => {
    const assistantText = ((run.output?.[0]?.content as string) || '').toLowerCase();
    return { assistantText };
  })
  .generateScore(({ results }) => {
    const text = results.preprocessStepResult.assistantText;
    const hasShefer = text.includes('shefer') || text.includes('шефер');
    return hasShefer ? 1 : 0;
  })
  .generateReason(({ results, score }) => {
    const snippet = normalize(results.preprocessStepResult.assistantText).slice(0, 120);
    return score === 1
      ? `Shefer-Group mentioned. Snippet: "${snippet}"`
      : `Shefer-Group not mentioned. Snippet: "${snippet}"`;
  });

export const scorers = {
  tenWordResponseScorer,
  companyMentionScorer,
};
