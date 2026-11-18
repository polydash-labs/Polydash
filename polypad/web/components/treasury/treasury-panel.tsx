'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAccount, useReadContract } from 'wagmi';
import { erc20Abi } from 'viem';
import { ArrowUpRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { robinhoodChain } from '@/lib/chain';
import { shortenAddress } from '@/lib/format';
import { getExplorerAddressUrl, getExplorerTxUrl } from '@/lib/contracts/addresses';
import { useTreasury, useTreasuryTx, type TreasuryData } from '@/lib/hooks/use-treasury';
import {
  RULE_FIELDS, RULE_LABELS, fmtAmount, fmtDateTime, fmtDuration, fmtEth, fmtRule, isPolydashToken, isZero, kindLabel, sameAddr, sourcifyUrl,
  type Addr, type DecodedChange, type RulesJson,
} from '@/lib/treasury';
import { TreasuryNote } from '@/components/treasury/notes';
import { CreatorControls } from '@/components/treasury/creator-controls';
import { ExecutorControls } from '@/components/treasury/executor-controls';
import { AirdropClaim } from '@/components/treasury/airdrop-claim';
import { FeeRouting } from '@/components/fee-routing';
import { useQueryClient } from '@tanstack/react-query';

const card = 'rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5';
const sub = 'rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 sm:p-4';

function useNow() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-[13px]">
      <dt className="text-white/45">{label}</dt>
      <dd className="min-w-0 break-words text-right font-mono text-white/85">{children}</dd>
    </div>
  );
}

function AddrLink({ a }: { a: string }) {
  return (
    <a href={getExplorerAddressUrl(a)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 hover:text-white">
      {shortenAddress(a)} <ArrowUpRight className="h-3 w-3" />
    </a>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-white/55">{children}</h3>;
}

function ChangeDetails({ d, current, decimals, symbol }: { d: DecodedChange; current?: RulesJson; decimals: number; symbol: string }) {
  if ('raw' in d) return <p className="break-all font-mono text-[12px] text-white/50">Data: {d.raw}</p>;
  switch (d.kind) {
    case 0: {
      const r = (d as { rules: RulesJson }).rules;
      const diffs = RULE_FIELDS.filter((f) => String((r as any)[f]) !== String((current as any)?.[f]));
      if (!diffs.length) return <p className="text-[12px] text-white/50">No rule values differ from the current rules.</p>;
      return (
        <ul className="space-y-1 text-[12px]">
          {diffs.map((f) => (
            <li key={f} className="flex flex-wrap justify-between gap-2">
              <span className="text-white/50">{RULE_LABELS[f]}</span>
              <span className="font-mono text-white/80">
                {current ? fmtRule(f, (current as any)[f], decimals, symbol) : '—'} → {fmtRule(f, (r as any)[f], decimals, symbol)}
              </span>
            </li>
          ))}
        </ul>
      );
    }
    case 1: {
      const w = d as { asset: Addr; amount: string; to: Addr };
      const eth = isZero(w.asset);
      return (
        <p className="text-[12px] text-white/70">
          Withdraw <span className="font-mono">{eth ? fmtEth(w.amount) : `${fmtAmount(w.amount, decimals)} ${symbol}`}</span> to <span className="font-mono"><AddrLink a={w.to} /></span>
        </p>
      );
    }
    case 2:
      return <p className="text-[12px] text-white/70">Add agent <span className="font-mono"><AddrLink a={(d as { executor: Addr }).executor} /></span></p>;
    case 3:
      return <p className="text-[12px] text-white/70">New timelock: <span className="font-mono">{fmtDuration((d as { delay: number }).delay)}</span></p>;
    case 4: {
      const a = d as { root: string; total: string; claimWindow: number };
      return (
        <div className="space-y-0.5 text-[12px] text-white/70">
          <p>Total <span className="font-mono">{fmtAmount(a.total, decimals)} {symbol}</span>, claim window <span className="font-mono">{fmtDuration(a.claimWindow)}</span></p>
          <p className="break-all font-mono text-white/45">Root {a.root}</p>
        </div>
      );
    }
    default:
      return null;
  }
}

function histArgs(args: Record<string, unknown>) {
  return Object.entries(args ?? {})
    .filter(([k]) => !/^\d+$/.test(k))
    .slice(0, 4)
    .map(([k, v]) => {
      const s = String(v);
      return `${k}: ${/^0x[0-9a-fA-F]{40}$/.test(s) ? shortenAddress(s) : s.length > 22 ? `${s.slice(0, 10)}…${s.slice(-6)}` : s}`;
    })
    .join(' · ');
}

export function TreasuryPanel({ token, symbol, creator, graduated }: { token: string; symbol: string; creator?: string; launch?: string; graduated: boolean }) {
  const { address } = useAccount();
  const { data: t, isPending } = useTreasury(token);
  const now = useNow();
  const { send, pending } = useTreasuryTx();
  const qc = useQueryClient();
  const refreshFees = async () => {
    try { await fetch(`/api/treasury/${token}?fresh=1`, { cache: 'no-store' }); } catch (e) { console.error('treasury fresh refetch failed', e); }
    await qc.invalidateQueries({ queryKey: ['treasury'] });
  };
  const { data: dec } = useReadContract({ address: token as Addr, abi: erc20Abi, functionName: 'decimals', chainId: robinhoodChain.id, query: { enabled: !!t?.vault } });
  const decimals = typeof dec === 'number' ? dec : 18;

  if (!t || isPending) return null;
  if (!t.vault) {
    if (!sameAddr(address, creator) || isPolydashToken(token)) return null;
    return (
      <section id="treasury" className={card}>
        <h2 className="text-[15px] font-semibold">Treasury rules</h2>
        <p className="mt-1.5 text-[13px] text-white/55">Set public limits for treasury buybacks, reward pools and airdrops. Your wallet stays the owner; changes wait for a public timelock.</p>
        <Button asChild size="sm" className="mt-3"><Link href={`/treasury/setup?token=${token}`}>Set up treasury rules</Link></Button>
        <TreasuryNote className="mt-3" />
      </section>
    );
  }

  const d = t as TreasuryData & { vault: Addr };
  const isOwner = sameAddr(address, d.owner);
  const isExecutor = !!address && (!!d.openExecution || (d.executors ?? []).some((e) => sameAddr(e, address)));
  const tok = (v?: string) => `${fmtAmount(v ?? '0', decimals)} ${symbol}`;
  const nextAt = d.nextBuybackAt ?? 0;

  return (
    <section id="treasury" className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">Treasury rules</h2>
        <span className={d.paused ? 'rounded-full bg-yellow-400/10 px-2.5 py-0.5 text-[11px] font-medium text-yellow-300' : 'rounded-full bg-polydash-green/15 px-2.5 py-0.5 text-[11px] font-medium text-polydash-green'}>
          {d.paused ? 'Paused' : 'Active'}
        </span>
      </div>
      <TreasuryNote className="mt-3" />

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className={sub}>
          <H>Status</H>
          <dl className="divide-y divide-white/5">
            <Row label="Owner">{d.owner ? <AddrLink a={d.owner} /> : '—'}</Row>
            <Row label="Vault"><AddrLink a={d.vault} /></Row>
            <Row label="Source">
              <a href={sourcifyUrl(d.vault)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 hover:text-white">Sourcify <ArrowUpRight className="h-3 w-3" /></a>
            </Row>
            <Row label="Timelock">{fmtDuration(d.timelockDelay ?? 0)}</Row>
          </dl>
        </div>
        <div className={sub}>
          <H>Budget</H>
          <dl className="divide-y divide-white/5">
            <Row label="ETH">{fmtEth(d.balances?.eth ?? '0')}</Row>
            <Row label="Tokens">{tok(d.balances?.token)}</Row>
            <Row label="Reserved for airdrops">{tok(d.balances?.reserved)}</Row>
            <Row label="Available tokens">{tok(d.balances?.available)}</Row>
          </dl>
        </div>
      </div>

      <div className={`${sub} mt-3`}>
        <H>Limits</H>
        <dl className="grid grid-cols-1 gap-x-6 divide-white/5 sm:grid-cols-2">
          {RULE_FIELDS.map((f) => <Row key={f} label={RULE_LABELS[f]}>{fmtRule(f, (d.rules as any)?.[f], decimals, symbol)}</Row>)}
          <Row label="Buyback ETH left today">{fmtEth(d.remainingToday ?? '0')}</Row>
          <Row label="Next buyback">{now == null ? '—' : nextAt <= now ? 'Now' : fmtDateTime(nextAt)}</Row>
        </dl>
        <div className="mt-2 border-t border-white/5 pt-2 text-[13px]">
          <span className="text-white/45">Agents: </span>
          {d.openExecution ? <span className="text-white/80">Anyone can trigger</span>
            : (d.executors ?? []).length ? <span className="inline-flex flex-wrap gap-2 font-mono text-white/80">{d.executors!.map((e) => <AddrLink key={e} a={e} />)}</span>
            : <span className="text-white/60">None yet</span>}
        </div>
      </div>

      {(d.pendingChanges ?? []).length > 0 && (
        <div className={`${sub} mt-3`}>
          <H>Pending changes</H>
          <ul className="space-y-3">
            {d.pendingChanges!.map((c) => {
              const ready = now != null && now >= c.eta;
              return (
                <li key={c.id} className="rounded-lg border border-white/[0.06] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[13px] font-medium">#{c.id} {kindLabel(c.kind)}</span>
                    <span className="font-mono text-[12px] text-white/50">
                      {now == null ? '' : ready ? 'Ready to execute' : `Executable in ${fmtDuration(c.eta - now)}`}
                    </span>
                  </div>
                  <div className="mt-2"><ChangeDetails d={c.decoded} current={d.rules} decimals={decimals} symbol={symbol} /></div>
                  {address && (
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <Button size="sm" disabled={!ready || !!pending} onClick={() => send({ key: `exec-${c.id}`, address: d.vault, abi: 'vault', functionName: 'execute', args: [BigInt(c.id)], success: 'Change executed' })}>
                        {pending === `exec-${c.id}` && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Execute
                      </Button>
                      {isOwner && (
                        <Button size="sm" variant="outline" disabled={!!pending} onClick={() => send({ key: `cancel-${c.id}`, address: d.vault, abi: 'vault', functionName: 'cancel', args: [BigInt(c.id)], success: 'Change cancelled' })}>
                          {pending === `cancel-${c.id}` && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Cancel
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {d.feeRouting && (
        <div className={`${sub} mt-3`}>
          <H>Fee routing</H>
          <FeeRouting
            symbol={symbol}
            vault={d.vault}
            pendingPayoutWallet={d.pendingPayoutWallet ?? null}
            feeRouting={d.feeRouting}
            onChanged={refreshFees}
            showNote
          />
        </div>
      )}

      <div className={`${sub} mt-3`}>
        <H>Totals</H>
        <dl className="divide-y divide-white/5">
          <Row label="ETH used for buybacks">{fmtEth(d.totals?.ethSpent ?? '0')}</Row>
          <Row label="Tokens bought">{tok(d.totals?.tokensBought)}</Row>
          <Row label="Tokens burned">{tok(d.totals?.tokensBurned)}</Row>
        </dl>
      </div>

      {(d.pools ?? []).length > 0 && (
        <div className={`${sub} mt-3`}>
          <H>Reward pools</H>
          <ul className="space-y-2">
            {d.pools!.map((p) => {
              const ended = p.endTime != null && now != null && now >= p.endTime;
              return (
                <li key={p.address} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/stake/${p.address}`} className="font-mono text-white/80 hover:text-white">{shortenAddress(p.address)}</Link>
                    <span className="text-[12px] text-white/45">{p.endTime ? (ended ? `Ended ${fmtDateTime(p.endTime)}` : `Ends ${fmtDateTime(p.endTime)}`) : ''}</span>
                  </div>
                  {address && (
                    <Button size="sm" variant="outline" disabled={!!pending}
                      onClick={() => send({ key: `collect-${p.address}`, address: d.vault, abi: 'vault', functionName: 'collectFromPool', args: [p.address, ended], success: 'Collected from pool' })}>
                      {pending === `collect-${p.address}` && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                      {ended ? 'Collect remaining rewards' : 'Collect rewards back'}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {(d.rounds ?? []).length > 0 && (
        <div className={`${sub} mt-3`}>
          <H>Airdrop rounds</H>
          <ul className="space-y-3">
            {d.rounds!.map((r) => {
              const over = now != null && now >= r.deadline;
              return (
                <li key={r.id} className="rounded-lg border border-white/[0.06] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                    <span className="font-medium">Round #{r.id}</span>
                    <span className="text-[12px] text-white/50">{r.closed ? 'Closed' : over ? 'Claim window ended' : `Claim until ${fmtDateTime(r.deadline)}`}</span>
                  </div>
                  <p className="mt-1 font-mono text-[12px] text-white/60">{tok(r.claimed)} of {tok(r.total)} claimed</p>
                  {!r.closed && !over && <div className="mt-2"><AirdropClaim token={token} vault={d.vault} round={r.id} decimals={decimals} symbol={symbol} /></div>}
                  {!r.closed && over && address && (
                    <Button size="sm" variant="outline" className="mt-2" disabled={!!pending}
                      onClick={() => send({ key: `close-${r.id}`, address: d.vault, abi: 'vault', functionName: 'closeRound', args: [BigInt(r.id)], success: 'Round closed' })}>
                      {pending === `close-${r.id}` && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Close round
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {isExecutor && <div className="mt-3"><ExecutorControls t={d} decimals={decimals} symbol={symbol} graduated={graduated} /></div>}
      {isOwner && <div className="mt-3"><CreatorControls t={d} token={token as Addr} decimals={decimals} symbol={symbol} /></div>}

      <div className={`${sub} mt-3`}>
        <H>History</H>
        {(d.history ?? []).length === 0 ? <p className="text-[13px] text-white/50">No events yet.</p> : (
          <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {d.history!.map((h) => (
              <li key={`${h.tx}-${h.logIndex}`} className="flex items-start justify-between gap-3 text-[12px]">
                <div className="min-w-0">
                  <span className="font-medium text-white/80">{h.event}</span>
                  <span className="ml-2 break-all font-mono text-white/45">{histArgs(h.args)}</span>
                </div>
                <a href={getExplorerTxUrl(h.tx)} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-0.5 text-white/50 hover:text-white">
                  Tx <ArrowUpRight className="h-3 w-3" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
