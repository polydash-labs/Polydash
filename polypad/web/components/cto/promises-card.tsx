'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { ChevronDown } from 'lucide-react';
import { Panel, Pill, TxLink, fmtDate } from '@/app/agents/_components/ui';
import { PROMISE_FOOTER, type PromiseView } from '@/lib/promises/presets';
import { cn } from '@/lib/utils';

function left(sec: number) {
  if (sec <= 0) return 'deadline reached, checking';
  const d = Math.floor(sec / 86_400), h = Math.floor((sec % 86_400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}d ${h}h left` : h > 0 ? `${h}h ${m}m left` : `${Math.max(1, m)}m left`;
}

export function PromiseStatusPill({ p, now }: { p: PromiseView; now: number | null }) {
  if (p.status === 'kept') return <Pill tone="green">Kept</Pill>;
  if (p.status === 'broken') return <Pill tone="red">Broken</Pill>;
  if (p.status === 'needs_review') return <span className="inline-flex items-center rounded-full bg-amber-400/10 px-2 py-0.5 text-[11px] font-medium text-amber-300">Needs review</span>;
  const note = p.deadline == null ? 'waiting for graduation' : now == null ? '' : left(p.deadline - now);
  return <span className="inline-flex items-center rounded-full bg-sky-400/10 px-2 py-0.5 text-[11px] font-medium text-sky-300">Active{note ? ` · ${note}` : ''}</span>;
}

function PromiseRow({ p, now, isCreator }: { p: PromiseView; now: number | null; isCreator: boolean }) {
  const [open, setOpen] = useState(false);
  const staking = isCreator && p.status === 'active' && (p.kind === 'staking_live' || p.kind === 'staking_rewards');
  return (
    <li className="rounded-xl bg-white/[0.03] p-3 text-[13px]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 break-words text-white/85">{p.sentence}</p>
        <PromiseStatusPill p={p} now={now} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-white/45">
        <span>Signed {fmtDate(p.startsAt)}</span>
        {p.evidenceTx && <span className="inline-flex items-center gap-1">Evidence <TxLink hash={p.evidenceTx} /></span>}
        <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex min-h-10 items-center gap-0.5 text-white/60 hover:text-white" aria-expanded={open}>
          Verify signature <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
        </button>
      </div>
      {p.evidenceNote && p.status !== 'active' && <p className="mt-1 text-[12px] text-white/55">{p.evidenceNote}</p>}
      {staking && (
        <Link href={`/agents?agent=polyforge&stake=${p.tokenAddress}`} className="mt-2 inline-flex h-10 items-center rounded-full bg-polydash-green px-3 text-[12px] font-medium text-black hover:bg-polydash-green-light">
          Set up staking now
        </Link>
      )}
      {open && (
        <div className="mt-2 space-y-2 rounded-lg bg-black/40 p-2.5 text-[11px]">
          <div><span className="text-white/45">Signer</span> <span className="break-all font-mono text-white/80">{p.signer}</span></div>
          <div><span className="text-white/45">Signature</span> <span className="break-all font-mono text-white/80">{p.signature}</span></div>
          <div>
            <div className="text-white/45">Typed data (EIP-712)</div>
            <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-all font-mono text-white/70">{JSON.stringify(p.typedData, null, 2)}</pre>
          </div>
          <p className="text-white/40">Recover the signer from this typed data and signature with any EIP-712 tool and compare it with the token creator.</p>
        </div>
      )}
    </li>
  );
}

export function PromisesCard({ promises, className, title = 'Promises' }: { promises: PromiseView[]; className?: string; title?: string }) {
  const { address } = useAccount();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 60_000);
    return () => clearInterval(t);
  }, []);
  const me = address?.toLowerCase();
  const kept = promises.filter((p) => p.status === 'kept').length;
  return (
    <Panel title={title} note={promises.length ? `${promises.length} total · ${kept} kept` : undefined} className={className}>
      {promises.length === 0 ? <p className="text-[13px] text-white/50">No promises yet.</p> : (
        <ul className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
          {promises.map((p) => <PromiseRow key={p.id} p={p} now={now} isCreator={!!me && me === p.signer.toLowerCase()} />)}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-white/40">{PROMISE_FOOTER}</p>
    </Panel>
  );
}
