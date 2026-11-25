// Bevor AI review: types and the health-score item (pure, no SDK, safe to import anywhere).
import type { HealthItem } from '@/lib/cto/chain';

export const BEVOR_CHAIN_ID = 4663;
// Build activity rescale (Oct 31 2026): 10 → 6 (Verification = verified 6 + Bevor 6 = 12); medium-only 5 → 3.
export const BEVOR_POINTS = 6;
export const BEVOR_MEDIUM_POINTS = 3;

export interface BevorAuditView {
  status: 'pending' | 'running' | 'done' | 'unsupported' | 'failed';
  target: string | null;
  critical: number; high: number; medium: number; low: number; nFindings: number;
  completedAt: string | null;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Full points: no critical/high/medium findings. Half: medium only. None: critical/high, not auditable, or not finished. */
export function bevorItem(a: BevorAuditView | null): HealthItem {
  const base = { key: 'bevor', points: BEVOR_POINTS };
  const label = (s: string) => `Contract scanned by Bevor AI (${s})`;
  if (!a || a.status === 'pending' || a.status === 'running') return { ...base, label: label('scan running'), ok: false, known: false };
  if (a.status === 'unsupported') return { ...base, label: label('source not verified, can’t scan'), ok: false, known: true };
  if (a.status === 'failed') return { ...base, label: label('scan could not finish, retrying later'), ok: false, known: false };
  const severe = a.critical + a.high;
  if (severe > 0) {
    const parts = [a.critical ? `${a.critical} critical` : '', a.high ? `${a.high} high` : ''].filter(Boolean).join(', ');
    return { ...base, label: label(`${parts} ${severe === 1 ? 'issue' : 'issues'} flagged`), ok: false, known: true };
  }
  if (a.medium > 0) return { ...base, label: label(`no critical or high issues, ${plural(a.medium, 'medium issue')}`), ok: true, known: true, earned: BEVOR_MEDIUM_POINTS };
  return { ...base, label: label('no critical, high or medium issues'), ok: true, known: true, earned: BEVOR_POINTS };
}
