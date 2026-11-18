'use client';

import { useEffect, useState } from 'react';
import { formatEther } from 'viem';
import { shortenAddress } from '@/lib/format';
import { cn } from '@/lib/utils';
import { FeeRouting, type FeeRoutingProps } from '@/components/fee-routing';

type Data = Partial<Pick<FeeRoutingProps, 'vault' | 'pendingPayoutWallet' | 'feeRouting'>> & {
  creator: string;
  payoutWallet: string;
  earnedWei: string;
  claimedWei: string;
  claimableWei: string;
  ethUsd: number | null;
};

const card = 'rounded-2xl border border-white/10 bg-white/[0.03]';
const EXPLORER = 'https://robinhoodchain.blockscout.com/address/';
const FOOTNOTE =
  "Creator fees are paid in ETH from each trade and held in the contract until claimed to the creator's payout wallet. Figures read from Robinhood Chain, updated every 5 minutes. Not financial advice.";

function eth(wei: string) {
  return `${Number(formatEther(BigInt(wei))).toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 })} ETH`;
}

function usd(wei: string, price: number | null) {
  if (!price) return null;
  const v = Number(formatEther(BigInt(wei))) * price;
  return `≈ $${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function AddressLink({ address }: { address: string }) {
  return (
    <a href={`${EXPLORER}${address}`} target="_blank" rel="noopener noreferrer" className="font-mono text-polydash-green hover:underline">
      {shortenAddress(address)}
    </a>
  );
}

export function CreatorFeesCard({ token, symbol }: { token: string; symbol: string }) {
  const [state, setState] = useState<'loading' | 'ok' | 'hidden' | 'error'>('loading');
  const [data, setData] = useState<Data | null>(null);
  const [bump, setBump] = useState(0);

  useEffect(() => {
    let alive = true;
    let first = bump > 0;
    const load = async () => {
      try {
        const res = await fetch(`/api/creator-fees/${token}${first ? '?fresh=1' : ''}`);
        first = false;
        if (!alive) return;
        if (res.status === 404 || res.status === 400) return setState('hidden');
        if (!res.ok) throw new Error(`creator-fees ${res.status}`);
        const json = (await res.json()) as Data;
        if (!alive) return;
        setData(json);
        setState('ok');
      } catch (e) {
        console.error('Creator fees card error', e);
        if (alive) setState((s) => (s === 'ok' ? s : 'error'));
      }
    };
    load();
    const id = setInterval(load, 5 * 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [token, bump]);

  if (state === 'hidden') return null;

  const rows: [string, React.ReactNode][] = [];
  if (state === 'ok' && data) {
    const earnedUsd = usd(data.earnedWei, data.ethUsd);
    rows.push(['Total earned', (
      <span className="text-right">
        <span className="font-mono">{eth(data.earnedWei)}</span>
        {earnedUsd && <span className="ml-1.5 text-white/45">{earnedUsd}</span>}
      </span>
    )]);
    rows.push(['Claimed', <span className="font-mono">{eth(data.claimedWei)}</span>]);
    if (BigInt(data.claimableWei) > BigInt(0)) rows.push(['Claimable', <span className="font-mono">{eth(data.claimableWei)}</span>]);
    const differs = data.payoutWallet.toLowerCase() !== data.creator.toLowerCase();
    rows.push(['Creator', <AddressLink address={differs ? data.creator : data.payoutWallet} />]);
    if (differs) rows.push(['Payout wallet', <AddressLink address={data.payoutWallet} />]);
  }

  return (
    <div className={cn(card, 'p-4 sm:p-5')}>
      <h3 className="text-[15px] font-semibold">Creator fees</h3>
      {state === 'loading' && (
        <div className="mt-3 space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between py-1">
              <div className="h-3 w-20 animate-pulse rounded bg-white/10" />
              <div className="h-3 w-28 animate-pulse rounded bg-white/10" />
            </div>
          ))}
        </div>
      )}
      {state === 'error' && <p className="mt-2 text-[13px] text-white/45">Unavailable right now</p>}
      {state === 'ok' && (
        <dl className="mt-3 divide-y divide-white/5 text-[13px]">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3 py-2">
              <dt className="shrink-0 text-white/45">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {state === 'ok' && data?.feeRouting && (
        <FeeRouting
          className="border-t border-white/5"
          symbol={symbol}
          vault={data.vault ?? null}
          pendingPayoutWallet={data.pendingPayoutWallet ?? null}
          feeRouting={data.feeRouting}
          onChanged={() => setBump((b) => b + 1)}
        />
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-white/40">{FOOTNOTE}</p>
    </div>
  );
}
