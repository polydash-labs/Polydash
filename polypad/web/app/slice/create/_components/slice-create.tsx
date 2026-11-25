'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { erc20Abi, formatEther, parseAbiItem } from 'viem';
import { Card, Note, Row, TxButton, ConnectOr } from '@/components/buyback/ui';
import { useSliceTx } from '@/lib/hooks/use-slice';
import { SliceContracts } from '@/components/slice/slice-contracts';
import { LAUNCH_MIN_ABI, SLICE_ESCROW_ABI, SLICE_LIMITS } from '@/lib/sliceArtifacts';
import { DEPLOY_BLOCK } from '@/lib/launches-core';
import { CREATE_SUB, FOOTER, HOW_IT_WORKS, LAUNCH_FACTORIES, NOT_CREATOR, NOT_LIVE, PERIODS, SLICE_ESCROW_ADDRESS, fmtToken, isZeroAddr, sameAddress, sliceLive, type Addr } from '@/lib/slice';

const LC = parseAbiItem('event LaunchCreated(address indexed launch, address indexed token, address indexed creator)');

export function SliceCreate() {
  const live = sliceLive();
  const escrow = SLICE_ESCROW_ADDRESS as Addr | null;
  const { send, pending, client, address } = useSliceTx();
  const [token, setToken] = useState('');
  const [bps, setBps] = useState<number>(SLICE_LIMITS.defaultBps);
  const [days, setDays] = useState<number>(SLICE_LIMITS.defaultDurationDays);
  const [ack, setAck] = useState(false);
  useEffect(() => { const t = new URLSearchParams(location.search).get('token'); if (t) setToken(t); }, []);

  const mine = useQuery({
    queryKey: ['slice', 'mine', address], enabled: live && !!client && !!address,
    queryFn: async () => {
      const out: string[] = [];
      const latest = await client!.getBlockNumber();
      for (const f of LAUNCH_FACTORIES) {
        for (let b = DEPLOY_BLOCK; b <= latest; b += BigInt(9_900_000)) {
          const to = b + BigInt(9_899_999) > latest ? latest : b + BigInt(9_899_999);
          const l = await client!.getLogs({ address: f as Addr, event: LC, args: { creator: address }, fromBlock: b, toBlock: to });
          l.forEach((x) => x.args.token && out.push(x.args.token));
        }
      }
      return out;
    },
  });

  const info = useQuery({
    queryKey: ['slice', 'tok', token, address], enabled: live && !!client && !!escrow && /^0x[0-9a-fA-F]{40}$/.test(token),
    queryFn: async () => {
      const t = token as Addr;
      const launch = (await client!.readContract({ address: escrow!, abi: SLICE_ESCROW_ABI, functionName: 'launchOf', args: [t] } as any)) as Addr;
      if (isZeroAddr(launch)) return { eligible: false } as any;
      const [creator, supply, sym, bal, allow, used] = await Promise.all([
        client!.readContract({ address: launch, abi: LAUNCH_MIN_ABI, functionName: 'creator' }),
        client!.readContract({ address: t, abi: erc20Abi, functionName: 'totalSupply' }),
        client!.readContract({ address: t, abi: erc20Abi, functionName: 'symbol' }),
        address ? client!.readContract({ address: t, abi: erc20Abi, functionName: 'balanceOf', args: [address] }) : BigInt(0),
        address ? client!.readContract({ address: t, abi: erc20Abi, functionName: 'allowance', args: [address, escrow!] }) : BigInt(0),
        client!.readContract({ address: escrow!, abi: SLICE_ESCROW_ABI, functionName: 'committedBps', args: [t] } as any),
      ]);
      return { eligible: sameAddress(creator as string, address), supply: supply as bigint, sym: sym as string, bal: bal as bigint, allow: allow as bigint, used: Number(used) };
    },
  });
  const d = info.data;
  const left = d ? SLICE_LIMITS.contractMaxTotalBps - d.used : SLICE_LIMITS.uiMaxBps;
  const maxBps = Math.max(0, Math.min(SLICE_LIMITS.uiMaxBps, left));
  const effBps = Math.min(bps, maxBps);
  const amount = useMemo(() => (d?.supply ? (d.supply * BigInt(effBps)) / BigInt(10000) : BigInt(0)), [d, effBps]);
  const pct = (effBps / 100).toFixed(2);
  const canAct = live && !!d?.eligible && ack && maxBps >= SLICE_LIMITS.uiMinBps && (d?.bal ?? BigInt(0)) >= amount && amount > BigInt(0);

  const commit = async () => {
    if (!escrow || !d) return;
    if (d.allow < amount) { const r = await send({ key: 'approve', address: token as Addr, abi: 'erc20', functionName: 'approve', args: [escrow, amount], success: 'Approved' }); if (!r) return; }
    await send({ key: 'commit', address: escrow, abi: 'escrow', functionName: 'commitSlice', args: [token, amount, BigInt(days * 86400)], success: 'Slice committed' });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Airdrop slice</h1>
        <p className="mt-1 text-[14px] text-white/65">{CREATE_SUB}</p>
      </div>
      {!live && <Note>{NOT_LIVE}</Note>}
      <Card title="How it works">
        <ol className="list-decimal space-y-1 pl-5 text-[13px] text-white/70">{HOW_IT_WORKS.map((s) => <li key={s}>{s}</li>)}</ol>
      </Card>
      <Card title="Your slice">
        <div className="space-y-3">
          <label className="block text-[12px] text-white/55">Token
            <select className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 p-2 text-[13px] text-white" value={token} disabled={!live} onChange={(e) => setToken(e.target.value)}>
              <option value="">Select a token you launched</option>
              {token && !(mine.data ?? []).some((t) => sameAddress(t, token)) && <option value={token}>{token}</option>}
              {(mine.data ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          {live && d && !d.eligible && <Note>{NOT_CREATOR}</Note>}
          {d?.eligible && <p className="text-[12px] text-white/60">Already committed: {(d.used / 100).toFixed(2)}% of 5% maximum</p>}
          <label className="block text-[12px] text-white/55">Share of supply: {pct}%
            <input type="range" className="mt-1 w-full" min={SLICE_LIMITS.uiMinBps} max={Math.max(SLICE_LIMITS.uiMinBps, maxBps)} step={5} value={effBps} disabled={!live || !d?.eligible} onChange={(e) => setBps(Number(e.target.value))} />
          </label>
          {d?.eligible && <Row label="Amount">{fmtToken(amount)} {d.sym}</Row>}
          {d?.eligible && d.bal < amount && <Note>Your wallet holds {fmtToken(d.bal)}. Slices are usually funded from the dev buy.</Note>}
          <div className="flex flex-wrap gap-2">
            {PERIODS.map((p) => (
              <button key={p} type="button" disabled={!live} onClick={() => setDays(p)} className={`rounded-full border px-3 py-1 text-[12px] ${days === p ? 'border-white bg-white text-black' : 'border-white/15 text-white/70'} disabled:opacity-50`}>{p} days</button>
            ))}
          </div>
          {d?.eligible && (
            <p className="text-[13px] text-white/80">{fmtToken(amount)} {d.sym} ({pct}% of supply) released evenly over {days} days to POLYDASH Rewards Pool stakers, starting now. Once committed it cannot be withdrawn by anyone, including you.</p>
          )}
          <label className="flex items-center gap-2 text-[12px] text-white/75">
            <input type="checkbox" checked={ack} disabled={!live} onChange={(e) => setAck(e.target.checked)} /> I understand the slice cannot be withdrawn.
          </label>
          <ConnectOr>
            <TxButton testId="commit-slice" onClick={commit} busy={!!pending} disabled={!canAct}>{d && d.allow < amount ? 'Approve and commit slice' : 'Commit slice'}</TxButton>
          </ConnectOr>
          {amount > BigInt(0) && <span className="hidden">{formatEther(amount)}</span>}
        </div>
      </Card>
      <Card title="Contracts"><SliceContracts /></Card>
      <p className="text-[11px] text-white/45">{FOOTER}</p>
    </div>
  );
}
