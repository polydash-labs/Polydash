'use client';

import { useBuybackTasks, useBuybackTx } from '@/lib/hooks/use-buyback';
import { useNow, formatCountdown } from '@/lib/hooks/use-nft-collections';
import { LIMITS, RUN_EXPLAIN, fmtPT, fmtToken, short, vaultAddress, type Addr } from '@/lib/buyback';
import { Card, ConnectOr, Note, Row, TxButton, TxLink } from '@/components/buyback/ui';

const MIN = 60;

/** Two-step public buyback: record price, then buy 5-60 min later (and 10 min after the last buy). */
export function RunBuyback({ s }: { s: any }) {
  const tx = useBuybackTx();
  const now = useNow();
  const vault = vaultAddress();
  if (!s?.live || !vault || BigInt(s.pendingEth ?? '0') === BigInt(0)) return null;
  const obs = Number(s.obsTime ?? 0);
  const last = Number(s.lastBuyTime ?? 0);
  const buyFrom = Math.max(obs + LIMITS.observeDelayMinutes * MIN, last + LIMITS.cooldownMinutes * MIN);
  const buyUntil = obs + LIMITS.observeMaxAgeMinutes * MIN;
  const fresh = obs > 0 && now != null && now <= buyUntil;
  const canBuy = fresh && now != null && now >= buyFrom;
  return (
    <Card title="Run buyback">
      <Row label="ETH waiting in the vault">{fmtToken(s.pendingEth)} ETH</Row>
      <Row label="Recorded price">{obs ? fmtPT(obs) : 'None'}</Row>
      {fresh && now != null && now < buyFrom && <Row label="Buy opens in">{formatCountdown(buyFrom - now)}</Row>}
      {fresh && now != null && <Row label="Recorded price expires in">{formatCountdown(buyUntil - now)}</Row>}
      <div className="mt-3 flex flex-wrap gap-2">
        <ConnectOr>
          <TxButton variant="outline" busy={tx.pending === 'observe'} onClick={() => tx.send({ key: 'observe', address: vault, abi: 'vault', functionName: 'observePrice', success: 'Price recorded' })}>
            Step 1: Record price
          </TxButton>
          <TxButton disabled={!canBuy} busy={tx.pending === 'buy'} onClick={() => tx.send({ key: 'buy', address: vault, abi: 'vault', functionName: 'buy', success: 'Buyback done' })}>
            Step 2: Buy
          </TxButton>
        </ConnectOr>
      </div>
      {tx.lastHash && <p className="mt-2 text-[12px] text-white/55">Tx: <TxLink hash={tx.lastHash.hash} /></p>}
      <div className="mt-3"><Note tone="muted">{RUN_EXPLAIN}</Note></div>
    </Card>
  );
}

/** Public fee collection: collectPlatformFeesMany on each factory for launches with accrued platform fees. */
export function CollectFees({ live }: { live: boolean }) {
  const { data, isLoading } = useBuybackTasks(live);
  const tx = useBuybackTx();
  const tasks: any[] = (data?.tasks ?? []).filter((t: any) => t.type === 'collect_platform_fees');
  return (
    <Card title="Collect fees">
      <p className="text-[12px] text-white/55">Anyone can collect accrued platform fees. 40% goes to the buyback vault in the same transaction. The caller pays gas.</p>
      <div className="mt-3 space-y-2">
        {!live && <p className="text-[12px] text-white/55">Available when the buyback vault goes live.</p>}
        {live && isLoading && <p className="text-[12px] text-white/55">Checking launches…</p>}
        {live && !isLoading && tasks.length === 0 && <p className="text-[12px] text-white/55">No platform fees waiting to be collected.</p>}
        {tasks.map((t) => {
          const launches = (t.args?.[0] ?? []) as Addr[];
          const key = `collect-${t.contract}`;
          return (
            <div key={t.contract} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/[0.04] p-3 text-[12px]">
              <span className="text-white/70">Factory {short(t.contract)}: {launches.length} launches, {fmtToken(t.accruedWei)} ETH</span>
              <ConnectOr>
                <TxButton busy={tx.pending === key} onClick={() => tx.send({ key, address: t.contract, abi: 'factory', functionName: 'collectPlatformFeesMany', args: [launches], success: 'Fees collected' })}>
                  Collect fees
                </TxButton>
              </ConnectOr>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
