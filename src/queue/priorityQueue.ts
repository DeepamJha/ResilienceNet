import { RedisClientType } from 'redis';

export type Priority = 'critical' | 'high' | 'normal';
const priorities: Priority[] = ['critical', 'high', 'normal'];

export class PriorityQueue {
  constructor(private readonly redis: RedisClientType, private readonly prefix = 'resiliencenet') {}

  async enqueue(priority: Priority, payload: unknown, attempts = 0): Promise<void> {
    await this.redis.rPush(`${this.prefix}:queue:${priority}`, JSON.stringify({ payload, attempts }));
  }

  async dequeue(): Promise<{ priority: Priority; payload: unknown; attempts: number } | null> {
    for (const priority of priorities) {
      const item = await this.redis.lPop(`${this.prefix}:queue:${priority}`);
      if (item) {
        const parsed = JSON.parse(item) as { payload: unknown; attempts: number };
        return { priority, ...parsed };
      }
    }
    return null;
  }

  async fail(item: { priority: Priority; payload: unknown; attempts: number }, maxAttempts = 5): Promise<void> {
    const attempts = item.attempts + 1;
    if (attempts >= maxAttempts) {
      await this.redis.rPush(`${this.prefix}:dlq`, JSON.stringify({ ...item, attempts }));
      return;
    }
    const delay = Math.min(60_000, 250 * 2 ** attempts);
    await new Promise((resolve) => setTimeout(resolve, delay));
    await this.enqueue(item.priority, item.payload, attempts);
  }

  async replayDlq(limit = 100): Promise<number> {
    let replayed = 0;
    while (replayed < limit) {
      const item = await this.redis.lPop(`${this.prefix}:dlq`);
      if (!item) break;
      const parsed = JSON.parse(item) as { priority: Priority; payload: unknown };
      await this.enqueue(parsed.priority, parsed.payload);
      replayed++;
    }
    return replayed;
  }
}
