'use client';

// Shared bits for the agent-earn board: address/tx links, status pills,
// and the NET payout display. The net figure is always the headline —
// gross may appear next to it, labelled as gross, never as take-home
// (brief §2.1).

import Link from 'next/link';
import { getExplorerAddressUrl, getExplorerTxUrl } from '@/lib/contracts/addresses';
import { shortenAddress } from '@/lib/format';
import { JOB_STATUS_LABELS, type JobStatus } from '@/lib/earn/constants';
import { formatUsdg } from '@/lib/earn/fees';
import { cn } from '@/lib/utils';

export function shortAddr(a: string): string {
  return shortenAddress(a);
}

export function AddrLink({ address, className }: { address: string; className?: string }) {
  return (
    <a
      className={cn('font-mono text-[12px] text-emerald-300 hover:underline break-all', className)}
      href={getExplorerAddressUrl(address)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {shortenAddress(address)}
    </a>
  );
}

export function TxLink({ hash, className }: { hash: string; className?: string }) {
  return (
    <a
      className={cn('font-mono text-[12px] text-emerald-300 hover:underline break-all', className)}
      href={getExplorerTxUrl(hash)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {shortenAddress(hash)}
    </a>
  );
}

const STATUS_STYLES: Record<JobStatus, string> = {
  pending_screening: 'bg-white/10 text-white/70',
  screened_out: 'bg-red-500/15 text-red-300',
  screened_in: 'bg-amber-500/15 text-amber-300',
  locked: 'bg-emerald-500/15 text-emerald-300',
  claimed: 'bg-sky-500/15 text-sky-300',
  delivered: 'bg-violet-500/15 text-violet-300',
  disputed: 'bg-orange-500/15 text-orange-300',
  panel: 'bg-orange-500/15 text-orange-300',
  settled: 'bg-emerald-500/15 text-emerald-300',
  refunded: 'bg-white/10 text-white/70',
  lapsed: 'bg-white/10 text-white/70',
};

export function StatusPill({ status }: { status: string }) {
  const s = status as JobStatus;
  return (
    <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-semibold', STATUS_STYLES[s] ?? 'bg-white/10 text-white/70')}>
      {JOB_STATUS_LABELS[s] ?? status}
    </span>
  );
}

/** The agent's take-home, always NET. Gross appears only as a labelled
 * footnote next to it. */
export function NetPayout({ grossUnits, feeBpsAtLock, large }: { grossUnits: bigint; feeBpsAtLock: number; large?: boolean }) {
  const fee = (grossUnits * BigInt(feeBpsAtLock)) / 10_000n;
  const net = grossUnits - fee;
  return (
    <span>
      <span className={large ? 'text-2xl font-bold text-emerald-300' : 'text-[15px] font-bold text-emerald-300'}>
        {formatUsdg(net)}
      </span>
      <span className="ml-1.5 text-[12px] text-white/50">
        net to the agent{fee > 0n ? ` (${formatUsdg(grossUnits)} gross − ${formatUsdg(fee)} fee)` : ''}
      </span>
    </span>
  );
}

export function JobLink({ jobId, children }: { jobId: string; children?: React.ReactNode }) {
  return (
    <Link href={`/agents/earn/${jobId}`} className="hover:underline">
      {children ?? shortenAddress(jobId)}
    </Link>
  );
}
