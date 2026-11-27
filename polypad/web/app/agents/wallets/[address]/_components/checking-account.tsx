'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { bandForScore } from '@/lib/agents/credit-score';
import { shortenAddress } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  explorerTx, formatEthShort, formatUsd6, usd6ForAmount, usdg,
  useWalletPrices,
  type LedgerRow, type WalletTokenCap,
} from '@/lib/agent-wallet/client';
import { AgentCard, AgentCardSub, AgentCardTitle } from '../../../_components/agent-cards';

/** Token coin icon — a solid circle with the token's mark, the way a consumer
 * app shows a currency. Colours are fixed (not dynamic Tailwind classes). */
function TokenIcon({ token }: { token: 'ETH' | 'USDG' | 'POLYDASH' | 'STAKED' }) {
  const style: Record<string, { bg: string; fg: string; glyph: string }> = {
    ETH: { bg: '#1f2937', fg: '#ffffff', glyph: 'Ξ' },
    USDG: { bg: '#00A152', fg: '#ffffff', glyph: '$' },
    POLYDASH: { bg: '#00E676', fg: '#000000', glyph: 'P' },
    STAKED: { bg: '#15803d', fg: '#ffffff', glyph: 'P' },
  };
  const c = style[token];
  return (
    <span
      className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-[17px] font-extrabold"
      style={{ backgroundColor: c.bg, color: c.fg }}
      aria-hidden
    >
      {c.glyph}
    </span>
  );
}

/** Smooth-scroll to a section on this page (the ledger, or the Gas top-up). */
function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Token amount with commas, up to 4 decimals — the way a bank shows a balance. */
function fmtToken(amount: bigint, decimals: number): string {
  const s = formatUnits(amount, decimals);
  const [whole, frac = ''] = s.split('.');
  const w = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const f = frac.slice(0, 4).replace(/0+$/, '');
  return f ? `${w}.${f}` : w;
}

function dateLabel(row: LedgerRow): string {
  if (row.timestamp) {
    return new Date(row.timestamp * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return `Block ${row.blockNumber.toString()}`;
}

export interface CheckingAccountProps {
  isV2: boolean;
  walletState: { eth: bigint; usdg: bigint; frozen: boolean } | null | undefined;
  stateLoading: boolean;
  stateError: boolean;
  onRetryState: () => void;
  polydash: { held: bigint; staked: bigint; earned: bigint } | null | undefined;
  /** Daily cap + spent-today in USDG (6 dp), and the key expiry. Both the v1
   * policy and the v2 policy carry these; the base WalletPolicy interface
   * does not include spentTodayUsdg, so this is structural. */
  policy: { dailyCapUsdg: bigint; spentTodayUsdg: bigint; expiry: number } | null | undefined;
  agentKey: string | undefined;
  /** Bank-ledger rows + the POLYDASH cap, both read server-side with the
   * rest of the wallet state (the browser's RPC path fails — see
   * lib/agent-wallet/server.ts). */
  ledger: LedgerRow[] | undefined;
  polyCap: WalletTokenCap | null | undefined;
  score: { registered?: boolean; score?: number | null } | null | undefined;
  frozen: boolean;
  onFreeze: () => void;
  freezeBusy: boolean;
}

/** The wallet's checking account — the money section of the wallet page.
 *
 * One total balance, every holding with a dollar value, and a bank-ledger
 * statement (money in, money out, running balance). Plain words throughout:
 * a 12-year-old should be able to read it. Nothing is invented: a price of 0
 * means "unavailable right now", an empty wallet says so, and the statement's
 * starting balance is computed from the live total so it always ends at the
 * real balance. */
export function CheckingAccount({
  isV2, walletState, stateLoading, stateError, onRetryState,
  polydash, policy, agentKey, ledger, polyCap, score, frozen, onFreeze, freezeBusy,
}: CheckingAccountProps) {
  const { address } = useAccount();
  const { data: prices } = useWalletPrices();
  // The ledger + POLYDASH cap arrive with the server state, so their loading
  // is the state's loading (no separate chain reads from the browser).
  const ledgerLoading = stateLoading && !ledger;

  const ethUsd = prices?.ethUsd ?? 0;
  const polyUsd = prices?.polydashUsd ?? 0;
  const pricesOk = ethUsd > 0 && polyUsd > 0;

  const eth = walletState?.eth ?? 0n;
  const usdgBal = walletState?.usdg ?? 0n;
  const polyHeld = polydash?.held ?? 0n;
  const polyStaked = polydash?.staked ?? 0n;

  const ethUsd6 = pricesOk ? usd6ForAmount(eth, 18, ethUsd) : null;
  const polyUsd6 = pricesOk ? usd6ForAmount(polyHeld, 18, polyUsd) : null;
  const stakedUsd6 = pricesOk ? usd6ForAmount(polyStaked, 18, polyUsd) : null;
  const usdgUsd6 = usdgBal; // USDG is 6 dp and $1 by construction.
  const totalUsd6 = ethUsd6 !== null && polyUsd6 !== null ? ethUsd6 + usdgUsd6 + polyUsd6 : null;

  // Dollar value of one statement row, at today's prices. Null when prices are down.
  const rowUsd6 = (row: LedgerRow): bigint | null => {
    if (!pricesOk) return null;
    if (row.token === 'ETH') return usd6ForAmount(row.amount, 18, ethUsd);
    if (row.token === 'USDG') return row.amount; // 6 dp, $1.
    return usd6ForAmount(row.amount, 18, polyUsd);
  };

  const rows = ledger ?? [];
  const rowValues = rows.map((r) => ({ row: r, usd6: rowUsd6(r), signed: 0n }));
  for (const v of rowValues) {
    v.signed = v.usd6 === null ? 0n : v.row.direction === 'in' ? v.usd6 : -v.usd6;
  }
  const moneyInUsd6 = rowValues.reduce((s, v) => (v.usd6 !== null && v.row.direction === 'in' ? s + v.usd6 : s), 0n);
  const moneyOutUsd6 = rowValues.reduce((s, v) => (v.usd6 !== null && v.row.direction === 'out' ? s + v.usd6 : s), 0n);
  // The statement always ends at the real balance: the starting balance is
  // whatever is left after the listed moves are taken off the live total.
  // When it is more than a cent, it is money that came in without its own
  // line (ETH added for gas leaves no event on-chain) — shown as its own row.
  const openingUsd6 = totalUsd6 !== null ? totalUsd6 - rowValues.reduce((s, v) => s + v.signed, 0n) : null;
  const showOpening = openingUsd6 !== null && (openingUsd6 >= 10_000n || openingUsd6 <= -10_000n);
  // Running balance after each row (rows are newest first): the newest row
  // ends at the live total; each older row unwinds the moves after it.
  const balanceAfter = new Map<string, bigint>();
  if (totalUsd6 !== null) {
    let running = totalUsd6;
    rowValues.forEach((v) => {
      balanceAfter.set(v.row.id, running);
      running -= v.signed;
    });
  }

  const isOwner = !!address;
  const polyCapSet = polyCap?.capped === true && (polyCap?.daily ?? 0n) > 0n;
  const scoreBand = score?.score != null ? bandForScore(score.score) : null;
  const scoreLine = (
    <>
      Credit score:{' '}
      {score?.registered ? (
        score.score != null && scoreBand ? (
          <span>
            {score.score}{' '}
            <span className={cn('ml-1 rounded-full px-2 py-0.5 align-middle text-[10px] font-medium', scoreBand.chip)}>{scoreBand.label}</span>
          </span>
        ) : (
          'Registered · score coming soon'
        )
      ) : (
        'Not registered'
      )}
      {' — '}
      <Link href="/agents/scores" className="text-polydash-green hover:underline">See the scores page</Link>
    </>
  );

  return (
    <AgentCard label="Checking account">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AgentCardTitle>Checking account</AgentCardTitle>
        <div className="flex items-center gap-2">
          {isV2 && <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-medium text-white/70">v2 · daily limit only</span>}
          {frozen ? (
            <span className="rounded-full bg-red-400/10 px-2.5 py-0.5 text-[11px] font-medium text-red-300">Frozen</span>
          ) : (
            <span className="rounded-full bg-polydash-green/15 px-2.5 py-0.5 text-[11px] font-medium text-polydash-green">Active</span>
          )}
        </div>
      </div>
      <AgentCardSub>
        This wallet&rsquo;s bank account, on-chain. Money comes in, your agent spends it inside the limits
        you set, and every move is written down below. The money stays yours.
      </AgentCardSub>

      {!isOwner && (
        <p className="mt-4 rounded-xl bg-white/[0.04] p-3 text-[13px] leading-relaxed text-white/70">
          You&rsquo;re visiting without a wallet connected. The money in this account is public — anyone can
          check it on the chain. Connect your wallet to manage it.
        </p>
      )}

      {stateLoading && !walletState && (
        <p className="mt-6 text-[15px] text-white/60">Loading the account from Robinhood Chain…</p>
      )}
      {stateError && !walletState && (
        <div className="mt-6">
          <p className="text-[15px] leading-relaxed text-white/80">
            Couldn&rsquo;t load the balance from the chain. Check your connection and try again — nothing is
            wrong with the account itself.
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={onRetryState}>Try again</Button>
        </div>
      )}
      {walletState && (
        <>
          {/* Commercial balance card — the Agentcard structure Jon pointed at:
              a white card on the dark page, one huge dollar amount as the hero,
              a plain-language subtitle, clean itemized rows, and two big pill
              buttons. Polypad dark + green, not Agentcard's blue. All data is
              the same live state — only the presentation changed. */}
          <div className="mt-6 rounded-[24px] bg-white p-5 text-neutral-900 shadow-[0_20px_50px_rgba(0,0,0,0.45)] sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Image src="/polydash-logo-200.png" alt="Polypad" width={30} height={30} className="h-[30px] w-[30px]" />
                <span className="text-[19px] font-bold tracking-tight">Polypad</span>
              </div>
              {frozen ? (
                <span className="rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-semibold text-red-700">Frozen</span>
              ) : (
                <span className="rounded-full bg-[#00E676]/15 px-2.5 py-1 text-[11px] font-semibold text-[#00A152]">Active</span>
              )}
            </div>

            <p className="mt-6 text-center text-[56px] font-extrabold leading-none tracking-tight sm:text-[80px]">
              {totalUsd6 !== null ? formatUsd6(totalUsd6) : '—'}
            </p>
            <p className="mt-3 text-center text-[15px] leading-relaxed text-neutral-500">
              {totalUsd6 === 0n
                ? 'Nothing in here yet — add money to get your agent started.'
                : 'for your agent to spend — inside the limits you set.'}
            </p>
            {!pricesOk && (
              <p className="mt-3 rounded-xl bg-amber-50 p-3 text-center text-[13px] leading-relaxed text-amber-800">
                A price is unavailable right now, so the dollar total can&rsquo;t be added up. The amounts
                below are exact — only the dollar math is waiting.
              </p>
            )}

            <div className="mt-6 space-y-2">
              {([
                { key: 'ETH', icon: 'ETH' as const, name: 'ETH', note: 'The money Robinhood Chain runs on — also pays the network fee', amount: `${formatEthShort(eth)} ETH`, usd6: ethUsd6 },
                { key: 'USDG', icon: 'USDG' as const, name: 'USDG', note: 'A digital dollar — 1 USDG is $1', amount: `${usdg(usdgBal)} USDG`, usd6: usdgUsd6 },
                { key: 'POLYDASH', icon: 'POLYDASH' as const, name: 'POLYDASH', note: 'Polypad\u2019s own token', amount: `${fmtToken(polyHeld, 18)} POLYDASH`, usd6: polyUsd6 },
              ] as { key: string; icon: 'ETH' | 'USDG' | 'POLYDASH'; name: string; note: string; amount: string; usd6: bigint | null }[]).map((h) => (
                <div key={h.key} className="flex items-center justify-between gap-3 rounded-2xl bg-neutral-100 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <TokenIcon token={h.icon} />
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold leading-tight">{h.name}</p>
                      <p className="mt-0.5 text-[12.5px] leading-snug text-neutral-500">{h.note}</p>
                    </div>
                  </div>
                  <div className="flex-none text-right">
                    <p className="text-[15px] font-bold leading-tight">{h.usd6 === null ? 'Price unavailable' : formatUsd6(h.usd6)}</p>
                    <p className="mt-0.5 font-mono text-[12.5px] text-neutral-500">{h.amount}</p>
                  </div>
                </div>
              ))}
              {polyStaked > 0n && (
                <div className="flex items-center justify-between gap-3 rounded-2xl bg-neutral-100 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <TokenIcon token="STAKED" />
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold leading-tight">POLYDASH staked</p>
                      <p className="mt-0.5 text-[12.5px] leading-snug text-neutral-500">Locked in the staking pool, earning rewards — not spendable until you unstake it</p>
                    </div>
                  </div>
                  <div className="flex-none text-right">
                    <p className="text-[15px] font-bold leading-tight">{stakedUsd6 === null ? 'Price unavailable' : formatUsd6(stakedUsd6)}</p>
                    <p className="mt-0.5 font-mono text-[12.5px] text-neutral-500">{fmtToken(polyStaked, 18)} POLYDASH</p>
                  </div>
                </div>
              )}
            </div>

            {policy && (
              <div className="mt-2 flex items-center justify-between gap-3 rounded-2xl bg-neutral-100 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-neutral-900 text-[17px] font-extrabold text-white" aria-hidden>🛡</span>
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold leading-tight">Daily limit</p>
                    <p className="mt-0.5 text-[12.5px] leading-snug text-neutral-500">The most your agent can spend in one day</p>
                  </div>
                </div>
                <div className="flex-none text-right">
                  <p className="text-[15px] font-bold leading-tight">${usdg(policy.dailyCapUsdg)} a day</p>
                  <p className="mt-0.5 text-[12.5px] text-neutral-500">Spent ${usdg(policy.spentTodayUsdg)} today</p>
                </div>
              </div>
            )}

            <p className="mt-4 text-center text-[14px] leading-relaxed text-neutral-600">
              <span className="font-bold text-[#00A152]">★</span>{' '}
              Only you can change the limit — your agent can&rsquo;t raise it.
            </p>

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => scrollToId('wallet-ledger')}
                className="flex-1 rounded-full bg-neutral-200 px-4 py-3.5 text-[15px] font-semibold text-neutral-800 transition hover:bg-neutral-300"
              >
                See activity
              </button>
              <button
                type="button"
                onClick={() => scrollToId('wallet-gas')}
                className="flex-1 rounded-full bg-[#00E676] px-4 py-3.5 text-[15px] font-bold text-black transition hover:bg-[#33EB91]"
              >
                Add money
              </button>
            </div>
          </div>
          {polyStaked > 0n && (
            <p className="mt-3 text-[12.5px] leading-relaxed text-white/45">
              Staked POLYDASH isn&rsquo;t part of the balance above — it&rsquo;s locked in the pool until you unstake it.
            </p>
          )}
          <p className="mt-4 text-[14px] leading-relaxed text-white/70">{scoreLine}</p>
        </>
      )}

      <h3 id="wallet-ledger" className="mt-8 scroll-mt-24 text-[15px] font-semibold">Money in and out</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-white/55">
        Newest first. Every move links to the public record on the chain.
      </p>
      {ledgerLoading && (
        <p className="mt-3 text-[13px] text-white/50">Reading the account&rsquo;s history from Robinhood Chain…</p>
      )}
      {!ledgerLoading && rows.length === 0 && !showOpening && (
        <p className="mt-3 text-[14px] leading-relaxed text-white/60">
          No activity yet. When money moves in or out of this account, it shows up here.
        </p>
      )}
      {(!ledgerLoading && (rows.length > 0 || showOpening)) && (
        <>
          {pricesOk ? (
            <p className="mt-3 text-[14px] leading-relaxed text-white/70">
              Money in: <span className="font-semibold text-polydash-green">{formatUsd6(moneyInUsd6)}</span>
              {' · '}Money out: <span className="font-semibold text-red-300">{formatUsd6(moneyOutUsd6)}</span>
            </p>
          ) : (
            <p className="mt-3 text-[13px] leading-relaxed text-amber-200/90">
              Prices are unavailable right now, so dollar values are hidden — the amounts below are exact.
            </p>
          )}
          <div className="mt-3 divide-y divide-white/5 rounded-[14px] border border-white/5 bg-[#1a1a1a]">
            {rowValues.map(({ row, usd6 }) => {
              const after = balanceAfter.get(row.id);
              return (
                <div key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[14px] leading-snug text-white/90">
                      <span className={cn('mr-2 inline-block w-[74px] font-semibold', row.direction === 'in' ? 'text-polydash-green' : 'text-red-300')}>
                        {row.direction === 'in' ? 'Money in' : 'Money out'}
                      </span>
                      {row.label}
                      <span className="ml-2 text-[12px] text-white/45">{dateLabel(row)}</span>
                    </p>
                    <p className="mt-0.5 pl-[82px] text-[12px]">
                      <a className="font-mono text-polydash-green hover:underline" href={explorerTx(row.txHash)} target="_blank" rel="noopener noreferrer">
                        {shortenAddress(row.txHash)} ↗
                      </a>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={cn('font-mono text-[15px] font-semibold', row.direction === 'in' ? 'text-polydash-green' : 'text-red-300')}>
                      {row.direction === 'in' ? '+' : '−'}{usd6 === null ? `${fmtToken(row.amount, row.decimals)} ${row.token}` : formatUsd6(usd6)}
                    </p>
                    {after !== undefined && (
                      <p className="mt-0.5 text-[12px] text-white/50">Balance {formatUsd6(after)}</p>
                    )}
                  </div>
                </div>
              );
            })}
            {showOpening && openingUsd6 !== null && (
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
                <div>
                  <p className="text-[14px] leading-snug text-white/90">Starting balance</p>
                  <p className="mt-0.5 max-w-md text-[12px] leading-relaxed text-white/50">
                    Money already in the account before the moves above. ETH added for gas doesn&rsquo;t leave
                    its own line on the chain, so it&rsquo;s counted here.
                  </p>
                </div>
                <p className="font-mono text-[15px] font-semibold">{formatUsd6(openingUsd6)}</p>
              </div>
            )}
          </div>
        </>
      )}

      <h3 className="mt-8 text-[15px] font-semibold">Spending limits for this wallet</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-white/55">
        What your agent is allowed to spend — and the one rule that keeps it safe. The agent key can never
        raise these itself. Change them in the Limits section below.
      </p>
      {policy ? (
        <div className="mt-3 space-y-2">
          <div className="rounded-[14px] border border-white/5 bg-[#1a1a1a] px-4 py-3">
            <p className="text-[14px]"><span className="font-semibold">USDG — up to ${usdg(policy.dailyCapUsdg)} a day.</span>{' '}
              <span className="text-white/60">
                {isV2 ? 'The daily limit is the only bound — no per-payment or weekly cap in this version.' : ''}
              </span>
            </p>
          </div>
          <div className="rounded-[14px] border border-white/5 bg-[#1a1a1a] px-4 py-3">
            {polyCap ? (
              polyCapSet ? (
                <p className="text-[14px]"><span className="font-semibold">POLYDASH — up to ${usdg(polyCap.daily)} a day.</span></p>
              ) : (
                <p className="text-[14px] leading-relaxed">
                  <span className="font-semibold text-amber-200">POLYDASH — no daily cap set.</span>{' '}
                  <span className="text-white/70">
                    That means no limit is watching POLYDASH. Never give an app permission to pull POLYDASH out
                    of this account until a cap is set — a pull isn&rsquo;t counted against any limit.
                    {polyCap.registryAllowance !== undefined && (
                      <> Allowance given to the Agent Registry right now: {fmtToken(polyCap.registryAllowance, 18)} POLYDASH{polyCap.registryAllowance === 0n ? ' — none, which is the safe state.' : '.'}</>
                    )}
                  </span>
                </p>
              )
            ) : (
              <p className="text-[14px] text-white/60">Reading the POLYDASH cap from the chain…</p>
            )}
          </div>
          <p className="text-[13px] leading-relaxed text-white/55">
            Agent key: <span className="font-mono">{agentKey ? shortenAddress(agentKey) : '…'}</span>
            {policy && <> · key expires {new Date(policy.expiry * 1000).toLocaleDateString()}</>}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-[14px] leading-relaxed text-white/60">
          No spending limits found on-chain for this wallet yet — the agent key has no policy, so it can&rsquo;t spend.
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <Button variant={frozen ? 'outline' : 'destructive'} onClick={onFreeze} disabled={freezeBusy}>
          {freezeBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {frozen ? 'Unfreeze wallet' : 'Stop — freeze wallet + revoke vault key'}
        </Button>
      </div>

      <p className="mt-6 border-t border-white/5 pt-4 text-[12.5px] leading-relaxed text-white/45">
        Words on this page — Balance: money in the account right now. Daily cap: the most your agent can spend
        in one day. Holding: each kind of money in the account. Allowance: permission you give an app to take
        money out of the account.
      </p>
    </AgentCard>
  );
}
