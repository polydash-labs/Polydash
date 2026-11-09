import { formatEther, formatUnits } from 'viem';
import { getExplorerAddressUrl } from '@/lib/contracts/addresses';
import { formatFundEth, ratioPercent, type FundStatus } from '@/lib/fund/model';
import { fundProtections, quotePerToken, tapePoints, type FundInvestView } from '@/lib/fund/invest';
import { shortenAddress } from '@/lib/format';

export function FundTerminal({
  status,
  navPerNft,
  totalMinted,
  vaultEth,
  publicOpen,
  invest,
}: {
  status: FundStatus;
  navPerNft: bigint;
  totalMinted: bigint;
  vaultEth: bigint;
  publicOpen: boolean;
  invest: FundInvestView | null;
}) {
  const scored = fundProtections({ bits: invest?.protectionBits ?? null, skinMet: publicOpen });
  const nav = invest?.nav ?? vaultEth;
  const perNft = invest?.navPerNft ?? navPerNft;
  const now = Math.floor(Date.now() / 1000);
  const points = tapePoints(
    (invest?.trades ?? []).map((trade) => ({ t: trade.timestamp, nav: trade.navAfter })),
    { t: now, nav: perNft },
  );
  const holdings = invest?.holdings ?? [{
    asset: '0x0000000000000000000000000000000000000000' as const,
    symbol: 'ETH',
    decimals: 18,
    balance: vaultEth,
    cost: 0n,
    kind: 'eth' as const,
  }];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-[15px] font-semibold">Fund terminal</h2>
        <p className="text-[12px] text-white/45">{scored.met} of {scored.total} protections</p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
          <p className="text-[12px] text-white/45">NAV per NFT</p>
          <p className="mt-1 font-mono text-[22px] text-white">
            {invest && !invest.navKnown ? 'Unavailable' : totalMinted === 0n ? '—' : `${formatFundEth(perNft)} ETH`}
          </p>
          {invest && !invest.navKnown && (
            <p className="mt-2 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-2 text-[12px] leading-relaxed text-yellow-200">
              NAV is unavailable right now — a price feed cannot be used, so this figure is blank rather than wrong. Holdings below are shown at cost, not at market value. Exits and refunds still pay your share of the vault.
            </p>
          )}
          <p className="mt-2 text-[12px] leading-relaxed text-white/50">
            {invest
              ? 'ETH and WETH at face value, plus other holdings at the feed, minus unclaimed fees. A missing or unusable feed leaves this blank. Cost basis is not this figure.'
              : 'Vault ETH divided by NFTs minted. Phase 1 does not price other assets.'}
          </p>
          {invest && invest.lastNavCheckpoint > 0 && (
            <p className="mt-2 text-[12px] text-white/45">
              Last NAV checkpoint {new Date(invest.lastNavCheckpoint * 1000).toLocaleString()} — {formatFundEth(invest.lastCheckpointNavPerNft)} ETH per NFT. Checkpoints run at most once an hour.
            </p>
          )}
          <NavTape points={points} />
          {status === 'investing' && invest && invest.trades.length > 0 && (
            <p className="mt-2 text-[11px] text-white/35">The line uses the latest swaps kept on the vault, then the current figure.</p>
          )}
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
          <p className="text-[12px] text-white/45">Fund protections</p>
          <ul className="mt-3 space-y-2">
            {scored.rows.map((row) => (
              <li key={row.id} className="flex items-start justify-between gap-3 text-[12px]">
                <div>
                  <p className="text-white/80">{row.label}</p>
                  <p className="mt-0.5 leading-relaxed text-white/45">{row.detail}</p>
                </div>
                <span className={row.met ? 'shrink-0 text-polydash-green' : 'shrink-0 text-white/35'}>
                  {row.met ? 'In place' : 'Not in this version'}
                </span>
              </li>
            ))}
          </ul>
          {invest && (
            <p className="mt-3 break-all font-mono text-[11px] text-white/40" title={invest.mandateHash}>
              Mandate {shortenAddress(invest.mandateHash)}
            </p>
          )}
          {invest && invest.mandateUri && (
            <p className="mt-1 break-all text-[11px] text-white/40">
              Mandate text:{' '}
              <a className="text-polydash-green" href={invest.mandateUri} target="_blank" rel="noopener noreferrer">
                {invest.mandateUri}
              </a>
            </p>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <h3 className="text-[13px] font-semibold">Holdings</h3>
        <ul className="mt-3 divide-y divide-white/5">
          {holdings.map((row) => {
            const weight = row.kind === 'asset' || !invest?.navKnown ? null : ratioPercent(row.balance, nav);
            return (
              <li key={`${row.kind}-${row.asset}`} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                <div>
                  <p className="text-white">{row.symbol}</p>
                  <p className="text-[11px] text-white/40">
                    {row.kind === 'asset' ? `Cost basis ${formatFundEth(row.cost)} ETH. Not a NAV weight.` : row.kind === 'eth' && invest && invest.claimableFees > 0n ? `Includes ${formatFundEth(invest.claimableFees)} ETH of unclaimed fees` : 'Quote balance'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-white/80">{formatToken(row.balance, row.decimals)}</p>
                  <p className="text-[11px] text-white/35">{weight === null || nav === 0n ? '—' : `${weight.toFixed(weight >= 10 ? 1 : 2)}% of NAV`}</p>
                </div>
              </li>
            );
          })}
        </ul>
        {invest && (
          <p className="mt-2 text-[12px] text-white/45">
            Swaps can use {formatFundEth(invest.spendableEth)} ETH. Unclaimed fees stay in the vault.
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <h3 className="text-[13px] font-semibold">Blotter</h3>
        {!invest || invest.trades.length === 0 ? (
          <p className="mt-2 text-[13px] text-white/50">No swaps yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[12px]">
              <thead className="text-white/40">
                <tr>
                  <th className="pb-2 font-medium">Time</th>
                  <th className="pb-2 font-medium">Side</th>
                  <th className="pb-2 font-medium">Asset</th>
                  <th className="pb-2 font-medium">Size</th>
                  <th className="pb-2 font-medium">Price</th>
                  <th className="pb-2 font-medium">NAV / NFT</th>
                </tr>
              </thead>
              <tbody>
                {invest.trades.map((trade, index) => {
                  const holding = invest.holdings.find((row) => row.asset.toLowerCase() === trade.asset.toLowerCase());
                  const decimals = holding?.decimals ?? 18;
                  const symbol = holding?.symbol ?? shortenAddress(trade.asset);
                  const side = trade.asset.toLowerCase() === invest.weth.toLowerCase()
                    ? (trade.side === 0 ? 'Wrap' : 'Unwrap')
                    : (trade.side === 0 ? 'Buy' : 'Sell');
                  return (
                    <tr key={`${trade.timestamp}-${index}`} className="border-t border-white/5 text-white/75">
                      <td className="py-2 pr-3 font-mono">{trade.timestamp ? new Date(trade.timestamp * 1000).toLocaleString() : '—'}</td>
                      <td className="py-2 pr-3">{side}</td>
                      <td className="py-2 pr-3">
                        {trade.asset === '0x0000000000000000000000000000000000000000' ? symbol : (
                          <a className="text-polydash-green" href={getExplorerAddressUrl(trade.asset)} target="_blank" rel="noopener noreferrer">{symbol}</a>
                        )}
                      </td>
                      <td className="py-2 pr-3 font-mono">{formatToken(trade.size, decimals)}</td>
                      <td className="py-2 pr-3 font-mono">{formatFundEth(quotePerToken(trade.price, decimals))} ETH</td>
                      <td className="py-2 font-mono">{formatFundEth(trade.navAfter)} ETH</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function formatToken(amount: bigint, decimals: number): string {
  if (amount === 0n) return '0';
  const [whole, frac = ''] = formatUnits(amount, decimals).split('.');
  const trimmed = frac.replace(/0+$/, '').slice(0, 6);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

function NavTape({ points }: { points: { t: number; nav: bigint }[] }) {
  const values = points.map((point) => Number(formatEther(point.nav)));
  const width = 320;
  const height = 72;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || Math.max(max, 1) * 0.08 || 1;
  const coords = values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - ((value - min) / span) * (height - 8) - 4;
    return `${x},${y}`;
  });
  const line = values.length === 1 ? `0,${coords[0]?.split(',')[1] ?? height / 2} ${width},${coords[0]?.split(',')[1] ?? height / 2}` : coords.join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-3 h-16 w-full" role="img" aria-label="NAV per NFT">
      <polyline fill="none" stroke="#00E676" strokeWidth="2" points={line} />
    </svg>
  );
}
