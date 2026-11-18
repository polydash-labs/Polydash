'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TokenAvatar } from '@/components/token-avatar';
import { Card, Note, Row, TxButton, ConnectOr, AddrLink, TxLink } from '@/components/buyback/ui';
import { useSliceStatus, useSliceTx } from '@/lib/hooks/use-slice';
import { REWARDS_POOL_ABI } from '@/lib/buybackArtifacts';
import { SliceContracts } from '@/components/slice/slice-contracts';
import { PENDING_REVIEW, AUTOCLAIM_NOTE, FOOTER, HOW_IT_WORKS, NOT_LIVE, REWARDS_POOL, SLICE_DISTRIBUTOR_ADDRESS, SLICE_EPOCH_DATA_URL, SLICE_ESCROW_ADDRESS, STAKER_SUB, VALUE_NOTE, fmtPT, fmtToken, fmtUTC, pctOf, sliceLive, type Addr } from '@/lib/slice';

function countdown(sec: number) {
  const s = Math.max(0, sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m ${String(s % 60).padStart(2, '0')}s`;
}

function TokenLabel({ token, symbol }: { token: string; symbol?: string }) {
  return (
    <Link href={`/token/${token}`} className="inline-flex items-center gap-2 underline">
      <TokenAvatar symbol={symbol || token.slice(2, 4)} size="sm" className="h-5 w-5 text-[9px]" />
      {symbol || `${token.slice(0, 8)}…`}
    </Link>
  );
}

export function SliceStaker() {
  const live = sliceLive();
  const { data: st } = useSliceStatus();
  const { send, pending, client, address } = useSliceTx();
  const claims = useQuery({
    queryKey: ['slice', 'claims', address], enabled: live && !!address,
    queryFn: async () => (await fetch(`/api/slice/claims?account=${address}`, { cache: 'no-store' })).json(),
  });
  const stake = useQuery({
    queryKey: ['slice', 'stake', address], enabled: live && !!client && !!address,
    queryFn: async () => client!.readContract({ address: REWARDS_POOL as Addr, abi: REWARDS_POOL_ABI, functionName: 'balanceOf', args: [address] } as any) as Promise<bigint>,
  });
  const [now, setNow] = useState(0);
  useEffect(() => { const t = () => setNow(Math.floor(Date.now() / 1000)); t(); const id = setInterval(t, 1000); return () => clearInterval(id); }, []);
  const items: any[] = (claims.data?.items ?? []).filter((i: any) => BigInt(i.claimable) > BigInt(0));
  const slices: any[] = st?.slices ?? [];
  const releasable = slices.filter((x) => BigInt(x.releasable) > BigInt(0)).map((x) => BigInt(x.id));

  const claimAll = async () => {
    for (let i = 0; i < items.length; i += 20) {
      const b = items.slice(i, i + 20);
      const r = await send({ key: 'claim', address: SLICE_DISTRIBUTOR_ADDRESS as Addr, abi: 'distributor', functionName: 'claimMany', args: [address, b.map((x) => x.token), b.map((x) => BigInt(x.cumulative)), b.map((x) => x.proof)], success: 'Claimed' });
      if (!r) return;
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Airdrop slice for POLYDASH stakers</h1>
        <p className="mt-1 text-[14px] text-white/65">{STAKER_SUB}</p>
      </div>
      {!live && <Note>{NOT_LIVE}</Note>}
      <Card title="How it works">
        <ol className="list-decimal space-y-1 pl-5 text-[13px] text-white/70">{HOW_IT_WORKS.map((s) => <li key={s}>{s}</li>)}</ol>
        <p className="mt-3 text-[12px]"><Link href="/rewards-pool" className="text-white/80 underline">Go to the POLYDASH Rewards Pool</Link></p>
      </Card>

      <Card title="Your wallet">
        {!live ? <p className="text-[13px] text-white/55">Nothing to show yet.</p> : (
          <div className="space-y-2">
            <Row label="Your POLYDASH stake">{fmtToken(stake.data ?? BigInt(0))} POLYDASH</Row>
            {(claims.data?.recentStakes ?? []).map((r: any) => (
              <Row key={r.tx} label={`Recent stake ${fmtToken(r.amount)} POLYDASH`}>counts from {fmtPT(r.countsFrom)}</Row>
            ))}
            {claims.data?.mismatch && <Note>{PENDING_REVIEW}</Note>}
            {claims.data && claims.data.epoch == null && !claims.data.mismatch && <p className="text-[13px] text-white/55">No weekly list yet</p>}
            {(claims.data?.items ?? []).map((i: any) => (
              <div key={i.token} className="rounded-xl bg-white/[0.03] p-2">
                <Row label="Token"><TokenLabel token={i.token} symbol={i.symbol} /></Row>
                <Row label="Cumulative">{fmtToken(i.cumulative)}</Row>
                <Row label="Claimed">{fmtToken(i.claimed)}</Row>
                <Row label="Claimable">{fmtToken(i.claimable)}</Row>
              </div>
            ))}
            <p className="text-[12px] text-white/55">{AUTOCLAIM_NOTE}</p>
          </div>
        )}
        <div className="mt-3"><ConnectOr><TxButton testId="claim-all" onClick={claimAll} busy={pending === 'claim'} disabled={!live || !items.length || !!claims.data?.mismatch}>Claim all</TxButton></ConnectOr></div>
      </Card>

      <Card title="Slices" action={<TxButton variant="outline" testId="release-now" onClick={() => send({ key: 'release', address: SLICE_ESCROW_ADDRESS as Addr, abi: 'escrow', functionName: 'releaseMany', args: [releasable], success: 'Released' })} busy={pending === 'release'} disabled={!live || !releasable.length}>Release now</TxButton>}>
        {!slices.length ? <p className="text-[13px] text-white/55">No slices yet.</p> : slices.map((x) => (
          <div key={x.id} className="border-b border-white/5 py-2">
            <Row label="Token"><TokenLabel token={x.token} symbol={x.symbol} /></Row>
            <Row label="Creator"><AddrLink address={x.creator} /></Row>
            <Row label="Share of supply">{x.bps != null ? pctOf(x.bps) : '-'}</Row>
            <Row label="Amount">{fmtToken(x.amount)}</Row>
            <Row label="Period">{fmtUTC(x.start)} to {fmtUTC(x.start + x.duration)}</Row>
            <Row label="Released so far">{fmtToken(x.released)}</Row>
            <Row label="Remaining">{fmtToken(BigInt(x.amount) - BigInt(x.released))}</Row>
            {x.tx && <Row label="Tx"><TxLink hash={x.tx} /></Row>}
          </div>
        ))}
      </Card>

      <Card title="Weekly lists" action={<TxButton variant="outline" testId="activate" onClick={() => send({ key: 'activate', address: SLICE_DISTRIBUTOR_ADDRESS as Addr, abi: 'distributor', functionName: 'activateRoot', success: 'Activated' })} busy={pending === 'activate'} disabled={!live || !st?.pending || now < st.pending.activatableAt}>Activate</TxButton>}>
        {st?.weekly ? (
          <div className="mb-3 space-y-2" data-testid="weekly-epochs">
            <p className="text-[12px] text-white/60">
              Latest file: <a className="underline" href={st.weekly.url} target="_blank" rel="noopener noreferrer">{st.weekly.file}</a>
              {st.weekly.rootMatches ? ' (matches the on-chain list)' : ` (${PENDING_REVIEW})`}
            </p>
            {(st.weekly.epochs as any[]).slice().reverse().map((e) => (
              <div key={e.epoch} className="rounded-xl bg-white/[0.03] p-2">
                <Row label={`Week ${e.epoch}`}>{fmtUTC(e.start)} to {fmtUTC(e.end)}</Row>
                <Row label="Stakers">{e.stakers}</Row>
                {(e.tokens as any[]).map((t) => (
                  <Row key={t.token} label={<TokenLabel token={t.token} symbol={t.symbol} /> as any}>pot {fmtToken(t.pot)} / allocated {fmtToken(t.allocated)}</Row>
                ))}
              </div>
            ))}
          </div>
        ) : live && st && <p className="mb-3 text-[13px] text-white/55">No weekly list yet</p>}
        {st?.pending && <Row label={`Pending week ${st.pending.epoch}`}>{now >= st.pending.activatableAt ? 'Review window ended, ready to activate' : `claimable in ${countdown(st.pending.activatableAt - now)} (${fmtPT(st.pending.activatableAt)})`}</Row>}
        {!!(st?.lists ?? []).length && <p className="mt-2 text-[12px] font-medium text-white/70">On-chain history</p>}
        {!(st?.lists ?? []).length ? null : (st.lists as any[]).slice().reverse().map((l, i) => (
          <div key={i} className="border-b border-white/5 py-2">
            <Row label={`Week ${l.epoch}`}>{l.event === 'RootActivated' ? 'Activated' : l.event === 'RootVetoed' ? 'Cancelled' : st?.pending && String(st.pending.root).toLowerCase() === String(l.root).toLowerCase() && now < st.pending.activatableAt ? `Pending, ${countdown(st.pending.activatableAt - now)} left` : 'Proposed'}</Row>
            <Row label="Root">{String(l.root).slice(0, 18)}</Row>
            {l.dataHash && <Row label="Data hash">{String(l.dataHash).slice(0, 18)}</Row>}
            <Row label="Data"><a className="underline" href={`${SLICE_EPOCH_DATA_URL}epoch_${l.epoch}.json`} target="_blank" rel="noopener noreferrer">epoch_{l.epoch}.json</a></Row>
            <Row label="Tx"><TxLink hash={l.tx} /></Row>
          </div>
        ))}
      </Card>

      <Card title="Contracts"><SliceContracts /></Card>

      <Note tone="muted">{VALUE_NOTE}</Note>
      <p className="text-[11px] text-white/45">{FOOTER}</p>
    </div>
  );
}
