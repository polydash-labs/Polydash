'use client';

import { formatEther } from 'viem';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fmtPT, fmtToken } from '@/lib/buyback';
import { AddrLink, Card, TxLink } from '@/components/buyback/ui';

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

function downloadCsv(rows: any[]) {
  const head = ['time_pt', 'eth_in', 'polydash_burned', 'polydash_to_stakers', 'caller', 'tx'];
  const body = rows.map((r) => [fmtPT(r.time), formatEther(BigInt(r.ethIn ?? '0')), formatEther(BigInt(r.polyBurned ?? '0')), formatEther(BigInt(r.polyToStakers ?? '0')), r.caller ?? '', r.txHash].map(csvCell).join(','));
  const blob = new Blob([[head.join(','), ...body].join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'polydash-buybacks.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function BuyTable({ items, hasMore, onMore, loadingMore }: { items: any[]; hasMore: boolean; onMore: () => void; loadingMore: boolean }) {
  const buys = items.filter((i) => i.type === 'BoughtAndBurned');
  return (
    <Card
      title="Buybacks"
      action={<Button variant="outline" size="sm" className="rounded-full" disabled={!buys.length} onClick={() => downloadCsv(buys)}><Download className="mr-1.5 h-3.5 w-3.5" /> CSV</Button>}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-[12px]">
          <thead className="text-white/55">
            <tr>
              <th className="py-2 font-normal">Time (PT)</th>
              <th className="py-2 font-normal">ETH in</th>
              <th className="py-2 font-normal">Burned</th>
              <th className="py-2 font-normal">To stakers</th>
              <th className="py-2 font-normal">Caller</th>
              <th className="py-2 font-normal">Tx</th>
            </tr>
          </thead>
          <tbody className="font-mono text-white">
            {buys.length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center font-sans text-white/55">No buybacks yet.</td></tr>
            )}
            {buys.map((b) => (
              <tr key={`${b.txHash}-${b.logIndex}`} className="border-t border-white/5">
                <td className="py-2 font-sans">{fmtPT(b.time)}</td>
                <td className="py-2">{fmtToken(b.ethIn, 5)}</td>
                <td className="py-2">{fmtToken(b.polyBurned)}</td>
                <td className="py-2">{fmtToken(b.polyToStakers)}</td>
                <td className="py-2"><AddrLink address={b.caller} /></td>
                <td className="py-2"><TxLink hash={b.txHash} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <div className="mt-3 text-center">
          <Button variant="outline" size="sm" className="rounded-full" disabled={loadingMore} onClick={onMore}>{loadingMore ? 'Loading…' : 'Load more'}</Button>
        </div>
      )}
    </Card>
  );
}

export function EventList({ title, items, empty, render }: { title: string; items: any[]; empty: string; render: (i: any) => React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[12px] font-medium text-white/80">{title}</p>
      {items.length === 0 ? (
        <p className="text-[12px] text-white/55">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((i) => (
            <li key={`${i.txHash}-${i.logIndex}`} className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
              <span className="text-white/70">{fmtPT(i.time)} · {render(i)}</span>
              <TxLink hash={i.txHash} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
