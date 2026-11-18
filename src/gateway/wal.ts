import { appendFile, mkdir, open, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type WalRecord = { id: string; receivedAt: string; payload: unknown; signature: string };

export class WriteAheadLog {
  constructor(private readonly path: string) {}

  async append(record: WalRecord): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const handle = await open(this.path, 'a');
    try {
      await handle.write(`${JSON.stringify(record)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async recover(): Promise<WalRecord[]> {
    try {
      const contents = await readFile(this.path, 'utf8');
      return contents.split('\n').filter(Boolean).map((line) => JSON.parse(line) as WalRecord);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
}
