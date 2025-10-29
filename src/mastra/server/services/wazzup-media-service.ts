type LoggerLike = {
  info?: (message?: unknown, ...meta: unknown[]) => void;
  warn?: (message?: unknown, ...meta: unknown[]) => void;
  error?: (message?: unknown, ...meta: unknown[]) => void;
  debug?: (message?: unknown, ...meta: unknown[]) => void;
};

type WazzupMediaServiceOptions = {
  logger?: LoggerLike;
};

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AUDIO_TRANSCRIBE_MODEL = process.env.WAZZUP_TRANSCRIBE_MODEL ?? 'gpt-4o-mini-transcribe';
const PRIMARY_MODEL = process.env.BAQYT_PRIMARY_MODEL_ID ?? 'openai/gpt-5-mini';
const DEFAULT_VISION_MODEL = PRIMARY_MODEL.includes('gpt-5') ? PRIMARY_MODEL : 'gpt-4.1-mini';
const IMAGE_VISION_MODEL = process.env.WAZZUP_VISION_MODEL ?? DEFAULT_VISION_MODEL;

const OPENAI_AUDIO_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';
const OPENAI_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';

const makeLogger = (logger?: LoggerLike) => ({
  info(message: string, meta?: Record<string, unknown>) {
    if (typeof logger?.info === 'function') {
      meta ? logger.info(meta, message) : logger.info(message);
      return;
    }
    console.log(`[WazzupMedia] ${message}`, meta ?? '');
  },
  warn(message: string, meta?: Record<string, unknown>) {
    if (typeof logger?.warn === 'function') {
      meta ? logger.warn(meta, message) : logger.warn(message);
      return;
    }
    console.warn(`[WazzupMedia] ${message}`, meta ?? '');
  },
  error(message: string, meta?: Record<string, unknown>) {
    if (typeof logger?.error === 'function') {
      meta ? logger.error(meta, message) : logger.error(message);
      return;
    }
    console.error(`[WazzupMedia] ${message}`, meta ?? '');
  },
  debug(message: string, meta?: Record<string, unknown>) {
    if (typeof logger?.debug === 'function') {
      meta ? logger.debug(meta, message) : logger.debug(message);
      return;
    }
    console.debug(`[WazzupMedia] ${message}`, meta ?? '');
  },
});

export class WazzupMediaService {
  private readonly logger?: LoggerLike;

  constructor(options: WazzupMediaServiceOptions = {}) {
    this.logger = options.logger;
  }

  async transcribeAudioFromUrl(url: string): Promise<string | null> {
    const log = makeLogger(this.logger);

    if (!OPENAI_API_KEY) {
      log.warn('OPENAI_API_KEY is not configured; cannot transcribe audio');
      return null;
    }

    try {
      const response = await fetch(url);
      if (!response.ok) {
        log.warn('Не удалось загрузить аудио Wazzup', {
          status: response.status,
          statusText: response.statusText,
          url,
        });
        return null;
      }

      const contentType = response.headers.get('content-type') ?? 'audio/mpeg';
      const arrayBuffer = await response.arrayBuffer();

      const blob = new Blob([arrayBuffer], { type: contentType });
      const filename = this.resolveFilename(url, contentType);

      const formData = new FormData();
      formData.append('file', blob, filename);
      formData.append('model', AUDIO_TRANSCRIBE_MODEL);
      formData.append('response_format', 'json');

      const transcriptionResponse = await fetch(OPENAI_AUDIO_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: formData,
      });

      if (!transcriptionResponse.ok) {
        const errorBody = await transcriptionResponse
          .clone()
          .json()
          .catch(async () => transcriptionResponse.text().catch(() => undefined));

        log.error('OpenAI не смог транскрибировать аудио', {
          status: transcriptionResponse.status,
          statusText: transcriptionResponse.statusText,
          body: errorBody,
        });
        return null;
      }

      const data = (await transcriptionResponse.json()) as { text?: string };
      const transcript = typeof data?.text === 'string' && data.text.trim().length ? data.text.trim() : null;

      if (!transcript) {
        log.warn('OpenAI вернул пустую транскрипцию аудио');
        return null;
      }

      log.debug('Аудио успешно транскрибировано', { url });
      return transcript;
    } catch (error) {
      log.error('Ошибка при транскрипции аудио', {
        error: error instanceof Error ? error.stack ?? error.message : error,
        url,
      });
      return null;
    }
  }

  async describeImageFromUrl(url: string): Promise<string | null> {
    const log = makeLogger(this.logger);

    if (!OPENAI_API_KEY) {
      log.warn('OPENAI_API_KEY is not configured; cannot describe image');
      return null;
    }

    try {
      const visionResponse = await fetch(OPENAI_RESPONSES_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: IMAGE_VISION_MODEL,
          input: [
            {
              role: 'system',
              content: [
                {
                  type: 'input_text',
                  text: 'Ты описываешь изображения коротко и по делу, максимум два предложения на русском языке.',
                },
              ],
            },
            {
              role: 'user',
              content: [
                { type: 'input_text', text: 'Опиши это изображение для менеджера по недвижимости.' },
                { type: 'input_image', image_url: url },
              ],
            },
          ],
        }),
      });

      if (!visionResponse.ok) {
        const errorBody = await visionResponse
          .clone()
          .json()
          .catch(async () => visionResponse.text().catch(() => undefined));

        log.error('OpenAI не смог описать изображение', {
          status: visionResponse.status,
          statusText: visionResponse.statusText,
          body: errorBody,
        });
        return null;
      }

      const data = (await visionResponse.json()) as {
        output_text?: string;
        output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
      };

      const direct = typeof data?.output_text === 'string' ? data.output_text.trim() : null;
      if (direct) {
        log.debug('Изображение успешно описано', { url });
        return direct;
      }

      const fallback = data?.output
        ?.flatMap((item) => item?.content ?? [])
        ?.find((content) => typeof content?.text === 'string')?.text?.trim();

      if (fallback) {
        log.debug('Изображение успешно описано (fallback)', { url });
        return fallback;
      }

      log.warn('OpenAI вернул пустое описание изображения');
      return null;
    } catch (error) {
      log.error('Ошибка при описании изображения', {
        error: error instanceof Error ? error.stack ?? error.message : error,
        url,
      });
      return null;
    }
  }

  private resolveFilename(url: string, contentType: string) {
    try {
      const parsedUrl = new URL(url);
      const pathname = parsedUrl.pathname.split('/').pop();
      if (pathname && pathname.includes('.')) {
        return pathname;
      }
    } catch {
      // ignore parsing errors
    }

    const extension = this.extensionFromContentType(contentType);
    return `audio-${Date.now()}.${extension}`;
  }

  private extensionFromContentType(contentType: string) {
    if (contentType.includes('mp3')) {
      return 'mp3';
    }
    if (contentType.includes('wav')) {
      return 'wav';
    }
    if (contentType.includes('ogg')) {
      return 'ogg';
    }
    if (contentType.includes('mpeg')) {
      return 'mp3';
    }
    return 'mp3';
  }
}
