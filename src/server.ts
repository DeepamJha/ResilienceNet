import Fastify from 'fastify';
import { createClient } from 'redis';
import { config } from './config.js';
import { verifySignature, ingestEvent, syncBatch } from './gateway/ingestion.js';
import { WriteAheadLog } from './gateway/wal.js';
import { PriorityQueue } from './queue/priorityQueue.js';
import { allowRequest } from './middleware/rateLimiter.js';

export function buildServer() {
  const app = Fastify({ logger: true });
  const wal = new WriteAheadLog(config.walPath);
  const redis = createClient({ url: config.redisUrl });
  const queue = new PriorityQueue(redis);
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    done(null, body);
  });
  app.post('/webhooks/:source', async (request, reply) => {
    if (!(await allowRequest(redis, `webhook:${request.params}`, 100, 60_000))) {
      return reply.code(429).send({ error: 'rate limit exceeded' });
    }
    const raw = request.body as string;
    const signature = request.headers['x-webhook-signature'];
    const idempotencyKey = request.headers['idempotency-key'];
    if (typeof signature !== 'string' || typeof idempotencyKey !== 'string' ||
        !verifySignature(raw, signature, config.webhookSecret)) {
      return reply.code(401).send({ error: 'invalid signature or idempotency key' });
    }
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return reply.code(400).send({ error: 'invalid JSON' }); }
    const result = await ingestEvent(wal, idempotencyKey, payload, signature);
    await queue.enqueue('normal', { source: request.params, id: result.id });
    return reply.code(result.duplicate ? 200 : 202).send(result);
  });
  app.post('/webhooks/sync', async (request, reply) => {
    if (!(await allowRequest(redis, 'webhook:sync', 20, 60_000))) {
      return reply.code(429).send({ error: 'rate limit exceeded' });
    }
    let body: { events?: Array<{ id: string; payload: unknown; signature: string }> };
    try { body = JSON.parse(request.body as string); } catch { return reply.code(400).send({ error: 'invalid JSON' }); }
    if (!Array.isArray(body.events)) return reply.code(400).send({ error: 'events must be an array' });
    return syncBatch(wal, body.events);
  });
  app.post('/queue/dlq/replay', async () => ({ replayed: await queue.replayDlq() }));
  return { app, redis, wal };
}

if (process.env.NODE_ENV !== 'test') {
  const { app, redis, wal } = buildServer();
  await redis.connect();
  await wal.recover();
  await app.listen({ port: config.port, host: '0.0.0.0' });
}
