'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { formatUnits, parseUnits, type Abi } from 'viem';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FundVaultV3ABI } from '@/lib/contracts/fund-v3-abi';
import { formatFundEth } from '@/lib/fund/model';
import { utcDate } from '@/lib/fund/phase3';
import { countdownLabel, phase6TxError } from '@/lib/fund/phase6';
import { FUND_LIQUIDITY_FACET, FUND_STAKE_FACET, POLYDASH_WETH_KEY, snapTick } from '@/lib/fund/phase7';
import { usePolydashStakePools, useV3Positions } from '@/lib/fund/use-v3';
import type { Phase3Detail, usePhase3Tx } from '@/lib/fund/use-phase3';
import { shortenAddress } from '@/lib/format';
import { ContractLink } from '../../_components/phase3-ui';
import { Card } from './phase3-panels';

type Tx = ReturnType<typeof usePhase3Tx>;
const abi = FundVaultV3ABI as Abi;
const KEY = POLYDASH_WETH_KEY;
const fmt = (v: bigint) => Number(formatUnits(v, 18)).toLocaleString('en-US', { maximumFractionDigits: 6 });

export function V3Section({ fund, isManager, tx }: { fund: Phase3Detail; isManager: boolean; tx: Tx }) {
  const q = useV3Positions(fund.vault);
  const pools = usePolydashStakePools(isManager);
  const [now, setNow] = useState(0);
  useEffect(() => { setNow(Math.floor(Date.now() / 1000)); const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000); return () => clearInterval(t); }, []);
  const d = q.data;
  const send = (key: string, functionName: string, args: unknown[], working: string, success: string) =>
    tx.send({ key, address: fund.vault, abi, functionName, args, working, success, mapError: phase6TxError });

  const [lo, setLo] = useState('-887200');
  const [hi, setHi] = useState('887200');
  const [capPct, setCapPct] = useState('30');
  const [reason, setReason] = useState('');
  const [liq, setLiq] = useState('');
  const [max0, setMax0] = useState('');
  const [max1, setMax1] = useState('');
  const [pool, setPool] = useState('');
  const [stakeAmt, setStakeAmt] = useState('');
  const num = (s: string) => { try { return s.trim() ? parseUnits(s.trim(), 18) : 0n; } catch { return 0n; } };
  const busy = tx.pending !== null;

  return (
    <div className="space-y-5">
      <Card title="Liquidity positions (LP yield)" subtitle="POLYDASH/WETH liquidity this tokenized fund provides, and the trading fees it has collected (harvested).">
        {q.isLoading ? <p className="py-4 text-[13px] text-white/50"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading…</p>
          : q.isError ? <p className="py-4 text-[13px] text-white/55">Could not read liquidity positions right now. It will retry shortly.</p>
          : !d?.positions.length ? <p className="py-4 text-[13px] text-white/55">No liquidity positions yet.</p>
          : d.positions.map((p) => (
            <div key={p.id} className="space-y-1 border-b border-white/5 py-2 text-[12px] text-white/75 last:border-0">
              <p className="text-white">Pool: POLYDASH/WETH {p.active ? '' : '(closed)'}</p>
              <p>In the pool: {fmt(p.amount0)} WETH + {fmt(p.amount1)} POLYDASH</p>
              <p>Fees harvested so far: {fmt(p.fees0)} WETH + {fmt(p.fees1)} POLYDASH{p.lastHarvestAt ? ` · last ${utcDate(p.lastHarvestAt)}` : ''}</p>
            </div>
          ))}
        {d && <p className="mt-2 text-[12px] text-white/55">Total value in liquidity: {formatFundEth(d.lpValue)} ETH</p>}
        {!!d?.proposals.length && (
          <div className="mt-3 space-y-1 border-t border-white/10 pt-3 text-[12px] text-white/70">
            <p className="text-white">Liquidity proposals (2-day public wait)</p>
            {d.proposals.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>#{p.id} · up to {p.maxLpBps / 100}% · {p.reason || 'no reason given'} · {p.status === 0 ? (now >= p.readyAt ? 'Ready' : `Ready in ${countdownLabel(p.readyAt - now)}`) : p.status === 1 ? 'Added' : 'Cancelled'}</span>
                {isManager && p.status === 0 && (
                  <span className="flex gap-2">
                    <Button size="sm" variant="secondary" disabled={busy || now < p.readyAt} onClick={() => send(`lpx${p.id}`, 'executeLiquidity', [BigInt(p.id)], 'Approving the liquidity position', 'Liquidity position approved')}>Approve (sign 1 transaction)</Button>
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => send(`lpc${p.id}`, 'cancelLiquidityProposal', [BigInt(p.id)], 'Cancelling', 'Proposal cancelled')}>Cancel</Button>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Staked POLYDASH" subtitle="POLYDASH this tokenized fund has put in staking pools, and the rewards it has earned.">
        {!d?.stakes.length ? <p className="py-4 text-[13px] text-white/55">Nothing staked yet.</p> : d.stakes.map((s) => (
          <div key={s.pool} className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 py-2 text-[12px] text-white/75 last:border-0">
            <span>Pool {shortenAddress(s.pool)} · {fmt(s.amount)} POLYDASH ({formatFundEth(s.valueEth)} ETH) · rewards earned {fmt(s.earned)}</span>
            {isManager && (
              <span className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => send(`cl${s.pool}`, 'claimRewards', [s.pool, 0n], 'Claiming rewards', 'Rewards claimed')}>Claim rewards</Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => send(`un${s.pool}`, 'unstakeAll', [s.pool], 'Unstaking', 'Unstaked')}>Unstake all</Button>
              </span>
            )}
          </div>
        ))}
        <p className="mt-2 text-[11px] text-white/45">When you exit, you are paid from liquid holdings only. Money in liquidity or staking is paid out after the manager removes or unstakes it.</p>
      </Card>

      {isManager && (
        <Card title="Manager: liquidity and staking" subtitle="Each action is 1 transaction you sign. New liquidity positions wait 2 days in public first.">
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-white">1. Propose a POLYDASH/WETH liquidity position</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Input value={lo} onChange={(e) => setLo(e.target.value)} placeholder="Lower price tick" aria-label="Lower price tick" />
              <Input value={hi} onChange={(e) => setHi(e.target.value)} placeholder="Upper price tick" aria-label="Upper price tick" />
              <Input value={capPct} onChange={(e) => setCapPct(e.target.value)} placeholder="Max % of fund" aria-label="Most of the tokenized fund in this position, in %" />
            </div>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Your thesis: why this position (shown publicly)" />
            <p className="text-[11px] text-white/45">Price range ticks are rounded to steps of 200. The default range covers all prices. Most per position: 50%.</p>
            <Button size="sm" className="bg-white text-black hover:bg-white/90" disabled={busy || !reason.trim()} onClick={() => {
              const l = snapTick(Number(lo)); const h = snapTick(Number(hi));
              send('lpp', 'proposeLiquidity', [KEY, l, h, BigInt(Math.round(Math.min(50, Math.max(1, Number(capPct) || 30)) * 100)), reason.trim(), ''], 'Proposing', 'Proposal published. It can be approved in 2 days.');
            }}>Propose (sign 1 transaction)</Button>
          </div>
          <div className="mt-4 space-y-2 border-t border-white/10 pt-3">
            <p className="text-[13px] font-medium text-white">2. Add or remove liquidity, harvest fees</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Input value={liq} onChange={(e) => setLiq(e.target.value)} placeholder="Liquidity units" aria-label="Liquidity units" />
              <Input value={max0} onChange={(e) => setMax0(e.target.value)} placeholder="Max WETH" aria-label="Most WETH to use" />
              <Input value={max1} onChange={(e) => setMax1(e.target.value)} placeholder="Max POLYDASH" aria-label="Most POLYDASH to use" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" disabled={busy || !/^\d+$/.test(liq.trim())} onClick={() => send('lpa', 'addLiquidity', [KEY, snapTick(Number(lo)), snapTick(Number(hi)), BigInt(liq.trim()), num(max0), num(max1)], 'Adding liquidity', 'Liquidity added')}>Add liquidity</Button>
              <Button size="sm" variant="secondary" disabled={busy || !/^\d+$/.test(liq.trim())} onClick={() => send('lpr', 'removeLiquidity', [KEY, BigInt(liq.trim()), 0n, 0n], 'Removing liquidity', 'Liquidity removed')}>Remove liquidity</Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => send('lph', 'harvestFees', [KEY], 'Harvesting fees', 'Fees harvested')}>Harvest fees</Button>
            </div>
            <p className="text-[11px] text-white/45">Fees can be harvested once every 7 days. Harvested fees stay in the vault until you pay them out as a dividend.</p>
          </div>
          <div className="mt-4 space-y-2 border-t border-white/10 pt-3">
            <p className="text-[13px] font-medium text-white">3. Stake POLYDASH</p>
            <select value={pool} onChange={(e) => setPool(e.target.value)} className="w-full rounded-md border border-white/15 bg-black px-3 py-2 text-[13px] text-white" aria-label="Staking pool">
              <option value="">{pools.isLoading ? 'Loading pools…' : 'Pick a POLYDASH staking pool'}</option>
              {(pools.data ?? []).map((p) => <option key={p.address} value={p.address}>{p.name} · {shortenAddress(p.address)}{p.apr != null ? ` · current APR (variable) ${p.apr.toFixed(1)}%` : ''}</option>)}
            </select>
            <div className="flex gap-2">
              <Input value={stakeAmt} onChange={(e) => setStakeAmt(e.target.value)} placeholder="POLYDASH amount" />
              <Button size="sm" variant="secondary" disabled={busy || !pool || num(stakeAmt) === 0n} onClick={() => send('stk', 'stake', [pool, num(stakeAmt)], 'Staking', 'Staked')}>Stake</Button>
            </div>
          </div>
        </Card>
      )}
      <div className="flex flex-wrap gap-2">
        <ContractLink label="Liquidity tools" address={FUND_LIQUIDITY_FACET} />
        <ContractLink label="Staking tools" address={FUND_STAKE_FACET} />
      </div>
    </div>
  );
}
