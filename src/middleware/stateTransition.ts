import { PoolClient } from 'pg';

export async function transitionEvent(client: PoolClient, id: string, from: string, to: string): Promise<boolean> {
  const locked = await client.query('SELECT state FROM events WHERE id = $1 FOR UPDATE', [id]);
  if (!locked.rowCount || locked.rows[0].state !== from) return false;
  await client.query('UPDATE events SET state = $1, updated_at = now() WHERE id = $2', [to, id]);
  return true;
}
