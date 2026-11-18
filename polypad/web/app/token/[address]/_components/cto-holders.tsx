'use client';

import type { CtoReport } from '@/lib/cto/chain';
import { AddrLink, Panel, Pill, TxLink, fmtDate, num } from '@/app/agents/_components/ui';
import { cn } from '@/lib/utils';

/** ≥40px tap height on touch screens without changing the desktop table density. */
const TAP = 'min-h-10 sm:min-h-0';

const Tags = ({ tags }: { tags: string[] }) => <>{tags.map((t) => <Pill key={t}>{t}</Pill>)}</>;
const th = 'py-1.5 font-medium';

export function CtoHolders({ r }: { r: CtoReport }) {
  const h = r.holders;
  const sym = r.cto.symbol;
  const flows = h.flows24h;
  return (
    <Panel title="Holders" note="From on-chain transfers since launch" className="lg:col-span-2">
      <div className="mb-4 grid grid-cols-3 gap-2 text-center">
        {[['Holders', h.count.toLocaleString('en-US')], ['Top-10 share', `${h.top10Pct.toFixed(2)}%`], ['Transfers, 24h', h.transfers24h.toLocaleString('en-US')]].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-white/[0.04] p-2.5"><div className="text-[11px] text-white/45">{k}</div><div className="font-mono text-[14px] font-semibold">{v}</div></div>
        ))}
      </div>
      <p className="mb-2 text-[11px] text-white/40">Top-10 share excludes the launch contract, pool and dead addresses.</p>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="min-w-0">
          <h4 className="mb-1 text-[13px] font-medium text-white/70">Top 10</h4>
          {h.top.length === 0 ? <p className="text-[13px] text-white/50">No holders yet.</p> : (
            <table className="w-full text-left text-[13px]">
              <thead className="text-[11px] uppercase tracking-wide text-white/40"><tr><th className={th}>#</th><th className={th}>Wallet</th><th className={cn(th, 'text-right')}>Balance</th><th className={cn(th, 'text-right')}>%</th></tr></thead>
              <tbody>
                {h.top.map((x, i) => (
                  <tr key={x.address} className="border-t border-white/[0.06]">
                    <td className="py-1.5 text-white/40">{i + 1}</td>
                    <td className="py-1.5"><div className="flex flex-wrap items-center gap-1 text-white/70"><AddrLink address={x.address} className={TAP} /><Tags tags={x.tags} /></div></td>
                    <td className="py-1.5 text-right font-mono">{num(x.balance)}</td>
                    <td className="py-1.5 text-right font-mono">{x.pct.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="min-w-0">
          <h4 className="mb-1 text-[13px] font-medium text-white/70">Early buyers <span className="font-normal text-white/40">(first 50 blocks after launch)</span></h4>
          {h.earlyBuyers.length === 0 ? <p className="text-[13px] text-white/50">{h.launchBlock == null ? 'Trading has not started yet.' : 'No buys in the first 50 blocks.'}</p> : (
            <table className="w-full text-left text-[13px]">
              <thead className="text-[11px] uppercase tracking-wide text-white/40"><tr><th className={th}>Wallet</th><th className={cn(th, 'text-right')}>Bought</th><th className={cn(th, 'text-right')}>Holds now</th></tr></thead>
              <tbody>
                {h.earlyBuyers.slice(0, 15).map((b) => (
                  <tr key={b.address} className="border-t border-white/[0.06]">
                    <td className="py-1.5 text-white/70"><AddrLink address={b.address} className={TAP} /></td>
                    <td className="py-1.5 text-right font-mono">{num(b.boughtTokens)}</td>
                    <td className="py-1.5 text-right font-mono">{b.holdingPct.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="min-w-0">
          <h4 className="mb-1 text-[13px] font-medium text-white/70">Net flows, last 24h</h4>
          {flows.length === 0 ? <p className="text-[13px] text-white/50">No transfers in the last 24h.</p> : (
            <table className="w-full text-left text-[13px]">
              <thead className="text-[11px] uppercase tracking-wide text-white/40"><tr><th className={th}>Wallet</th><th className={cn(th, 'text-right')}>Net {sym}</th></tr></thead>
              <tbody>
                {flows.slice(0, 10).map((f) => (
                  <tr key={f.address} className="border-t border-white/[0.06]">
                    <td className="py-1.5"><div className="flex flex-wrap items-center gap-1 text-white/70"><AddrLink address={f.address} className={TAP} /><Tags tags={f.tags} /></div></td>
                    <td className={cn('py-1.5 text-right font-mono', f.net > 0 ? 'text-polydash-green' : 'text-[#FF8A80]')}>{f.net > 0 ? '+' : '-'}{num(Math.abs(f.net))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="min-w-0">
          <h4 className="mb-1 text-[13px] font-medium text-white/70">Whale moves <span className="font-normal text-white/40">(over 1% of supply)</span></h4>
          {h.whales.length === 0 ? <p className="text-[13px] text-white/50">No transfers over 1% of supply in the last 24h.</p> : (
            <ul className="space-y-2">
              {h.whales.slice(0, 10).map((w) => (
                <li key={`${w.txHash}-${w.from}-${w.to}`} className="rounded-xl bg-white/[0.03] p-2.5 text-[12px]">
                  <div className="flex flex-wrap items-center gap-1 text-white/70">
                    <AddrLink address={w.from} className={TAP} /><Tags tags={w.fromTags} /><span className="text-white/40">to</span><AddrLink address={w.to} className={TAP} /><Tags tags={w.toTags} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono">{num(w.amount)} {sym} ({w.pct.toFixed(2)}%)</span>
                    <span className="text-white/40">{fmtDate(w.time)} · <TxLink hash={w.txHash} /></span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}
