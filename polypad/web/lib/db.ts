import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

/**
 * How long a single DB read may block a request before we treat the DB as
 * down. A healthy Neon pooler answers in well under 200ms; when Neon
 * compute is suspended the pooler holds the connection for seconds, and a
 * hung read must not eat the Vercel Hobby 10s budget.
 */
export const DB_READ_TIMEOUT_MS = 800;

/**
 * Race a promise against a timeout, resolving null on timeout or on error.
 * The underlying work is NOT cancelled — it keeps running in the
 * background — but the caller stops waiting for it. Use for every Prisma
 * read on the request path so a suspended database degrades to
 * chain-only reads instead of a 503.
 */
export function withTimeout<T>(p: Promise<T>, ms: number = DB_READ_TIMEOUT_MS): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([p.catch(() => null), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T | null>;
}
