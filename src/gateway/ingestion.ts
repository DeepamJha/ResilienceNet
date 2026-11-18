import { createHmac, timingSafeEqual } from 'node:crypto';
import { withTransaction } from '../db.js';
import { WriteAheadLog } from './wal.js';

export function verifySignature(body: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  const supplied = signature.replace(/^sha256=/, '');
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(supplied, 'hex'));
}

export async function ingestEvent(
  wal: WriteAheadLog, idempotencyKey: string, payload: unknown, signature: string
): Promise<{ id: string; duplicate: boolean }> {
  const record = { id: idempotencyKey, receivedAt: new Date().toISOString(), payload, signature };
  await wal.append(record);
  return withTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO events (id, idempotency_key, payload, signature) VALUES ($1, $1, $2, $3)
       ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [idempotencyKey, payload, signature]
    );
    return { id: idempotencyKey, duplicate: inserted.rowCount === 0 };
  });
}

export async function syncBatch(
  wal: WriteAheadLog, events: Array<{ id: string; payload: unknown; signature: string }>
): Promise<{ accepted: number; duplicates: number }> {
  let accepted = 0;
  let duplicates = 0;
  for (const event of events) {
    const result = await ingestEvent(wal, event.id, event.payload, event.signature);
    result.duplicate ? duplicates++ : accepted++;
  }
  return { accepted, duplicates };
}
