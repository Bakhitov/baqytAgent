type LoggerLike = {
  info?: (message?: unknown, ...meta: unknown[]) => void;
  warn?: (message?: unknown, ...meta: unknown[]) => void;
  error?: (message?: unknown, ...meta: unknown[]) => void;
  debug?: (message?: unknown, ...meta: unknown[]) => void;
};

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export class UnauthorizedWebhookError extends Error {
  constructor(message = 'Wazzup webhook signature mismatch') {
    super(message);
    this.name = 'UnauthorizedWebhookError';
  }
}

export type WazzupWebhookPayload = {
  test?: boolean;
  messages?: unknown;
};

export type WazzupMessage = {
  messageId: string;
  channelId?: string;
  chatType?: string;
  chatId?: string;
  dateTime?: string;
  type?: string;
  status?: string;
  text?: string;
  isEcho?: boolean;
  contentUri?: string;
  [key: string]: unknown;
};

export type WazzupWebhookProcessingResult =
  | {
      type: 'test';
    }
  | {
      type: 'webhook';
      // Only messages are relevant for our use-case. Other webhook types are ignored.
      messages: WazzupMessage[];
      inboundMessages: WazzupMessage[];
    };

export type WazzupWebhookServiceOptions = {
  expectedAuthToken?: string;
  logger?: LoggerLike;
};

export class WazzupWebhookService {
  private readonly expectedAuthToken?: string;
  private readonly logger?: LoggerLike;

  constructor(options: WazzupWebhookServiceOptions = {}) {
    this.expectedAuthToken = options.expectedAuthToken;
    this.logger = options.logger;
  }

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    const logger = this.logger?.[level];
    if (typeof logger === 'function') {
      logger.call(this.logger, meta ?? message, meta ? message : undefined);
      return;
    }

    const fallback = console[level] ?? console.log;
    fallback(`[WazzupWebhook] ${message}`, meta ?? '');
  }

  async handleWebhook(
    payload: WazzupWebhookPayload,
    context: { authorization?: string | null },
  ): Promise<WazzupWebhookProcessingResult> {
    this.assertAuthorization(context.authorization ?? null);

    const messagesOnly = Array.isArray(payload?.messages) ? payload.messages : undefined;
    this.log('info', 'Получен вебхук Wazzup', { messages: messagesOnly });

    if (payload?.test === true) {
      this.log('info', 'Получен тестовый пинг Wazzup');
      return { type: 'test' };
    }

    // Only normalize messages — other webhook objects are ignored for now.
    const messages = this.normalizeMessages(payload.messages);
    const inboundMessages = messages.filter((message) => message.status === 'inbound');

    this.log('debug', 'Обработаны сообщения Wazzup', {
      total: messages.length,
      inbound: inboundMessages.length,
    });

    return {
      type: 'webhook',
      messages,
      inboundMessages,
    };
  }

  private assertAuthorization(authorizationHeader: string | null) {
    if (!this.expectedAuthToken) {
      return;
    }

    if (!authorizationHeader) {
      this.log(
        'warn',
        'Вебхук Wazzup пришёл без заголовка Authorization, ожидаем Bearer-токен. Обрабатываем без валидации.',
      );
      return;
    }

    const expectedHeader = `Bearer ${this.expectedAuthToken}`;
    if (authorizationHeader !== expectedHeader) {
      this.log('warn', 'Получен вебхук Wazzup с неверным токеном', {
        providedHeader: authorizationHeader,
      });
      throw new UnauthorizedWebhookError();
    }
  }

  private normalizeMessages(messages: unknown): WazzupMessage[] {
    if (!Array.isArray(messages)) {
      return [];
    }

    return messages
      .filter((message): message is Record<string, unknown> => typeof message === 'object' && message !== null)
      .map((message) => ({
        messageId: String(message.messageId ?? ''),
        channelId: this.safeString(message.channelId),
        chatType: this.safeString(message.chatType),
        chatId: this.safeString(message.chatId),
        dateTime: this.safeString(message.dateTime),
        type: this.safeString(message.type),
        status: this.safeString(message.status),
        text: this.safeString(message.text),
        isEcho: typeof message.isEcho === 'boolean' ? message.isEcho : undefined,
        contentUri: this.safeString(message.contentUri),
        ...message,
      }))
      .filter((message) => Boolean(message.messageId));
  }

  private safeString(value: unknown): string | undefined {
    if (typeof value === 'string' && value.length) {
      return value;
    }

    if (typeof value === 'number' && !Number.isNaN(value)) {
      return String(value);
    }

    return undefined;
  }
}
