// Polypad NFT marketplace indexer: copies market events into the DB for fast filters, sorting and history. Server only.
import { decodeEventLog, formatEther, type Hex } from 'viem';
import { prisma } from '@/lib/db';
import { publicClient, cached } from '@/lib/agents/tools';
import { NftMarketABI, getNftMarketAddress, getPhase2DeployBlock } from '@/lib/contracts/nft-market-abis';

const KEY = 'nft-market';
const THROTTLE_MS = 60_000;
const CHUNK = 2_000_000;
const MAX_RANGE = 40_000_000;

type RawLog = { topics: Hex[]; data: Hex; blockNumber: Hex; transactionHash: Hex; logIndex: Hex };
const hex = (n: number) => `0x${n.toString(16)}`;
const lc = (a: string) => a.toLowerCase();
const eth = (wei: bigint) => Number(formatEther(wei));

async function getLogs(address: string, from: number, to: number, depth = 0): Promise<RawLog[]> {
  try {
    const r = await publicClient.request({ method: 'eth_getLogs', params: [{ address, fromBlock: hex(from), toBlock: hex(to) }] } as any);
    return (r as RawLog[]) ?? [];
  } catch (e) {
    if (depth >= 10 || to - from < 500) throw e;
    const mid = Math.floor((from + to) / 2);
    const [a, b] = await Promise.all([getLogs(address, from, mid, depth + 1), getLogs(address, mid + 1, to, depth + 1)]);
    return [...a, ...b];
  }
}

const blockTime = (n: number) => cached(`blk:${n}`, async () => Number((await publicClient.getBlock({ blockNumber: BigInt(n) })).timestamp), 3_600_000);

async function apply(logs: RawLog[]) {
  const blocks = Array.from(new Set(logs.map((l) => Number(BigInt(l.blockNumber)))));
  const times = new Map<number, number>();
  for (let i = 0; i < blocks.length; i += 10) {
    const part = await Promise.all(blocks.slice(i, i + 10).map(async (b) => [b, await blockTime(b)] as const));
    part.forEach(([b, t]) => times.set(b, t));
  }
  for (const l of logs) {
    let ev: { eventName: string; args: any };
    try {
      ev = decodeEventLog({ abi: NftMarketABI, data: l.data, topics: l.topics as any }) as any;
    } catch {
      continue;
    }
    const a = ev.args;
    const block = Number(BigInt(l.blockNumber));
    const base = { txHash: l.transactionHash, logIndex: Number(BigInt(l.logIndex)), block, ts: times.get(block) ?? 0 };
    const act = (data: { collection: string; tokenId: string; kind: string; price?: bigint; fromAddr?: string; toAddr?: string }) =>
      prisma.nftActivity.createMany({
        data: [{ ...base, collection: lc(data.collection), tokenId: data.tokenId, kind: data.kind, price: String(data.price ?? BigInt(0)), priceEth: eth(data.price ?? BigInt(0)), fromAddr: lc(data.fromAddr ?? ''), toAddr: lc(data.toAddr ?? '') }],
        skipDuplicates: true,
      });
    switch (ev.eventName) {
      case 'Listed': {
        const collection = lc(a.collection), tokenId = String(a.tokenId), id = Number(a.listingId);
        await prisma.nftListing.updateMany({ where: { collection, tokenId, active: true, id: { not: id } }, data: { active: false } });
        const row = { collection, tokenId, seller: lc(a.seller), price: String(a.price), priceEth: eth(a.price), expiry: Number(a.expiry), block };
        await prisma.nftListing.upsert({ where: { id }, create: { id, ...row, active: true }, update: row });
        await act({ collection, tokenId, kind: 'list', price: a.price, fromAddr: a.seller });
        break;
      }
      case 'ListingCancelled':
        await prisma.nftListing.updateMany({ where: { id: Number(a.listingId) }, data: { active: false } });
        await act({ collection: a.collection, tokenId: String(a.tokenId), kind: 'cancel' });
        break;
      case 'Sold':
        await prisma.nftListing.updateMany({ where: { id: Number(a.listingId) }, data: { active: false } });
        await act({ collection: a.collection, tokenId: String(a.tokenId), kind: 'sale', price: a.price, fromAddr: a.seller, toAddr: a.buyer });
        break;
      case 'OfferMade': {
        const id = Number(a.offerId);
        const row = { collection: lc(a.collection), tokenId: String(a.tokenId), anyToken: Boolean(a.anyToken), buyer: lc(a.buyer), price: String(a.price), priceEth: eth(a.price), expiry: Number(a.expiry), block };
        await prisma.nftOffer.upsert({ where: { id }, create: { id, ...row, active: true }, update: row });
        await act({ collection: a.collection, tokenId: a.anyToken ? '' : String(a.tokenId), kind: 'offer', price: a.price, fromAddr: a.buyer });
        break;
      }
      case 'OfferCancelled':
        await prisma.nftOffer.updateMany({ where: { id: Number(a.offerId) }, data: { active: false } });
        await act({ collection: a.collection, tokenId: '', kind: 'offer_cancel', fromAddr: a.buyer });
        break;
      case 'OfferAccepted': {
        const collection = lc(a.collection), tokenId = String(a.tokenId);
        await prisma.nftOffer.updateMany({ where: { id: Number(a.offerId) }, data: { active: false } });
        await prisma.nftListing.updateMany({ where: { collection, tokenId, active: true }, data: { active: false } });
        await act({ collection, tokenId, kind: 'offer_accept', price: a.price, fromAddr: a.seller, toAddr: a.buyer });
        break;
      }
    }
  }
}

let inflight: Promise<void> | null = null;

/** Pull new market events into the DB. Throttled to once a minute; one run at a time. */
export async function syncMarket(force = false): Promise<void> {
  const market = getNftMarketAddress();
  if (!market) return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const state = await prisma.syncState.findUnique({ where: { key: KEY } });
      if (!force && state && Date.now() - state.lastRunAt.getTime() < THROTTLE_MS) return;
      const latest = Number(await publicClient.getBlockNumber());
      const from = state ? state.lastBlock + 1 : Number(getPhase2DeployBlock());
      const to = Math.min(latest, from + MAX_RANGE - 1);
      if (from <= to) {
        for (let s = from; s <= to; s += CHUNK) {
          const e = Math.min(to, s + CHUNK - 1);
          const logs = (await getLogs(market, s, e)).sort((x, y) => Number(BigInt(x.blockNumber) - BigInt(y.blockNumber)) || Number(BigInt(x.logIndex) - BigInt(y.logIndex)));
          await apply(logs);
          await prisma.syncState.upsert({ where: { key: KEY }, create: { key: KEY, lastBlock: e, lastRunAt: new Date() }, update: { lastBlock: e, lastRunAt: new Date() } });
        }
      } else {
        await prisma.syncState.upsert({ where: { key: KEY }, create: { key: KEY, lastBlock: to, lastRunAt: new Date() }, update: { lastRunAt: new Date() } });
      }
    } catch (e) {
      console.error('[nft-market] sync failed', e);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export interface MarketListing { id: number; tokenId: string; seller: string; price: string; priceEth: number; expiry: number }
export interface MarketOffer { id: number; tokenId: string; anyToken: boolean; buyer: string; price: string; priceEth: number; expiry: number }
export interface MarketActivity { id: number; tokenId: string; kind: string; price: string; priceEth: number; fromAddr: string; toAddr: string; txHash: string; ts: number }
export interface MarketData {
  deployed: boolean;
  listings: MarketListing[];
  offers: MarketOffer[];
  activity: MarketActivity[];
  stats: { floor: string | null; topOffer: string | null; listed: number; sales: number; volumeEth: number };
}

const EMPTY: MarketData = { deployed: false, listings: [], offers: [], activity: [], stats: { floor: null, topOffer: null, listed: 0, sales: 0, volumeEth: 0 } };

/** Market view of one collection. Listings are re-checked on-chain (owner, approval, expiry). */
export async function getMarketData(collection: string): Promise<MarketData> {
  const market = getNftMarketAddress();
  if (!market) return EMPTY;
  await Promise.race([syncMarket(), new Promise((r) => setTimeout(r, 4000))]);
  const c = lc(collection);
  const now = Math.floor(Date.now() / 1000);
  const [rows, offers, activity, agg] = await Promise.all([
    prisma.nftListing.findMany({ where: { collection: c, active: true, expiry: { gt: now } }, orderBy: { priceEth: 'asc' }, take: 200 }),
    prisma.nftOffer.findMany({ where: { collection: c, active: true, expiry: { gt: now } }, orderBy: { priceEth: 'desc' }, take: 100 }),
    prisma.nftActivity.findMany({ where: { collection: c }, orderBy: [{ block: 'desc' }, { logIndex: 'desc' }], take: 50 }),
    prisma.nftActivity.aggregate({ where: { collection: c, kind: { in: ['sale', 'offer_accept'] } }, _sum: { priceEth: true }, _count: true }),
  ]);
  let listings = rows;
  if (rows.length) {
    const valid = await publicClient.multicall({
      contracts: rows.map((r) => ({ address: market, abi: NftMarketABI, functionName: 'isListingValid', args: [BigInt(r.id)] })) as any,
      allowFailure: true,
    });
    listings = rows.filter((_, i) => valid[i].status === 'success' && valid[i].result === true);
  }
  return {
    deployed: true,
    listings: listings.map((r) => ({ id: r.id, tokenId: r.tokenId, seller: r.seller, price: r.price, priceEth: r.priceEth, expiry: r.expiry })),
    offers: offers.map((r) => ({ id: r.id, tokenId: r.tokenId, anyToken: r.anyToken, buyer: r.buyer, price: r.price, priceEth: r.priceEth, expiry: r.expiry })),
    activity: activity.map((r) => ({ id: r.id, tokenId: r.tokenId, kind: r.kind, price: r.price, priceEth: r.priceEth, fromAddr: r.fromAddr, toAddr: r.toAddr, txHash: r.txHash, ts: r.ts })),
    stats: {
      floor: listings[0]?.price ?? null,
      topOffer: offers[0]?.price ?? null,
      listed: listings.length,
      sales: agg._count,
      volumeEth: agg._sum.priceEth ?? 0,
    },
  };
}
