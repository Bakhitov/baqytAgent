import type { MastraMessageV2 } from '@mastra/core/agent/message-list';
import type { Processor } from '@mastra/core/processors';
import type { TracingContext } from '@mastra/core/ai-tracing';
import { createClient, type RedisClientType } from 'redis';

export type RedisStopProcessorOptions = {
  /**
   * Redis connection string. Defaults to REDIS_URL.
   */
  redisUrl?: string;
  /**
   * Optional key prefix to namespace stop flags.
   */
  keyPrefix?: string;
  /**
   * Custom resolver to derive a stable identifier for the conversation/user.
   */
  userIdResolver?: (message: MastraMessageV2, tracingContext?: TracingContext) => string | undefined;
  /**
   * Custom predicate to decide whether the stored value means "stop".
   */
  isStopped?: (value: string | null) => boolean;
};

const defaultIsStopped = (value: string | null) =>
  value !== null && value !== '' && value !== '0' && value.toLowerCase() !== 'false';

/**
 * Prevents the agent from responding when a Redis "stop" flag is set for the current thread/user.
 * Meant to run before other input processors so requests abort early.
 */
export class RedisStopProcessor implements Processor {
  readonly name = 'redis-stop-input';

  private readonly redis: RedisClientType;
  private readonly keyPrefix: string;
  private readonly userIdResolver?: RedisStopProcessorOptions['userIdResolver'];
  private readonly isStopped: (value: string | null) => boolean;
  private connectPromise?: Promise<RedisClientType>;

  constructor({
    redisUrl = process.env.REDIS_URL,
    keyPrefix = 'mastra:input-stop',
    userIdResolver,
    isStopped,
  }: RedisStopProcessorOptions = {}) {
    if (!redisUrl) {
      throw new Error('RedisStopProcessor: REDIS_URL is not set. Provide it via options or env.');
    }

    this.redis = createClient({ url: redisUrl });
    this.redis.on('error', (err) => {
      console.error('[RedisStopProcessor] Redis error', err);
    });
    this.keyPrefix = keyPrefix.replace(/\s+/g, '-');
    this.userIdResolver = userIdResolver;
    this.isStopped = isStopped ?? defaultIsStopped;
  }

  async processInput({
    messages,
    abort,
    tracingContext,
  }: {
    messages: MastraMessageV2[];
    abort: (reason?: string) => never;
    tracingContext?: TracingContext;
  }): Promise<MastraMessageV2[]> {
    if (!messages.length) {
      return messages;
    }

    const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
    if (!lastUserMessage) {
      return messages;
    }

    await this.ensureRedis();

    const userId =
      this.userIdResolver?.(lastUserMessage, tracingContext) ??
      lastUserMessage.threadId ??
      lastUserMessage.resourceId ??
      (lastUserMessage.content.metadata?.userId as string | undefined);

    if (!userId) {
      return messages;
    }

    const stopKey = `${this.keyPrefix}:${userId}`;
    const value = await this.redis.get(stopKey);

    if (this.isStopped(value)) {
      abort('redis-stop:active');
    }

    return messages;
  }

  private async ensureRedis() {
    if (this.redis.isOpen) {
      return;
    }

    this.connectPromise ??= this.redis.connect();
    try {
      await this.connectPromise;
    } catch (error) {
      this.connectPromise = undefined;
      throw error;
    }
  }
}
