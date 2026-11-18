'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useBuybackChart, useBuybackHistory, useBuybackSummary, useBuybackTx, usePoolSummary } from '@/lib/hooks/use-buyback';
import { useNow, formatCountdown } from '@/lib/hooks/use-nft-collections';
import {
  CONFIG_NOTE, HOW_IT_WORKS, LAUNCH_FACTORIES, LIMITS, NOT_AUDITED, NOT_LIVE_VAULT, REWARDS_POOL_ADDRESS, SOURCE_LABELS, SPLIT_PHRASE, STEP_LABELS,
  WHAT_IT_DOES, fmtPT, fmtToken, isZeroAddr, sameAddress, vaultAddress,
} from '@/lib/buyback';
import { AddrLink, Card, ConnectOr, ContractLinks, Note, Row, Stat, TxButton, TxLink } from '@/components/buyback/ui';
import { BuyTable, EventList } from './buyback-table';
import { CollectFees, RunBuyback } from './buyback-actions';
import type { ChartPoint } from './buyback-chart-inner';

const BuybackChart = dynamic(() => import('./buyback-chart-inner'), { ssr: false, loading: () => <div className="h-[280px] w-full animate-pulse rounded-xl bg-white/[0.03]" /> });

const fmtEth = (wei?: string | null) => `${fmtToken(wei ?? '0', 5)} ETH`;
const fmtPoly = (wei?: string | null) => `${fmtToken(wei ?? '0')}`;
const ethStr = (s?: string | null) => (s ? Number(s).toLocaleString('en-US', { maximumFractionDigits: 5 }) : '0');
const factoryName = (a?: string) => (sameAddress(a, LAUNCH_FACTORIES[0]) ? 'Launch factory A' : sameAddress(a, LAUNCH_FACTORIES[1]) ? 'Launch factory B' : 'Factory');

function StakersPanel({ s }: { s: any }) {
  const tx = useBuybackTx();
  const now = useNow();
  const { data: pool } = usePoolSummary();
  const vault = vaultAddress();
  const live = !!s?.live && !!vault;
  const t = s?.target;
  const held = BigInt(s?.polyHeld ?? '0');
  const status = !t?.address ? 'No target' : t.active ? 'Active' : 'Ended';
  const burnDue = live && !t?.active && held > BigInt(0) && t?.burnableAt && now != null && now >= t.burnableAt;
  const pendingAt = Number(s?.pending?.executeAfter ?? 0);
  return (
    <Card title="Stakers">
      <Row label="Rewards target">{t?.address ? <AddrLink address={t.address} /> : 'No target'}</Row>
      <Row label="Status">{live ? status : '-'}</Row>
      <Row label="Target ends">{fmtPT(t?.endTime)}</Row>
      <Row label="Held for stakers">{fmtPoly(s?.polyHeld)} POLYDASH</Row>
      <Row label="Pending change">
        {live && (s?.pending?.target || pendingAt > 0)
          ? <>{s.pending.target ? <AddrLink address={s.pending.target} /> : 'No target'} after {fmtPT(pendingAt)}{now != null && pendingAt > now ? ` (in ${formatCountdown(pendingAt - now)})` : ''}</>
          : 'None'}
      </Row>
      {live && !t?.active && t?.burnableAt && (
        <p className="mt-2 text-[12px] text-white/60">Held POLYDASH can be burned by anyone after {fmtPT(t.burnableAt)}.</p>
      )}
      {sameAddress(t?.address, REWARDS_POOL_ADDRESS) && pool?.live && (
        <div className="mt-3 rounded-xl bg-white/[0.04] p-3">
          <p className="text-[12px] font-medium text-white/80">Current target: POLYDASH Rewards Pool</p>
          <Row label="Total staked">{fmtPoly(pool.totalStaked)} POLYDASH</Row>
          <Row label="Streaming until">{fmtPT(pool.periodFinish)}</Row>
          <Row label="Total added">{fmtPoly(pool.totalNotified)} POLYDASH</Row>
          <Link href="/rewards-pool" className="mt-1 inline-block text-[12px] text-polydash-green hover:underline">Open the Rewards Pool</Link>
        </div>
      )}
      {live && (held > BigInt(0)) && (
        <div className="mt-3 flex flex-wrap gap-2">
          <ConnectOr>
            {t?.active && (
              <TxButton busy={tx.pending === 'release'} onClick={() => tx.send({ key: 'release', address: vault!, abi: 'vault', functionName: 'releaseToTarget', success: 'Released to stakers' })}>Release to stakers</TxButton>
            )}
            {burnDue && (
              <TxButton variant="outline" busy={tx.pending === 'burnHeld'} onClick={() => tx.send({ key: 'burnHeld', address: vault!, abi: 'vault', functionName: 'burnHeldStaking', success: 'Held POLYDASH burned' })}>Burn held POLYDASH</TxButton>
            )}
          </ConnectOr>
        </div>
      )}
      {tx.lastHash && <p className="mt-2 text-[12px] text-white/55">Tx: <TxLink hash={tx.lastHash.hash} /></p>}
    </Card>
  );
}

export function BuybacksDashboard() {
  const { data: s, isLoading } = useBuybackSummary();
  const live = !!s?.live;
  const now = useNow();
  const chart = useBuybackChart(live);
  const hist = useBuybackHistory(live);
  const items: any[] = (hist.data?.pages ?? []).flatMap((p: any) => p?.items ?? []);
  const factories: any[] = s?.factories ?? [];
  const manual = items.filter((i) => i.type === 'Received' && i.source === SOURCE_LABELS.manual);
  const configItems = items.filter((i) => ['BuybackConfigSet', 'TargetProposed', 'TargetCancelled', 'TargetChanged'].includes(i.type));
  const heldBurned = BigInt(s?.polyBurnedHeld ?? '0');
  const totalBurned = BigInt(s?.polyBurned ?? '0') + heldBurned;
  const points: ChartPoint[] = Array.isArray(chart.data?.points) ? chart.data.points : [];
  const nextAt = Number(s?.nextStepAt ?? 0);
  const pre = s?.preHistory;
  const vault = vaultAddress();

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:py-12">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">POLYDASH buybacks</h1>
        <p className="mt-2 max-w-2xl text-[14px] text-white/60">{SPLIT_PHRASE}. Every step is on-chain and public.</p>
      </header>

      {!isLoading && !live && <Note>{NOT_LIVE_VAULT}</Note>}
      {live && pre && (
        <Note tone="muted">
          Tracking starts at vault deployment on {fmtPT(pre.goLiveAt, false)}. Platform fees collected before then: {ethStr(String(Number(pre.backfillEth) / 0.4))} ETH; 40% ({ethStr(pre.backfillEth)} ETH) was sent to the vault at launch.
        </Note>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="buyback-stats">
        <Stat label="Platform fees collected" value={`${ethStr(s?.feesCollectedEth)} ETH`} />
        <Stat
          label="Buyback share received"
          value={fmtEth((BigInt(s?.received?.factory ?? '0') + BigInt(s?.received?.manual ?? '0') + BigInt(s?.received?.direct ?? '0')).toString())}
          sub={`Factory ${fmtToken(s?.received?.factory ?? '0', 5)} · Manual ${fmtToken(s?.received?.manual ?? '0', 5)} · Direct/Other ${fmtToken(s?.received?.direct ?? '0', 5)}`}
        />
        <Stat label="ETH spent" value={fmtEth(s?.ethSpent)} />
        <Stat label="POLYDASH burned" value={fmtPoly(totalBurned.toString())} sub={heldBurned > BigInt(0) ? `Includes ${fmtPoly(s?.polyBurnedHeld)} burned after no target for 30 days` : undefined} />
        <Stat label="POLYDASH for stakers" value={fmtPoly(s?.polyToStakers)} />
        <Stat label="Released to staking" value={fmtPoly(s?.polyReleased)} />
        <Stat label="Held for stakers" value={fmtPoly(s?.polyHeld)} />
        <Stat label="ETH waiting" value={fmtEth(s?.pendingEth)} />
        <Stat
          label="Next step"
          value={live ? STEP_LABELS[Number(s?.nextStep ?? 0)] ?? '-' : 'Not live'}
          sub={live && nextAt && now != null && nextAt > now ? `in ${formatCountdown(nextAt - now)}` : undefined}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <StakersPanel s={s} />
        <Card title="Fee sources">
          <Row label="Launch and trading fees">40% split on-chain</Row>
          <Row label="NFT and staking fees">40% sent weekly by the fee wallet</Row>
          <div className="mt-3">
            <EventList title="Manual transfers received" items={manual} empty={live ? 'None yet.' : 'Listed once the vault is live.'} render={(i) => `${fmtToken(i.ethIn, 5)} ETH`} />
          </div>
        </Card>
      </div>

      <Card title="Cumulative totals by day">
        {points.length ? <BuybackChart data={points} /> : <p className="py-10 text-center text-[12px] text-white/55">No data yet.</p>}
      </Card>

      <BuyTable items={items} hasMore={!!hist.hasNextPage} onMore={() => hist.fetchNextPage()} loadingMore={hist.isFetchingNextPage} />

      <div className="grid gap-6 lg:grid-cols-2">
        <RunBuyback s={s} />
        <CollectFees live={live} />
      </div>

      <Card title="Configuration">
        <Row label="Buyback vault">{vault ? <AddrLink address={vault} /> : 'Not deployed'}</Row>
        <Row label="Max ETH per buy">{LIMITS.maxBuyEth} ETH</Row>
        <Row label="Price band vs recorded price">{LIMITS.priceBandBps / 100}%</Row>
        <Row label="Max slippage">{LIMITS.maxSlippageBps / 100}%</Row>
        <Row label="Cooldown between buys">{LIMITS.cooldownMinutes} min</Row>
        <Row label="Price record valid">{LIMITS.observeDelayMinutes}-{LIMITS.observeMaxAgeMinutes} min after recording</Row>
        <Row label="Burned / stakers share of each buy">{LIMITS.burnShareOfVaultBps / 100}% / {LIMITS.stakersShareOfVaultBps / 100}%</Row>
        <Row label="Target change timelock">{LIMITS.targetTimelockHours} hours</Row>
        <Row label="Burn held POLYDASH after no target">{LIMITS.noTargetBurnDays} days</Row>
        <div className="mt-3 space-y-2" data-testid="factory-settings">
          {factories.map((f) => (
            <div key={f.address} className="rounded-xl bg-white/[0.04] p-3">
              <p className="text-[12px] font-medium text-white/80">{factoryName(f.address)} <AddrLink address={f.address} /></p>
              <Row label="Buyback">{f.enabled ? 'Enabled' : 'Disabled'}, {f.bps} bps ({f.bps / 100}%)</Row>
              <Row label="Buyback contract">{f.contract && !isZeroAddr(f.contract) ? <AddrLink address={f.contract} /> : 'None'}</Row>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <EventList
            title="Change history"
            items={configItems}
            empty={live ? 'No changes yet.' : 'Listed once the vault is live.'}
            render={(i) =>
              i.type === 'BuybackConfigSet' ? `${factoryName(i.factory)} set ${i.enabled ? 'enabled' : 'disabled'}, ${i.bps} bps` :
              i.type === 'TargetProposed' ? `Target proposed: ${isZeroAddr(i.target) ? 'no target' : i.target}` :
              i.type === 'TargetCancelled' ? 'Target proposal cancelled' : `Target changed to ${isZeroAddr(i.target) ? 'no target' : i.target}`
            }
          />
        </div>
        <div className="mt-4"><Note tone="muted">{CONFIG_NOTE}</Note></div>
      </Card>

      <Card title="How it works">
        <ol className="list-decimal space-y-2 pl-5 text-[13px] text-white/75" data-testid="how-it-works">
          {HOW_IT_WORKS.map((h) => <li key={h}>{h}</li>)}
        </ol>
        <p className="mt-3 text-[12px] text-white/55">{WHAT_IT_DOES}</p>
      </Card>

      <Card title="Contracts">
        {REWARDS_POOL_ADDRESS && <ContractLinks name="POLYDASH Rewards Pool" address={REWARDS_POOL_ADDRESS} />}
        {vault && <ContractLinks name="Buyback vault" address={vault} />}
        <ContractLinks name="Launch factory A" address={LAUNCH_FACTORIES[0]} />
        <ContractLinks name="Launch factory B" address={LAUNCH_FACTORIES[1]} />
        <Link href="/rewards-pool" className="mt-2 inline-block text-[12px] text-polydash-green hover:underline">POLYDASH Rewards Pool page</Link>
      </Card>

      <p className="text-center text-[12px] text-white/45">{NOT_AUDITED}</p>
    </div>
  );
}
