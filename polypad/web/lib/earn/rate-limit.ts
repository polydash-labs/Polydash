// Tiny in-memory per-IP rate limit for the agent-earn API (same shape as
// the partnerships inquiry route): 1 request per 10 seconds, 20 per UTC day.
const GAP_MS = 10_000;
const DAILY_LIMIT = 20;
const hits = new Map<string, { last: number; day: string; count: number }>();

export function checkLimit(ip: string): { reply: string; retryAfter: number } | null {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const cur = hits.get(ip);
  const entry = cur && cur.day === day ? cur : { last: 0, day, count: 0 };
  if (now - entry.last < GAP_MS) {
    return { reply: 'Please wait a few seconds before trying again.', retryAfter: Math.ceil((GAP_MS - (now - entry.last)) / 1000) };
  }
  if (entry.count >= DAILY_LIMIT) {
    const midnight = Date.parse(`${day}T00:00:00Z`) + 86_400_000;
    return { reply: "You've reached today's limit. Try again tomorrow.", retryAfter: Math.ceil((midnight - now) / 1000) };
  }
  entry.last = now;
  entry.count += 1;
  hits.set(ip, entry);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.day !== day) hits.delete(k);
  return null;
}

export function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
}
