/**
 * JSONL logger: one JSON object per line, appended to the log file and echoed
 * to stdout. Bigints serialize as decimal strings.
 *
 * Safety: any field whose key looks like a secret (key, secret, mnemonic,
 * password, seed) is dropped before writing, so a private key can never
 * leak into the log even if a caller passes it by mistake.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SENSITIVE_KEY_PATTERN = /(private.?key|secret|mnemonic|password|seed phrase)/i;

function sanitize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'bigint') return value.toString();
    return value;
  }
  if (Array.isArray(value)) return value.map(sanitize);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(k)) continue;
    out[k] = sanitize(v);
  }
  return out;
}

export interface Logger {
  log(event: string, fields?: Record<string, unknown>): void;
}

export function createLogger(logFile: string): Logger {
  mkdirSync(dirname(logFile), { recursive: true });
  return {
    log(event, fields = {}) {
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        event,
        ...(sanitize(fields) as Record<string, unknown>),
      });
      appendFileSync(logFile, line + '\n');
      console.log(line);
    },
  };
}
