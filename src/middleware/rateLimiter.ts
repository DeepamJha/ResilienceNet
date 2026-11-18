export const slidingWindowScript = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)
local count = redis.call('ZCARD', KEYS[1])
if count >= limit then return {0, count} end
redis.call('ZADD', KEYS[1], now, ARGV[4])
redis.call('PEXPIRE', KEYS[1], window)
return {1, count + 1}
`;

type RedisEvalClient = { eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown> };

export async function allowRequest(redis: RedisEvalClient, key: string, limit: number, windowMs: number): Promise<boolean> {
  const result = await redis.eval(slidingWindowScript, {
    keys: [`ratelimit:${key}`],
    arguments: [String(Date.now()), String(windowMs), String(limit), `${Date.now()}-${Math.random()}`]
  }) as [number, number];
  return result[0] === 1;
}
