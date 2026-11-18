export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/resiliencenet',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  walPath: process.env.WAL_PATH ?? './data/events.wal',
  webhookSecret: process.env.WEBHOOK_SECRET ?? 'change-me'
};
