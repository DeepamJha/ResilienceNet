type OutboxEvent = { id: string; payload: unknown; createdAt: string };
export class ResilienceNetClient {
  private readonly database: Promise<IDBDatabase>;
  private retryDelay = 1000;
  constructor(private readonly endpoint: string, private readonly batchSize = 50) {
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open('resiliencenet-outbox', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('events', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    window.addEventListener('online', () => void this.flush());
  }
  async capture(payload: unknown): Promise<string> {
    const event: OutboxEvent = { id: crypto.randomUUID(), payload, createdAt: new Date().toISOString() };
    const db = await this.database;
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction('events', 'readwrite').objectStore('events').add(event);
      request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
    });
    return event.id;
  }
  async flush(): Promise<void> {
    const db = await this.database;
    const events = await new Promise<OutboxEvent[]>((resolve, reject) => {
      const result: OutboxEvent[] = []; const request = db.transaction('events').objectStore('events').openCursor();
      request.onsuccess = () => { const cursor = request.result; if (!cursor || result.length >= this.batchSize) return resolve(result); result.push(cursor.value); cursor.continue(); };
      request.onerror = () => reject(request.error);
    });
    if (!events.length) return;
    try {
      const response = await fetch(`${this.endpoint}/webhooks/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events }) });
      if (!response.ok) throw new Error(`sync failed: ${response.status}`);
      const transaction = db.transaction('events', 'readwrite');
      events.forEach((event) => transaction.objectStore('events').delete(event.id));
      await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
      this.retryDelay = 1000;
    } catch {
      setTimeout(() => void this.flush(), this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 60_000);
    }
  }
}
