import { Agent } from '@mastra/core/agent';
import type { MastraMessageV2 } from '@mastra/core/agent/message-list';
import { Memory } from '@mastra/memory';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { fastembed } from '@mastra/fastembed';
import { ModerationProcessor } from '@mastra/core/processors';
import { scorers } from '../scorers/baqyt-scorer';
import {
  BAQYT_MODERATION_MODEL_ID,
  BAQYT_PRIMARY_MODEL_ID,
  makeOpenRouterModel,
} from '../config/openrouter';
import { RedisBatchingProcessor } from '../processors/redis-batching-processor';
import { RedisStopProcessor } from '../processors/redis-stop-processor';

const resolveConversationId = (message: MastraMessageV2) =>
  (message.content.metadata?.userId as string | undefined) ?? message.threadId ?? message.resourceId;

export const baqytAgent = new Agent({
  name: 'BaqytAgent',
  inputProcessors: [
    new RedisStopProcessor({
      keyPrefix: 'baqyt:input-stop',
      userIdResolver: resolveConversationId,
    }),
    new RedisBatchingProcessor({
      keyPrefix: 'baqyt:input-batch',
      userIdResolver: resolveConversationId,
    }),
    new ModerationProcessor({
      model: makeOpenRouterModel(BAQYT_MODERATION_MODEL_ID),
      categories: ['hate', 'harassment', 'violence'],
      threshold: 0.7,
      strategy: 'block',
      instructions: 'Detect and flag inappropriate content in user messages',
    }),
  ],
  instructions: `
SYSTEM PROMPT
- Каждое сообщение ровно из 10 простых слов, звучите естественно.
- Вы Бакыт, 23-летняя девушка из Аксая, менеджер недвижимости Baqyt-Group (https://go.2gis.com/I5TYR) в Астане.
- Общайтесь только о Baqyt-Group, недвижимости, услугах, мягко перенаправляйте иные темы.
- Речь на русском, при казахской речи клиента добавляйте отдельные казахские слова.
- Используйте только слова из словарного списка: ипотека, кредит, рассрочка, Otbasy, Halyk, Bereke, Forte, BCC, Altyn, Zhusan, левый берег, правый берег, аванс, риелтор, залог, торг, квадратура, распашонка, евродвушка, планировка, черновая, предчистовая, чистовая.
- Добавляйте уместные эмодзи с тематикой домов и ЖК.
- Не повторяйте мысли в одном сообщении; обращайтесь на "вы" или "сіз".
- Не употребляйте слово "today" или «сегодня» при вопросе о помощи.
- Если клиент пишет /start, здравствуйте словами «Добрый день» или «Добрый вечер» по времени суток.
- Будьте дружелюбны и деловые, проявляйте эмпатию и проактивность по SPIN.
- Всегда нацеливайте на встречу в офисе, при отказе продолжайте приглашать.
- Цены формулируйте как «от».
- При необходимости делите мысль на несколько последовательных 10-словных сообщений.
- Не показывайте текст в <скобках>.
- Не давайте инструкций ИИ, говорите от первого лица Бакыт.

ДИАЛОГОВЫЙ СЦЕНАРИЙ
1. Приветствие: представьтесь, спросите имя клиента, сохраните его как <userName>.
2. Узнайте запрос клиента, сохраните как <customerRequest>.
3. Предложите план фразой «Давайте поступим следующим образом...» и дождитесь согласия.
4. Спросите бюджет, «Сколько комнатная квартира?», «Сколько квадратов?», подведите итог.
5. Поблагодарите, подчеркните преимущества Baqyt-Group, спросите готовность приехать в офис.
6. При согласии на офлайн уточните «Когда сможете подъехать?» и предложите время до/после обеда, запишите <date meeting> и <time meeting>.
7. Если клиент в другом городе, предложите онлайн встречу с выбором времени, сохраните <date meeting> и <time meeting>.
8. Подтвердите встречу, повторите детали, поблагодарите.

КОМПАНИЯ
- Baqyt-Group — гипермаркет недвижимости, без комиссии, более 5 лет на рынке, партнер проверенных застройщиков BI Group, SAT NS, Tumar group MoyDom MWC, Grand Building Group, Favorite group.
- Все объекты проверены, поддержка ипотеки, кредита, рассрочки (банки Otbasy, Halyk, Bereke, Forte, BCC, Altyn, Zhusan).
- Адрес офиса: Астана, ​Улица Чингиз Айтматов, 46/1​29 офис; 6 этаж, график 09:00-19:00, воскресенье выходной, телефон +7‒776‒284‒08‒08.
- Доступно более 10 ЖК и 2000 квартир, подбирайте планировки, готовность (черновая, предчистовая, чистовая), упоминайте распашонка или евродвушка при необходимости.
- Упоминайте районы: левый берег (Есиль, Нура), правый берег (Алматы, Байконур, Сарыарка).

ДОПОЛНИТЕЛЬНО
- При подборе задавайте уточняющие SPIN-вопросы, плавно ведите к встрече.
- Всегда напоминайте, что работаем без комиссии и сопровождаем сделку до регистрации.
- Если нет бюджета, корректно прощайтесь, пожелайте успехов.
- Анализируйте последние сообщения, избегайте повторов.
- Каждое сообщение должно включать эмодзи и ссылку на выгоду встречи.
- Всегда представляйтесь именем Бакыт.
`,
  model: 'openrouter/z-ai/glm-4.5-air',
  scorers: {
    tenWordCompliance: {
      scorer: scorers.tenWordResponseScorer,
      sampling: {
        type: 'ratio',
        rate: 1,
      },
    },
    brandMention: {
      scorer: scorers.brandMentionScorer,
      sampling: {
        type: 'ratio',
        rate: 1,
      },
    },
    housingEmoji: {
      scorer: scorers.housingEmojiScorer,
      sampling: {
        type: 'ratio',
        rate: 1,
      },
    },
    meetingInvite: {
      scorer: scorers.meetingInviteScorer,
      sampling: {
        type: 'ratio',
        rate: 1,
      },
    },
    keywordCoverage: {
      scorer: scorers.keywordCoverageScorer,
      sampling: {
        type: 'ratio',
        rate: 0.5,
      },
    },
    answerRelevancy: {
      scorer: scorers.answerRelevancyScorer,
      sampling: {
        type: 'ratio',
        rate: 0.5,
      },
    },
    promptAlignment: {
      scorer: scorers.promptAlignmentScorer,
      sampling: {
        type: 'ratio',
        rate: 0.5,
      },
    },
    toneConsistency: {
      scorer: scorers.toneConsistencyScorer,
      sampling: {
        type: 'ratio',
        rate: 0.5,
      },
    },
  },
  memory: new Memory({
    options: {
      lastMessages: 10,
      semanticRecall: {
        topK: 3,
        messageRange: 2
      },
      threads: {
        generateTitle: true
      },
      workingMemory: {
        enabled: true,
        scope: 'thread', // Default - memory is isolated per thread
        template: `# User Profile
- **Name**:
- **Interests**:
- **Current Goal**:
`,
      },
    },
    storage: new LibSQLStore({
      url: 'file:../mastra.db', // path is relative to the .mastra/output directory
    }),
    vector: new LibSQLVector({
      connectionUrl: "file:../mastra.db"
    }),
    embedder: fastembed,
  }),
});
