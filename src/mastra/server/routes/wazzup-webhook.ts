import type { Agent } from '@mastra/core/agent';
import { registerApiRoute } from '@mastra/core/server';
import type { Context } from 'hono';
import { baqytAgent } from '../../agents/baqyt-agent';
import {
  UnauthorizedWebhookError,
  WazzupWebhookService,
  type WazzupWebhookPayload,
  type WazzupMessage,
} from '../services/wazzup-webhook-service';
import { WazzupMediaService } from '../services/wazzup-media-service';

const DEFAULT_WEBHOOK_PATH = '/webhooks/wazzup';

const resolveWebhookPath = () => process.env.WAZZUP_WEBHOOK_PATH ?? DEFAULT_WEBHOOK_PATH;
const WAZZUP_MESSAGE_URL = process.env.WAZZUP_MESSAGE_API_URL ?? 'https://api.wazzup24.com/v3/message';
const WAZZUP_API_TOKEN = process.env.WAZZUP_API_TOKEN;
type RouteLogger = {
  info?: (message?: unknown, ...meta: unknown[]) => void;
  warn?: (message?: unknown, ...meta: unknown[]) => void;
  error?: (message?: unknown, ...meta: unknown[]) => void;
  debug?: (message?: unknown, ...meta: unknown[]) => void;
};

const makeLogger = (logger?: RouteLogger) => ({
  info(message: string, meta?: Record<string, unknown>) {
    if (typeof logger?.info === 'function') {
      meta ? logger.info(meta, message) : logger.info(message);
      return;
    }
    console.log(`[WazzupRoute] ${message}`, meta ?? '');
  },
  warn(message: string, meta?: Record<string, unknown>) {
    if (typeof logger?.warn === 'function') {
      meta ? logger.warn(meta, message) : logger.warn(message);
      return;
    }
    console.warn(`[WazzupRoute] ${message}`, meta ?? '');
  },
  error(message: string, meta?: Record<string, unknown>) {
    if (typeof logger?.error === 'function') {
      meta ? logger.error(meta, message) : logger.error(message);
      return;
    }
    console.error(`[WazzupRoute] ${message}`, meta ?? '');
  },
  debug(message: string, meta?: Record<string, unknown>) {
    if (typeof logger?.debug === 'function') {
      meta ? logger.debug(meta, message) : logger.debug(message);
      return;
    }
    console.debug(`[WazzupRoute] ${message}`, meta ?? '');
  },
});
const resolveTargetChatIds = () => {
  const fromEnv = process.env.WAZZUP_TARGET_CHAT_IDS;
  if (fromEnv && fromEnv.trim().length) {
    return fromEnv
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }

  return ['77066318623', '77475318623'];
};

type WazzupOutboundPayload = {
  channelId: string;
  chatType: string;
  chatId: string;
  text: string;
  refMessageId?: string;
};

const shouldHandleMessage = (message: WazzupMessage, allowedChatIds: string[]) => {
  if (message.isEcho) {
    return false;
  }

  if (message.status && message.status !== 'inbound') {
    return false;
  }

  if (!message.chatId) {
    return false;
  }

  if (!allowedChatIds.length) {
    return false;
  }

  return allowedChatIds.includes(message.chatId);
};

const resolveMessageText = async (
  message: WazzupMessage,
  mediaService: WazzupMediaService,
): Promise<string | null> => {
  const segments: string[] = [];

  const originalText = typeof message.text === 'string' ? message.text.trim() : '';
  if (originalText) {
    segments.push(originalText);
  }

  if (message.contentUri && message.type === 'audio') {
    const transcript = await mediaService.transcribeAudioFromUrl(message.contentUri);
    if (transcript) {
      segments.push(`Транскрипция аудио клиента: ${transcript}`);
    } else {
      segments.push(`Клиент отправил аудио. Ссылка: ${message.contentUri}`);
    }
  } else if (message.contentUri && message.type === 'image') {
    const description = await mediaService.describeImageFromUrl(message.contentUri);
    if (description) {
      segments.push(`Описание изображения: ${description}`);
    } else {
      segments.push(`Клиент отправил изображение. Ссылка: ${message.contentUri}`);
    }
  } else if (!segments.length && message.contentUri) {
    const kind = message.type ?? 'content';
    segments.push(`Клиент отправил ${kind}. Ссылка: ${message.contentUri}`);
  }

  return segments.length ? segments.join('\n\n') : null;
};

type AssistantUiMessage = {
  role?: unknown;
  content?: unknown;
};

type AssistantMessagePart = {
  type?: unknown;
  text?: unknown;
};

const extractAssistantReplies = async (result: Awaited<ReturnType<Agent['generate']>>): Promise<string[]> => {
  const replies: string[] = [];
  let uiMessages: unknown;

  let response: unknown;
  try {
    response = await result.response;
  } catch {
    response = undefined;
  }

  if (response && typeof response === 'object') {
    uiMessages = (response as { uiMessages?: unknown })?.uiMessages;
  }

  if (Array.isArray(uiMessages)) {
    const candidateMessages = uiMessages as AssistantUiMessage[];
    for (const rawMessage of candidateMessages) {
      if ((rawMessage?.role as string | undefined) !== 'assistant') {
        continue;
      }

      const content = Array.isArray(rawMessage?.content) ? (rawMessage.content as AssistantMessagePart[]) : [];
      const text = content
        .map((part) => {
          if ((part?.type as string | undefined) !== 'text') {
            return null;
          }

          const value = typeof part?.text === 'string' ? part.text.trim() : '';
          return value.length ? value : null;
        })
        .filter((value): value is string => Boolean(value))
        .join('\n');

      if (text.length) {
        replies.push(text);
      }
    }
  }

  if (!replies.length) {
    try {
      const text = await result.text;
      if (typeof text === 'string' && text.trim()) {
        replies.push(text.trim());
      }
    } catch {
      // ignore
    }
  }

  return replies;
};

const sendReplyToWazzup = async (payload: WazzupOutboundPayload, logger?: RouteLogger) => {
  const log = makeLogger(logger);

  if (!WAZZUP_API_TOKEN) {
    log.warn('WAZZUP_API_TOKEN is not configured; skip sending reply');
    return;
  }

  try {
    log.info('Отправляем ответ в Wazzup', {
      chatId: payload.chatId,
      channelId: payload.channelId,
      refMessageId: payload.refMessageId,
      textPreview: payload.text?.slice(0, 200),
    });

    const response = await fetch(WAZZUP_MESSAGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${WAZZUP_API_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response
        .clone()
        .json()
        .catch(async () => response.text().catch(() => undefined));

      log.error('Failed to send Wazzup reply', {
        status: response.status,
        statusText: response.statusText,
        body: errorBody,
      });
      return;
    }

    log.info('Отправлен ответ в Wazzup', {
      chatId: payload.chatId,
      messageId: payload.refMessageId,
    });
  } catch (error) {
    log.error('Ошибка при отправке ответа в Wazzup', {
      error: error instanceof Error ? error.stack ?? error.message : error,
      chatId: payload.chatId,
    });
  }
};

const processInboundMessages = async ({
  messages,
  agent,
  logger,
}: {
  messages: WazzupMessage[];
  agent: Agent;
  logger?: RouteLogger;
}) => {
  const log = makeLogger(logger);
  const allowedChatIds = resolveTargetChatIds();
  const mediaService = new WazzupMediaService({ logger });

  for (const message of messages) {
    if (!shouldHandleMessage(message, allowedChatIds)) {
      continue;
    }

    if (!message.chatId || !message.channelId || !message.chatType) {
      log.warn('Пропускаем Wazzup сообщение без chatId, channelId или chatType', {
        messageId: message.messageId,
      });
      continue;
    }

    const userText = await resolveMessageText(message, mediaService);
    if (!userText) {
      log.debug('Не удалось извлечь текст из сообщения Wazzup', {
        messageId: message.messageId,
        type: message.type,
      });
      continue;
    }

    try {
      log.info('Передаём входящее сообщение в BaqytAgent', {
        messageId: message.messageId,
        chatId: message.chatId,
        text: userText,
      });

      const agentResult = await agent.generate(
        [
          {
            role: 'user',
            content: [{ type: 'text', text: userText }],
            metadata: {
              userId: message.chatId,
              wazzupMessageId: message.messageId,
              wazzupChannelId: message.channelId,
              wazzupChatType: message.chatType,
            },
          },
        ],
        {
          memory: {
            thread: message.chatId,
            resource: 'wazzup',
          },
          runId: `wazzup-${message.messageId}`,
        },
      );

      const replies = await extractAssistantReplies(agentResult);
      log.info('Ответы BaqytAgent перед отправкой в Wazzup', {
        messageId: message.messageId,
        replies,
      });

      if (!replies.length) {
        log.warn('Агент вернул пустой ответ, пропускаем отправку в Wazzup', {
          messageId: message.messageId,
        });
        continue;
      }

      for (const reply of replies) {
        await sendReplyToWazzup(
          {
            channelId: message.channelId,
            chatType: message.chatType,
            chatId: message.chatId,
            text: reply,
           // refMessageId: message.messageId, - отвечать на конкретное сообщение отключено
          },
          logger,
        );
      }
    } catch (error) {
      log.error('Ошибка при обработке сообщения Wazzup агентом', {
        error: error instanceof Error ? error.stack ?? error.message : error,
        messageId: message.messageId,
      });
    }
  }
};

export const wazzupWebhookRoute = registerApiRoute(resolveWebhookPath(), {
  method: 'POST',
  handler: async (c: Context) => {
    const mastra = c.get('mastra');
    const logger = mastra?.logger ?? (c.get('logger') as RouteLogger | undefined);
    const log = makeLogger(logger);

    let payload: WazzupWebhookPayload;
    try {
      payload = (await c.req.json()) as WazzupWebhookPayload;
    } catch (error) {
      log.error('Failed to parse Wazzup webhook payload', {
        error: error instanceof Error ? error.stack ?? error.message : error,
      });
      return c.json({ ok: false, error: 'invalid_json' }, 400);
    }

    const service = new WazzupWebhookService({
      expectedAuthToken: process.env.WAZZUP_WEBHOOK_AUTH_TOKEN,
      logger,
    });

    try {
      const result = await service.handleWebhook(payload, {
        authorization: c.req.header('authorization'),
      });

      if (result.type === 'webhook' && result.inboundMessages.length) {
        const agent = mastra?.agents?.baqytAgent ?? baqytAgent;
        if (!agent) {
          log.warn('Не удалось получить экземпляр агента Baqyt, ответы в Wazzup не будут отправлены');
        } else {
          // Обрабатываем последовательно, чтобы сохранять порядок сообщений и контекст памяти.
          await processInboundMessages({
            messages: result.inboundMessages,
            agent,
            logger,
          });
        }
      }

      if (result.type === 'test') {
        return c.json({ ok: true });
      }

      return c.json(
        {
          ok: true,
          summary: {
            messages: result.messages.length,
            inboundMessages: result.inboundMessages.length,
          },
        },
        200,
      );
    } catch (error) {
      if (error instanceof UnauthorizedWebhookError) {
        log.warn('Blocked unauthorized Wazzup webhook request');
        return c.json({ ok: false, error: 'unauthorized' }, 401);
      }

      log.error('Failed to handle Wazzup webhook payload', {
        error: error instanceof Error ? error.stack ?? error.message : error,
      });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  },
});
