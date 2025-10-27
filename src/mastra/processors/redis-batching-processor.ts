import type { MastraMessageV2 } from '@mastra/core/agent/message-list';
import type { Processor } from '@mastra/core/processors';
import type { TracingContext } from '@mastra/core/ai-tracing';
import { createClient, type RedisClientType } from 'redis';

type BatchedMessage = {
  id: string;
  content: MastraMessageV2['content'];
  createdAt: number;
};

export type RedisBatchingProcessorOptions = {
  /**
   * Sliding window duration in milliseconds.
   * Messages arriving within this window get batched together.
   */
  windowMs?: number;
  /**
   * Redis connection string. Falls back to the REDIS_URL environment variable.
   */
  redisUrl?: string;
  /**
   * Allows overriding the redis key prefix (useful when running multiple agents).
   */
  keyPrefix?: string;
  /**
   * Resolve a unique identifier for the current user/conversation.
   * Defaults to Thread ID -> Resource ID -> metadata.userId.
   */
  userIdResolver?: (message: MastraMessageV2, tracingContext?: TracingContext) => string | undefined;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Batches multiple user messages into a single payload when they arrive within a time window.
 * All messages that arrive during the window are stored in Redis. The first request acquires a lock,
 * waits for the window to expire without new messages, then forwards the aggregated payload.
 * Subsequent requests abort with a tripwire so the client can wait for the aggregated response.
 *
 * Inspired by the guardrails/processor pattern from Mastra docs.
 */
export class RedisBatchingProcessor implements Processor {
  readonly name = 'redis-batching-input';

  private readonly windowMs: number;
  private readonly keyPrefix: string;
  private readonly userIdResolver?: RedisBatchingProcessorOptions['userIdResolver'];
  private readonly redis: RedisClientType;
  private connectPromise?: Promise<RedisClientType>;

  constructor({
    windowMs = 4_000,
    redisUrl = process.env.REDIS_URL,
    keyPrefix = 'mastra:input-batch',
    userIdResolver,
  }: RedisBatchingProcessorOptions = {}) {
    if (!redisUrl) {
      throw new Error(
        'RedisBatchingProcessor: REDIS_URL is not set. Provide it in the constructor or .env file.',
      );
    }

    this.windowMs = windowMs;
    this.keyPrefix = keyPrefix.replace(/\s+/g, '-');
    this.userIdResolver = userIdResolver;
    this.redis = createClient({ url: redisUrl });
    this.redis.on('error', (err) => {
      console.error('[RedisBatchingProcessor] Redis error', err);
    });
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
      // No stable identifier – let the request continue untouched.
      return messages;
    }

    const listKey = this.buildListKey(userId);
    const lockKey = `${listKey}:lock`;

    await this.redis.rPush(
      listKey,
      JSON.stringify({
        id: lastUserMessage.id,
        content: lastUserMessage.content,
        createdAt: Date.now(),
      } satisfies BatchedMessage),
    );
    await this.redis.pExpire(listKey, this.windowMs * 3);

    const acquiredLock = await this.redis.set(lockKey, '1', {
      PX: this.windowMs * 3,
      NX: true,
    });

    if (acquiredLock !== 'OK') {
      // Another in-flight request is waiting for the batch to close.
      await this.redis.pExpire(lockKey, this.windowMs * 3);
      abort('redis-batching:pending');
    }

    try {
      await this.awaitQuietWindow(listKey);
      const batchedPayload = await this.flushBatch(listKey);
      await this.redis.del(lockKey);

      if (!batchedPayload.length) {
        return messages;
      }

      const collapsedMessage = this.mergeMessages(batchedPayload, lastUserMessage);
      const filteredMessages = messages.filter(
        (message) => !batchedPayload.some((entry) => entry.id === message.id),
      );

      return [...filteredMessages, collapsedMessage];
    } catch (error) {
      await this.redis.del(lockKey);
      throw error;
    }
  }

  private async ensureRedis() {
    if (this.redis.isOpen) {
      return;
    }

    this.connectPromise ??= this.redis.connect();
    try {
      await this.connectPromise;
    } catch (err) {
      this.connectPromise = undefined;
      throw err;
    }
  }

  private async awaitQuietWindow(listKey: string) {
    while (true) {
      const lastRaw = await this.redis.lIndex(listKey, -1);
      if (!lastRaw) {
        return;
      }

      const lastEntry = JSON.parse(lastRaw) as BatchedMessage;
      const silenceDuration = Date.now() - lastEntry.createdAt;
      const remaining = this.windowMs - silenceDuration;

      if (remaining <= 0) {
        return;
      }

      await sleep(Math.min(remaining, 250));
    }
  }

  private async flushBatch(listKey: string) {
    const all = await this.redis.lRange(listKey, 0, -1);
    await this.redis.del(listKey);
    return all.map((raw) => JSON.parse(raw) as BatchedMessage);
  }

  private mergeMessages(
    batchedMessages: BatchedMessage[],
    template: MastraMessageV2,
  ): MastraMessageV2 {
    const aggregatedParts = batchedMessages.flatMap((entry) => entry.content.parts);
    const aggregatedMetadata = {
      ...(template.content.metadata ?? {}),
      batched: true,
      batchWindowMs: this.windowMs,
      originalMessageIds: batchedMessages.map((entry) => entry.id),
    };

    return {
      ...template,
      id: `${template.id}:batched`,
      createdAt: new Date(),
      content: { ...template.content, parts: aggregatedParts, metadata: aggregatedMetadata },
    };
  }

  private buildListKey(userId: string) {
    return `${this.keyPrefix}:${userId}`;
  }
}
