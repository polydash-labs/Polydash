/**
 * NFT collections and the Polypad marketplace: browse, and prepare a marketplace buy or a public mint.
 * Collections created by the fixed-price factory are readable and buyable here. Bonding-curve collections
 * are listed when they exist, but this API does not prepare buys for them until their ABI is verified.
 */
import { encodeFunctionData } from 'viem';
import { nftCollectionAbi, nftFactoryAbi, nftMarketAbi } from './abis';
import { ADDR, EXPLORER, LIMITS, SITE_ORIGIN, WORDING } from './config';
import { ApiError, bodyGuard, cached, ethDisplay, guardAmountWei, optUint, reqAddress, assertNotFeeWallet, type Addr, type Ctx, type Meta } from './core';
import { finishPrepared } from './prepared';

export type Collection = {
  address: Addr;
  kind: 'fixed' | 'curve';
  name: string;
  symbol: string;
  imageUri: string;
  creator: Addr | null;
  mintPriceWei: bigint;
  maxSupply: number;
  minted: number;
  commitEnd: number;
  royaltyBps: number;
  floorBps: number;
  maxPerWallet: number;
  status: 'commit_window' | 'public_mint' | 'sold_out' | 'unknown';
};

const FIELDS = ['name', 'symbol', 'imageUri', 'creator', 'mintPrice', 'maxSupply', 'totalMinted', 'commitEnd', 'royaltyBps', 'floorBps', 'maxPerWallet', 'publicAvailable'] as const;

async function factoryList(ctx: Ctx, factory: Addr): Promise<Addr[]> {
  try {
    const n = Number((await ctx.client.readContract({ address: factory, abi: nftFactoryAbi, functionName: 'allCollectionsLength' })) as bigint);
    if (!n) return [];
    const res = await ctx.client.multicall({
      contracts: Array.from({ length: n }, (_, i) => ({ address: factory, abi: nftFactoryAbi, functionName: 'allCollections' as const, args: [BigInt(i)] as const })),
      allowFailure: true,
    });
    return res.filter((r) => r.status === 'success').map((r) => r.result as Addr);
  } catch {
    return [];
  }
}

export async function allCollections(ctx: Ctx): Promise<Collection[]> {
  return cached(ctx, 'nft-collections', 30_000, async () => {
    const [fixed, curve] = await Promise.all([factoryList(ctx, ADDR.nftFactory), factoryList(ctx, ADDR.nftCurveFactory)]);
    const items = [...fixed.map((a) => ({ a, kind: 'fixed' as const })), ...curve.map((a) => ({ a, kind: 'curve' as const }))];
    if (!items.length) return [];
    const res = await ctx.client.multicall({
      contracts: items.flatMap((it) => FIELDS.map((f) => ({ address: it.a, abi: nftCollectionAbi, functionName: f }) as never)),
      allowFailure: true,
    });
    const now = ctx.nowSec();
    return items.map((it, i) => {
      const o: Record<string, unknown> = {};
      FIELDS.forEach((f, j) => {
        const r = res[i * FIELDS.length + j];
        o[f] = r.status === 'success' ? r.result : undefined;
      });
      const max = Number((o.maxSupply as bigint) ?? 0n);
      const minted = Number((o.totalMinted as bigint) ?? 0n);
      const commitEnd = Number((o.commitEnd as bigint) ?? 0n);
      let status: Collection['status'] = 'unknown';
      if (it.kind === 'fixed' && max > 0) status = minted >= max ? 'sold_out' : now < commitEnd ? 'commit_window' : 'public_mint';
      return {
        address: it.a,
        kind: it.kind,
        name: (o.name as string) ?? 'Unknown',
        symbol: (o.symbol as string) ?? '',
        imageUri: (o.imageUri as string) ?? '',
        creator: (o.creator as Addr) ?? null,
        mintPriceWei: (o.mintPrice as bigint) ?? 0n,
        maxSupply: max,
        minted,
        commitEnd,
        royaltyBps: Number((o.royaltyBps as bigint) ?? 0n),
        floorBps: Number((o.floorBps as bigint) ?? 0n),
        maxPerWallet: Number((o.maxPerWallet as bigint) ?? 0n),
        status,
      } satisfies Collection;
    });
  });
}

export function collectionView(c: Collection) {
  return {
    name: c.name,
    symbol: c.symbol,
    collection: c.address,
    type: c.kind === 'fixed' ? 'fixed price (commitment window, then public mint)' : 'bonding curve',
    status: c.status,
    imageUri: c.imageUri,
    minted: c.minted,
    maxSupply: c.maxSupply,
    mintPriceWei: c.mintPriceWei.toString(),
    mintPriceDisplay: `${ethDisplay(c.mintPriceWei)} ETH`,
    maxPerWallet: c.maxPerWallet,
    royaltyPct: c.royaltyBps / 100,
    floorVaultPct: c.floorBps / 100,
    commitWindowEnds: c.commitEnd ? new Date(c.commitEnd * 1000).toISOString() : null,
    page: `${SITE_ORIGIN}/nfts/${c.address}`,
    explorer: `${EXPLORER}/address/${c.address}`,
    buyable: c.kind === 'fixed' && c.status === 'public_mint',
  };
}

export async function listNfts(ctx: Ctx, input: { q?: string; status?: string; sort?: string; limit?: number }) {
  let rows = await allCollections(ctx);
  const q = input.q?.trim().toLowerCase();
  if (q) rows = rows.filter((c) => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q) || c.address.toLowerCase() === q);
  if (input.status) rows = rows.filter((c) => c.status === input.status);
  const sort = input.sort ?? 'newest';
  if (sort === 'newest') rows = [...rows].reverse();
  else if (sort === 'minted') rows = [...rows].sort((a, b) => b.minted - a.minted);
  else if (sort === 'price') rows = [...rows].sort((a, b) => Number(a.mintPriceWei - b.mintPriceWei));
  else throw new ApiError(400, 'invalid_params', 'sort must be newest, minted, or price.', { field: 'sort' });
  const limit = Math.min(LIMITS.listMax, Math.max(1, input.limit ?? 12));
  return { ok: true, count: Math.min(limit, rows.length), total: rows.length, collections: rows.slice(0, limit).map(collectionView) };
}

export type Listing = { id: number; seller: Addr; nft: Addr; tokenId: bigint; priceWei: bigint; expiry: number; valid: boolean };

export async function loadListings(ctx: Ctx): Promise<Listing[]> {
  return cached(ctx, 'nft-listings', 15_000, async () => {
    const next = Number((await ctx.client.readContract({ address: ADDR.nftMarket, abi: nftMarketAbi, functionName: 'nextListingId' })) as bigint);
    const ids = Array.from({ length: Math.max(0, Math.min(next - 1, 500)) }, (_, i) => i + 1);
    if (!ids.length) return [];
    const res = await ctx.client.multicall({
      contracts: ids.flatMap((id) => [
        { address: ADDR.nftMarket, abi: nftMarketAbi, functionName: 'listings' as const, args: [BigInt(id)] as const },
        { address: ADDR.nftMarket, abi: nftMarketAbi, functionName: 'isListingValid' as const, args: [BigInt(id)] as const },
      ]),
      allowFailure: true,
    });
    const out: Listing[] = [];
    ids.forEach((id, i) => {
      const l = res[i * 2];
      const v = res[i * 2 + 1];
      if (l.status !== 'success') return;
      const [seller, nft, tokenId, price, expiry] = l.result as readonly [Addr, Addr, bigint, bigint, bigint];
      out.push({ id, seller, nft, tokenId, priceWei: price, expiry: Number(expiry), valid: v.status === 'success' && v.result === true });
    });
    return out;
  });
}

export async function listNftListings(ctx: Ctx, input: { collection?: Addr; maxPriceWei?: bigint; limit?: number }) {
  const [rows, cols] = await Promise.all([loadListings(ctx), allCollections(ctx)]);
  const byAddr = new Map(cols.map((c) => [c.address, c]));
  let valid = rows.filter((r) => r.valid);
  if (input.collection) valid = valid.filter((r) => r.nft === input.collection);
  if (input.maxPriceWei !== undefined) valid = valid.filter((r) => r.priceWei <= input.maxPriceWei!);
  valid.sort((a, b) => Number(a.priceWei - b.priceWei));
  const limit = Math.min(LIMITS.listMax, Math.max(1, input.limit ?? 20));
  return {
    ok: true,
    marketplace: ADDR.nftMarket,
    activeListings: valid.length,
    listings: valid.slice(0, limit).map((r) => ({
      listingId: r.id,
      collection: r.nft,
      collectionName: byAddr.get(r.nft)?.name ?? null,
      tokenId: r.tokenId.toString(),
      priceWei: r.priceWei.toString(),
      priceDisplay: `${ethDisplay(r.priceWei)} ETH`,
      seller: r.seller,
      expiresAt: r.expiry ? new Date(r.expiry * 1000).toISOString() : null,
      page: `${SITE_ORIGIN}/nfts/${r.nft}`,
    })),
    note: 'Prices are fixed listings by holders. A creator royalty is included in the price shown.',
  };
}

const NFT_RISKS = ['NFT prices can fall to zero. A floor vault pays a share of what the vault holds, which can be small.', WORDING.notAudited];

export async function prepareNftBuy(ctx: Ctx, rawInput: unknown, meta: Meta) {
  const input = bodyGuard(rawInput);
  const from = reqAddress(input, 'from');
  assertNotFeeWallet(from);

  // Marketplace listing
  if (input.listingId !== undefined && input.listingId !== null && input.listingId !== '') {
    const id = BigInt(optUint(input.listingId, 'listingId', 0, 1, 1_000_000_000));
    const row = (await loadListings({ ...ctx, cache: new Map() })).find((r) => BigInt(r.id) === id);
    if (!row) throw new ApiError(404, 'not_found', `Listing ${id} does not exist.`);
    if (!row.valid) throw new ApiError(409, 'listing_not_valid', `Listing ${id} is sold, cancelled, expired, or no longer backed by the seller.`);
    if (row.seller === from) throw new ApiError(409, 'own_listing', 'This wallet is the seller of that listing.');
    guardAmountWei(row.priceWei, input, 'price');
    const bal = await ctx.client.getBalance({ address: from });
    if (bal < row.priceWei) throw new ApiError(409, 'insufficient_balance', `The wallet holds ${ethDisplay(bal)} ETH, less than the ${ethDisplay(row.priceWei)} ETH price.`);
    const col = (await allCollections(ctx)).find((c) => c.address === row.nft);
    return finishPrepared(ctx, {
      action: 'nft-buy',
      signParams: { l: row.id },
      from,
      meta,
      allowTargets: [],
      steps: [{ kind: 'market_buy', description: 'Buy the listed NFT from the Polypad marketplace. The listing price is sent with the transaction.', to: ADDR.nftMarket, data: encodeFunctionData({ abi: nftMarketAbi, functionName: 'buy', args: [id] }), value: row.priceWei, simulate: true }],
      summary: {
        headline: `Buy ${col?.name ?? 'NFT'} #${row.tokenId} for ${ethDisplay(row.priceWei)} ETH`,
        lines: [`Marketplace listing ${row.id}`, `Collection: ${col?.name ?? row.nft}`, `Price: ${ethDisplay(row.priceWei)} ETH (creator royalty included)`, `Seller: ${row.seller}`],
        youPay: `${ethDisplay(row.priceWei)} ETH`,
        risks: NFT_RISKS,
      },
      extra: { listing: { listingId: row.id, collection: row.nft, tokenId: row.tokenId.toString(), priceWei: row.priceWei.toString() } },
    });
  }

  // Public mint from a fixed-price collection
  const colAddr = reqAddress(input, 'collection');
  const col = (await allCollections(ctx)).find((c) => c.address === colAddr);
  if (!col) throw new ApiError(404, 'not_found', 'That address is not a Polypad NFT collection.');
  if (col.kind !== 'fixed') throw new ApiError(501, 'unsupported_collection_type', 'Buys from bonding-curve collections are not prepared by this API yet. Open the collection page.', { page: `${SITE_ORIGIN}/nfts/${col.address}` });
  if (col.status === 'sold_out') throw new ApiError(409, 'sold_out', `${col.name} is sold out. Check marketplace listings instead.`);
  if (col.status === 'commit_window') {
    throw new ApiError(409, 'commit_window_open', `${col.name} is in its commitment window until ${new Date(col.commitEnd * 1000).toISOString()}. Commit from the collection page.`, { page: `${SITE_ORIGIN}/nfts/${col.address}` });
  }
  const qty = BigInt(optUint(input.quantity, 'quantity', 1, 1, 50));
  const minted = (await ctx.client.readContract({ address: col.address, abi: nftCollectionAbi, functionName: 'walletMinted', args: [from] })) as bigint;
  if (col.maxPerWallet > 0 && minted + qty > BigInt(col.maxPerWallet)) {
    throw new ApiError(409, 'wallet_cap', `This collection allows ${col.maxPerWallet} per wallet. This wallet has minted ${minted}.`, { maxPerWallet: col.maxPerWallet, minted: minted.toString() });
  }
  if (BigInt(col.maxSupply - col.minted) < qty) throw new ApiError(409, 'sold_out', `Only ${col.maxSupply - col.minted} left.`);
  const cost = col.mintPriceWei * qty;
  guardAmountWei(cost, input, 'cost');
  const bal = await ctx.client.getBalance({ address: from });
  if (bal < cost) throw new ApiError(409, 'insufficient_balance', `The wallet holds ${ethDisplay(bal)} ETH, less than the ${ethDisplay(cost)} ETH cost.`);
  return finishPrepared(ctx, {
    action: 'nft-mint',
    signParams: { col: col.address, q: qty.toString() },
    from,
    meta,
    allowTargets: [col.address],
    steps: [{ kind: 'mint', description: 'Mint from the collection at its fixed price.', to: col.address, data: encodeFunctionData({ abi: nftCollectionAbi, functionName: 'mint', args: [qty] }), value: cost, simulate: true }],
    summary: {
      headline: `Mint ${qty} x ${col.name} for ${ethDisplay(cost)} ETH`,
      lines: [`Collection: ${col.name}`, `Price each: ${ethDisplay(col.mintPriceWei)} ETH`, `Quantity: ${qty}`, `A share of the price stays in the collection floor vault (${col.floorBps / 100}%).`],
      youPay: `${ethDisplay(cost)} ETH`,
      risks: NFT_RISKS,
    },
    extra: { collection: collectionView(col) },
  });
}
