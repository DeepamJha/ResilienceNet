import Fastify from 'fastify';
import { createClient } from 'redis';
import { config } from './config.js';
import { verifySignature, ingestEvent, syncBatch } from './gateway/ingestion.js';
import { WriteAheadLog } from './gateway/wal.js';
import { PriorityQueue } from './queue/priorityQueue.js';

export function buildServer() {
  const app = Fastify({ logger: true });
  const wal = new WriteAheadLog(config.walPath);
  const redis = createClient({ url: config.redisUrl });
  const queue = new PriorityQueue(redis);
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    try { done(null, JSON.parse(body as string)); } catch (error) { done(error as Error, undefined); }
  });
  app.post('/webhooks/:source', async (request, reply) => {
    const raw = JSON.stringify(request.body);
    const signature = request.headers['x-webhook-signature'];
    const idempotencyKey = request.headers['idempotency-key'];
    if (typeof signature !== 'string' || typeof idempotencyKey !== 'string' ||
        !verifySignature(raw, signature, config.webhookSecret)) {
      return reply.code(401).send({ error: 'invalid signature or idempotency key' });
    }
    const result = await ingestEvent(wal, idempotencyKey, request.body, signature);
    await queue.enqueue('normal', { source: request.params, id: result.id });
    return reply.code(result.duplicate ? 200 : 202).send(result);
  });
  app.post('/webhooks/sync', async (request, reply) => {
    const body = request.body as { events?: Array<{ id: string; payload: unknown; signature: string }> };
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
