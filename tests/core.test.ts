import { describe, expect, it } from 'vitest';
import { verifySignature } from '../src/gateway/ingestion.js';
import { WriteAheadLog } from '../src/gateway/wal.js';
import { PlaybookEngine } from '../src/engine/playbook.js';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('webhook security and durability', () => {
  it('verifies HMAC signatures without accepting malformed input', () => {
    const body = '{"ok":true}';
    const signature = createHmac('sha256', 'secret').update(body).digest('hex');
    expect(verifySignature(body, `sha256=${signature}`, 'secret')).toBe(true);
    expect(verifySignature(body, 'sha256=bad', 'secret')).toBe(false);
  });
  it('recovers fsynced WAL records', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'resiliencenet-'));
    const wal = new WriteAheadLog(join(directory, 'events.wal'));
    await wal.append({ id: 'one', receivedAt: new Date().toISOString(), payload: { ok: true }, signature: 'sig' });
    expect((await wal.recover())[0].id).toBe('one');
    await rm(directory, { recursive: true, force: true });
  });
});

describe('playbook engine', () => {
  it('pauses and resumes at an approval checkpoint in dependency order', async () => {
    const completed: string[] = [];
    const engine = new PlaybookEngine();
    const steps = [
      { id: 'prepare', run: async () => { completed.push('prepare'); } },
      { id: 'approve', dependsOn: ['prepare'], approvalCheckpoint: true, run: async () => { completed.push('approve'); } },
      { id: 'finish', dependsOn: ['approve'], run: async () => { completed.push('finish'); } }
    ];
    expect(await engine.execute('run', steps)).toBe('paused');
    expect(completed).toEqual(['prepare']);
    expect(await engine.execute('run', steps, true)).toBe('completed');
    expect(completed).toEqual(['prepare', 'approve', 'finish']);
  });
});
