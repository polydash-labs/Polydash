/**
 * Per-key API usage logging (Pro metering, v1).
 *
 * One row in ApiKeyUsage per tool call (MCP tools/call + v2 REST). Free
 * (unkeyed) calls are logged too, with keyId 'free' — free usage counts,
 * because a free call is the product working. The totals show the split
 * (Pro vs free) in plain words, and keysActive never counts 'free'.
 *
 * The write is fire-and-forget: it runs in `after()` so it never delays the
 * response, and a failed write is swallowed — usage logging must never break
 * an API call, and a database outage degrades to uncounted calls, never to
 * failed calls. Rate-limited and errored calls are logged too, with status
 * rate_limited / error, so the dashboard can show 429s.
 */
import { after } from 'next/server';
import { prisma } from '@/lib/db';

/** keyId recorded for unkeyed (free-tier) calls. */
export const FREE_KEY_ID = 'free';

export type UsageKind = 'read' | 'prepare' | 'intent';
export type UsageStatus = 'ok' | 'error' | 'rate_limited';

export interface UsageEntry {
  keyId: string;
  tool: string;
  kind: UsageKind;
  status: UsageStatus;
}

/** The rate-limit bucket for a tool, mirroring runTool: prepares count as prepares, the intent tool counts as intent, everything else is a read. */
export function kindOf(tool: { kind: 'read' | 'prepare'; name: string }): UsageKind {
  if (tool.kind === 'prepare') return 'prepare';
  if (tool.name === 'polypad_intent') return 'intent';
  return 'read';
}

export function recordUsage(entry: UsageEntry): void {
  const write = async () => {
    try {
      await prisma.apiKeyUsage.create({ data: entry });
    } catch {
      // Never fail the call because metering failed.
    }
  };
  try {
    // Runs after the response is sent; keeps the serverless function alive for the write.
    after(() => write());
  } catch {
    // Outside a request context (tests, scripts): best-effort floating write.
    void write();
  }
}
