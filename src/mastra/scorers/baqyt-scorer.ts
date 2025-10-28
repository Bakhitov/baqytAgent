import { createScorer } from '@mastra/core/scores';
import {
  createAnswerRelevancyScorer,
  createBiasScorer,
  createPromptAlignmentScorerLLM,
  createToxicityScorer,
} from '@mastra/evals/scorers/llm';
import {
  createKeywordCoverageScorer,
  createToneScorer,
} from '@mastra/evals/scorers/code';
import { BAQYT_EVALUATION_MODEL_ID, makeLanguageModel } from '../config/models';

type AssistantMessage = {
  content?: unknown;
};

type ConversationMessage = {
  role?: string;
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

const extractLatestUserText = (input: unknown) => {
  if (!input) {
    return '';
  }

  if (Array.isArray(input)) {
    const latestUser = [...input].reverse().find((message) => (message as ConversationMessage)?.role === 'user');
    return latestUser ? normalizeWhitespace(flattenContent((latestUser as ConversationMessage).content)) : '';
  }

  if (typeof input === 'object') {
    const maybeObject = input as { inputMessages?: unknown };
    if (Array.isArray(maybeObject.inputMessages)) {
      const latestUser = [...maybeObject.inputMessages].reverse().find(
        (message) => (message as ConversationMessage)?.role === 'user',
      );

      if (latestUser) {
        return normalizeWhitespace(flattenContent((latestUser as ConversationMessage).content));
      }
    }
  }

  return '';
};

const evaluationModel = makeLanguageModel(BAQYT_EVALUATION_MODEL_ID);
export const tenWordResponseScorer = createScorer({
  name: 'Ответ из десяти слов',
  description: 'Проверяет, что ответ содержит ровно десять слов. Қазақша: жауап 10 сөзден тұруы керек.',
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
    return `Ожидалось 10 слов, фактически ${words.length}. Ответ: "${assistantText}". Қазақша: 10 сөз болуы тиіс, алынғаны ${words.length}.`;
  });

const BRAND_PATTERNS = [/baqyt/iu, /бақыт/iu, /бакыт/iu];

export const brandMentionScorer = createScorer({
  name: 'Упоминание бренда',
  description: 'Проверяет, что Baqyt-Group упомянут в каждом ответе. Қазақша: әр жауапта Baqyt-Group аталуы керек.',
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
      ? `Бренд Baqyt-Group упомянут. Фрагмент: "${snippet}". Қазақша: бренд аталды.`
      : `Нет упоминания Baqyt-Group. Фрагмент: "${snippet}". Қазақша: бренд аталмады.`;
  });

const HOUSING_EMOJI = ['🏠', '🏡', '🏢', '🏘', '🏙', '🏚', '🏗', '🏘️', '🏙️', '🏗️', '🏠️'];

export const housingEmojiScorer = createScorer({
  name: 'Эмодзи о недвижимости',
  description: 'Нужно хотя бы одно эмодзи про дома или ЖК. Қазақша: тұрғын үй эмодзисьі болу керек.',
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
      ? 'Эмодзи недвижимости присутствует. Қазақша: тұрғын үй эмодзисьі бар.'
      : `Добавьте хотя бы одно эмодзи про недвижимость. Ответ: "${results.preprocessStepResult.assistantText}". Қазақша: тұрғын үй эмодзисьін қосыңыз.`,
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
  name: 'Приглашение на встречу',
  description: 'Контролирует, что агент зовёт клиента на встречу. Қазақша: кездесу шақыруы бар ма тексереді.',
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
      ? `Обнаружен призыв на встречу. Фрагмент: "${snippet}". Қазақша: кездесу шақыруы бар.`
      : `Нужно пригласить клиента в офис или на встречу. Фрагмент: "${snippet}". Қазақша: кездесуге шақырыңыз.`;
  });

const FORBIDDEN_PATTERNS = [
  { label: '«сегодня»', pattern: /\bсегодня\b/iu },
  { label: '«today»', pattern: /\btoday\b/iu },
];

export const forbiddenVocabularyScorer = createScorer({
  name: 'Запрещённые слова',
  description: 'Блокируем «сегодня» и today в ответах. Қазақша: «бүгін» және today қолдануға болмайды.',
  type: 'agent',
})
  .preprocess(({ run }) => {
    const assistantText = extractAssistantText(run.output as AssistantMessage[]);
    const violations = FORBIDDEN_PATTERNS.filter(({ pattern }) => pattern.test(assistantText));
    return { assistantText, violations };
  })
  .generateScore(({ results }) => (results.preprocessStepResult.violations.length === 0 ? 1 : 0))
  .generateReason(({ results, score }) =>
    score === 1
      ? 'Запрещённых слов нет. Қазақша: тыйым салынған сөздер жоқ.'
      : `Найдены запрещённые слова: ${results.preprocessStepResult.violations
          .map(({ label }) => label)
          .join(', ')}. Текст: "${results.preprocessStepResult.assistantText}". Қазақша: тыйым салынған сөздер табылды.`,
  );

const KAZAKH_PATTERN = /[әіңғүұқөһ]/iu;

export const kazakhEchoScorer = createScorer({
  name: 'Казахский отклик',
  description: 'Если клиент пишет на казахском, ответ тоже содержит казахские слова. Қазақша: клиент қазақша жазса, жауапта қазақша сөздер болу керек.',
  type: 'agent',
})
  .preprocess(({ run }) => {
    const assistantText = extractAssistantText(run.output as AssistantMessage[]);
    const latestUserText = extractLatestUserText(run.input);
    const userUsesKazakh = KAZAKH_PATTERN.test(latestUserText);
    const assistantUsesKazakh = KAZAKH_PATTERN.test(assistantText);

    return { assistantText, latestUserText, userUsesKazakh, assistantUsesKazakh };
  })
  .generateScore(({ results }) => {
    const { userUsesKazakh, assistantUsesKazakh } = results.preprocessStepResult;
    if (!userUsesKazakh) {
      return 1;
    }

    return assistantUsesKazakh ? 1 : 0;
  })
  .generateReason(({ results, score }) => {
    const { userUsesKazakh, assistantUsesKazakh, assistantText, latestUserText } =
      results.preprocessStepResult;

    if (!userUsesKazakh) {
      return `Клиент не использовал казахский язык. Ответ: "${assistantText}". Қазақша: клиент қазақша жазбады.`;
    }

    return score === 1
      ? `Клиент написал по-казахски (${latestUserText}), в ответе найдены казахские слова. Қазақша: жауапта қазақша сөздер бар.`
      : `Клиент использует казахские слова (${latestUserText}), добавьте казахское слово в ответ: "${assistantText}". Қазақша: жауапқа қазақша сөз қосыңыз.`;
  });

const BENEFIT_PATTERNS = [
  { label: 'без комиссии', pattern: /без\s+комисси/iu },
  { label: 'сопровождаем', pattern: /сопровождаем/iu },
  { label: 'сопровождение', pattern: /сопровождение/iu },
  { label: 'поддержка ипотек', pattern: /поддержк[аы]\s+ипотек/iu },
];

export const benefitReminderScorer = createScorer({
  name: 'Напоминание о выгодах',
  description: 'Каждый ответ напоминает ключевые выгоды Baqyt-Group. Қазақша: әр жауапта негізгі артықшылықтар айтылсын.',
  type: 'agent',
})
  .preprocess(({ run }) => {
    const assistantText = extractAssistantText(run.output as AssistantMessage[]);
    const matches = BENEFIT_PATTERNS.filter(({ pattern }) => pattern.test(assistantText));
    return { assistantText, matches };
  })
  .generateScore(({ results }) => (results.preprocessStepResult.matches.length > 0 ? 1 : 0))
  .generateReason(({ results, score }) =>
    score === 1
      ? `Обнаружены выгодные формулировки: ${results.preprocessStepResult.matches
          .map(({ label }) => label)
          .join(', ')}. Қазақша: негізгі артықшылықтар аталды.`
      : `Напомните о выгодах (без комиссии, сопровождение). Ответ: "${results.preprocessStepResult.assistantText}". Қазақша: артықшылықтарды (комиссия жоқ, сүйемелдеу) айтыңыз.`,
  );

const FINANCING_PATTERNS = [
  { label: 'ипотека', pattern: /ипотек/iu },
  { label: 'кредит', pattern: /кредит/iu },
  { label: 'рассрочка', pattern: /рассрочк/iu },
  { label: 'Otbasy', pattern: /Otbasy/iu },
  { label: 'Halyk', pattern: /Halyk/iu },
  { label: 'Bereke', pattern: /Bereke/iu },
  { label: 'Forte', pattern: /Forte/iu },
  { label: 'BCC', pattern: /BCC/iu },
  { label: 'Altyn', pattern: /Altyn/iu },
  { label: 'Zhusan', pattern: /Zhusan/iu },
];

export const financingMentionScorer = createScorer({
  name: 'Упоминание финансирования',
  description: 'Контролируем напоминание про банки и рассрочки. Қазақша: қаржыландыру жөнінде ақпарат берілсін.',
  type: 'agent',
})
  .preprocess(({ run }) => {
    const assistantText = extractAssistantText(run.output as AssistantMessage[]);
    const matches = FINANCING_PATTERNS.filter(({ pattern }) => pattern.test(assistantText));
    return { assistantText, matches };
  })
  .generateScore(({ results }) => (results.preprocessStepResult.matches.length > 0 ? 1 : 0))
  .generateReason(({ results, score }) =>
    score === 1
      ? `Упомянуты варианты финансирования: ${results.preprocessStepResult.matches
          .map(({ label }) => label)
          .join(', ')}. Қазақша: қаржыландыру мүмкіндіктері аталды.`
      : `Добавьте информацию о финансировании (банки или рассрочка). Ответ: "${results.preprocessStepResult.assistantText}". Қазақша: қаржыландыру туралы мәлімет қосыңыз.`,
  );

export const answerRelevancyScorer = createAnswerRelevancyScorer({
  model: evaluationModel,
});

export const promptAlignmentScorer = createPromptAlignmentScorerLLM({
  model: evaluationModel,
});

export const keywordCoverageScorer = createKeywordCoverageScorer();

export const toneConsistencyScorer = createToneScorer();

export const toxicityScorer = createToxicityScorer({
  model: evaluationModel,
});

export const biasScorer = createBiasScorer({
  model: evaluationModel,
});

export const scorers = {
  tenWordResponseScorer,
  brandMentionScorer,
  housingEmojiScorer,
  meetingInviteScorer,
  forbiddenVocabularyScorer,
  kazakhEchoScorer,
  benefitReminderScorer,
  financingMentionScorer,
  answerRelevancyScorer,
  promptAlignmentScorer,
  keywordCoverageScorer,
  toneConsistencyScorer,
  toxicityScorer,
  biasScorer,
};
