/**
 * Polypad Funds: discovery with filters, templates, and prepared create, mint, and exit/refund.
 * A fund is created from a published strategy template. The manager cannot pass looser rules.
 */
import { encodeFunctionData, decodeFunctionResult, getAddress, isAddress, parseAbi } from 'viem';
import { createFundAbi, erc20Abi, fundFactoryAbi, fundNftAbi, fundVaultAbi, templatesAbi } from './abis';
import { ADDR, CHAIN_FIRST_BLOCK, EXPLORER, FUND_STATUS, LIMITS, SITE_ORIGIN, WORDING } from './config';
import {
  ApiError, assertNotFeeWallet, bodyGuard, cached, ethDisplay, guardAmountWei, optUint, parseUnits10, reqAddress,
  type Addr, type Ctx, type Meta,
} from './core';
import { getLogsChunked } from './logs';
import { finishPrepared, validReturnUrl } from './prepared';

const BPS = 10_000n;

export type Template = {
  id: number;
  label: string;
  mandateUri: string;
  assets: { address: Addr; symbol: string }[];
  maxPositionBps: number;
  maxTradeBps: number;
  maxDeviationBps: number;
  performanceFeeBps: number;
  drawdownBrakeBps: number;
  skinLockSeconds: number;
};

/** Only template 2 has a published name (Polypad Funds docs, Phase 6 page). Others are described by their rules. */
const TEMPLATE_NAMES: Record<number, string> = { 2: 'Polydash Growth Fund' };

export async function loadTemplates(ctx: Ctx): Promise<Template[]> {
  return cached(ctx, 'fund-templates', 600_000, async () => {
    const count = Number((await ctx.client.readContract({ address: ADDR.strategyTemplates, abi: templatesAbi, functionName: 'templateCount' })) as bigint);
    const out: Template[] = [];
    for (let id = 1; id <= count; id += 1) {
      const [t, assets] = await Promise.all([
        ctx.client.readContract({ address: ADDR.strategyTemplates, abi: templatesAbi, functionName: 'getTemplate', args: [BigInt(id)] }),
        ctx.client.readContract({ address: ADDR.strategyTemplates, abi: templatesAbi, functionName: 'assetsOf', args: [BigInt(id)] }),
      ]);
      const syms = await ctx.client.multicall({
        contracts: (assets as Addr[]).map((a) => ({ address: a, abi: erc20Abi, functionName: 'symbol' as const })),
        allowFailure: true,
      });
      const list = (assets as Addr[]).map((a, i) => ({ address: a, symbol: syms[i].status === 'success' ? String(syms[i].result) : 'token' }));
      const [, mandateUri, maxPos, maxTrade, maxDev, hwm, dd, skin] = t as readonly [string, string, bigint, bigint, bigint, bigint, bigint, bigint];
      out.push({
        id,
        label: TEMPLATE_NAMES[id] ?? (list.length === 0 ? 'ETH and WETH only (quote-only mandate)' : `${list.map((x) => x.symbol).join(' + ')} mandate, ${Number(hwm) / 100}% performance fee`),
        mandateUri,
        assets: list,
        maxPositionBps: Number(maxPos),
        maxTradeBps: Number(maxTrade),
        maxDeviationBps: Number(maxDev),
        performanceFeeBps: Number(hwm),
        drawdownBrakeBps: Number(dd),
        skinLockSeconds: Number(skin),
      });
    }
    return out;
  });
}

export function templateView(t: Template) {
  return {
    templateId: t.id,
    label: t.label,
    assets: t.assets.length ? t.assets.map((a) => `${a.symbol} (${a.address})`) : ['ETH and WETH only'],
    maxPositionPct: t.maxPositionBps / 100,
    maxTradePct: t.maxTradeBps / 100,
    maxPriceDeviationPct: t.maxDeviationBps / 100,
    performanceFeePct: t.performanceFeeBps / 100,
    drawdownBrakePct: t.drawdownBrakeBps ? t.drawdownBrakeBps / 100 : null,
    managerSkinLockDays: Math.round(t.skinLockSeconds / 86_400),
    mandate: t.mandateUri,
  };
}

export async function listTemplates(ctx: Ctx) {
  const t = await loadTemplates(ctx);
  return {
    ok: true,
    count: t.length,
    templates: t.map(templateView),
    note: 'Templates are published and locked. A fund copies one at creation. Stock tokens and similar regulated instruments are not part of the shipped funds.',
    disclaimer: WORDING.notAudited,
  };
}

// ---------------------------------------------------------------- reading funds

export type Fund = {
  address: Addr;
  vault: Addr | null;
  factoryId: string;
  factoryLabel: string;
  name: string;
  symbol: string;
  manager: Addr | null;
  status: number | null;
  statusName: string;
  mintPriceWei: bigint;
  maxSupply: number;
  minted: number;
  burned: number;
  entryFeeBps: number;
  protocolFeeBps: number;
  skinRequired: number;
  managerMinted: number;
  publicOpen: boolean;
  deadline: number;
  templateId: number | null;
  assets: { address: Addr; symbol: string }[];
  navPerNftWei: bigint | null;
  protection: { met: number; total: number } | null;
  imageUri: string;
};

const NFT_FIELDS = ['name', 'symbol', 'manager', 'vault', 'mintPrice', 'maxSupply', 'totalMinted', 'totalBurned', 'entryFeeBps', 'protocolFeeBps', 'skinRequired', 'managerMinted', 'publicOpen', 'imageUri'] as const;
const VAULT_FIELDS = ['status', 'raiseDeadline', 'templateId', 'navPerNft', 'protectionBits', 'mandateAssetCount'] as const;

/** One retry for a single factory's fund count: a dropped RPC call used to silently drop the whole factory from the fund list. */
async function readAllFundsLength(ctx: Ctx, factory: Addr): Promise<bigint> {
  try {
    return (await ctx.client.readContract({ address: factory, abi: fundFactoryAbi, functionName: 'allFundsLength' })) as bigint;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 300));
    try {
      return (await ctx.client.readContract({ address: factory, abi: fundFactoryAbi, functionName: 'allFundsLength' })) as bigint;
    } catch (err) {
      console.warn(`agents v2 fund list: allFundsLength failed for factory ${factory} after retry; skipping factory`, err);
      return 0n;
    }
  }
}

async function fundAddresses(ctx: Ctx): Promise<{ address: Addr; factoryId: string; factoryLabel: string }[]> {
  return cached(ctx, 'fund-addrs', 20_000, async () => {
    const out: { address: Addr; factoryId: string; factoryLabel: string }[] = [];
    for (const f of ADDR.fundFactories) {
      const n = Number(await readAllFundsLength(ctx, f.factory));
      if (!n) continue;
      const res = await ctx.client.multicall({
        contracts: Array.from({ length: n }, (_, i) => ({ address: f.factory, abi: fundFactoryAbi, functionName: 'allFunds' as const, args: [BigInt(i)] as const })),
        allowFailure: true,
      });
      for (const r of res) if (r.status === 'success') out.push({ address: r.result as Addr, factoryId: f.id, factoryLabel: f.label });
    }
    return out;
  });
}

async function loadFunds(ctx: Ctx, items: { address: Addr; factoryId: string; factoryLabel: string }[]): Promise<Fund[]> {
  if (!items.length) return [];
  const nres = await ctx.client.multicall({
    contracts: items.flatMap((it) => NFT_FIELDS.map((f) => ({ address: it.address, abi: fundNftAbi, functionName: f }) as never)),
    allowFailure: true,
  });
  const nft = items.map((_, i) => {
    const o: Record<string, unknown> = {};
    NFT_FIELDS.forEach((f, j) => {
      const r = nres[i * NFT_FIELDS.length + j];
      o[f] = r.status === 'success' ? r.result : undefined;
    });
    return o;
  });
  const vres = await ctx.client.multicall({
    contracts: nft.flatMap((n) => VAULT_FIELDS.map((f) => ({ address: (n.vault as Addr) ?? ADDR.weth, abi: fundVaultAbi, functionName: f }) as never)),
    allowFailure: true,
  });
  const vault = nft.map((_, i) => {
    const o: Record<string, unknown> = {};
    VAULT_FIELDS.forEach((f, j) => {
      const r = vres[i * VAULT_FIELDS.length + j];
      o[f] = r.status === 'success' ? r.result : undefined;
    });
    return o;
  });
  const out: Fund[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const n = nft[i];
    const v = vault[i];
    const count = Number((v.mandateAssetCount as bigint) ?? 0n);
    let assets: { address: Addr; symbol: string }[] = [];
    if (count > 0 && n.vault) {
      const addrs = await ctx.client.multicall({
        contracts: Array.from({ length: Math.min(count, 16) }, (_, k) => ({ address: n.vault as Addr, abi: fundVaultAbi, functionName: 'mandateAssets' as const, args: [BigInt(k)] as const })),
        allowFailure: true,
      });
      const list = addrs.filter((r) => r.status === 'success').map((r) => r.result as Addr);
      const syms = await ctx.client.multicall({ contracts: list.map((a) => ({ address: a, abi: erc20Abi, functionName: 'symbol' as const })), allowFailure: true });
      assets = list.map((a, k) => ({ address: a, symbol: syms[k].status === 'success' ? String(syms[k].result) : 'token' }));
    }
    const status = v.status === undefined ? null : Number(v.status);
    const bits = v.protectionBits as readonly [number, number, number] | undefined;
    out.push({
      address: items[i].address,
      vault: (n.vault as Addr) ?? null,
      factoryId: items[i].factoryId,
      factoryLabel: items[i].factoryLabel,
      name: (n.name as string) ?? 'Unknown',
      symbol: (n.symbol as string) ?? '',
      manager: (n.manager as Addr) ?? null,
      status,
      statusName: status === null ? 'unknown' : FUND_STATUS[status] ?? 'unknown',
      mintPriceWei: (n.mintPrice as bigint) ?? 0n,
      maxSupply: Number((n.maxSupply as bigint) ?? 0n),
      minted: Number((n.totalMinted as bigint) ?? 0n),
      burned: Number((n.totalBurned as bigint) ?? 0n),
      entryFeeBps: Number((n.entryFeeBps as bigint) ?? 0n),
      protocolFeeBps: Number((n.protocolFeeBps as bigint) ?? 0n),
      skinRequired: Number((n.skinRequired as bigint) ?? 0n),
      managerMinted: Number((n.managerMinted as bigint) ?? 0n),
      publicOpen: Boolean(n.publicOpen),
      deadline: Number((v.raiseDeadline as bigint) ?? 0n),
      templateId: v.templateId === undefined ? null : Number(v.templateId),
      assets,
      navPerNftWei: (v.navPerNft as bigint) ?? null,
      protection: bits ? { met: Number(bits[1]), total: Number(bits[2]) } : null,
      imageUri: (n.imageUri as string) ?? '',
    });
  }
  return out;
}

export async function allFunds(ctx: Ctx): Promise<Fund[]> {
  return cached(ctx, 'fund-all', 15_000, async () => loadFunds(ctx, await fundAddresses(ctx)));
}

export function fundView(f: Fund, nowSec: number) {
  const raiseCap = f.mintPriceWei * BigInt(f.maxSupply);
  const raised = f.mintPriceWei * BigInt(f.minted);
  const open = f.statusName === 'raising' && f.deadline > nowSec && f.minted < f.maxSupply;
  return {
    name: f.name,
    symbol: f.symbol,
    fund: f.address,
    vault: f.vault,
    factory: f.factoryLabel,
    manager: f.manager,
    status: f.statusName,
    templateId: f.templateId,
    assets: f.assets.length ? f.assets.map((a) => a.symbol) : f.templateId ? ['ETH and WETH only'] : [],
    mintPriceWei: f.mintPriceWei.toString(),
    mintPriceDisplay: `${ethDisplay(f.mintPriceWei)} ETH`,
    shares: { minted: f.minted, burned: f.burned, maxSupply: f.maxSupply },
    raise: {
      capDisplay: `${ethDisplay(raiseCap)} ETH`,
      raisedDisplay: `${ethDisplay(raised)} ETH`,
      progressPct: f.maxSupply ? Math.round((f.minted / f.maxSupply) * 1000) / 10 : 0,
      deadline: f.deadline ? new Date(f.deadline * 1000).toISOString() : null,
    },
    entryFeePct: f.entryFeeBps / 100,
    protocolFeePct: f.protocolFeeBps / 100,
    publicMintOpen: open && (f.publicOpen || f.manager === null),
    managerMustMintFirst: open && !f.publicOpen ? { sharesRequired: f.skinRequired, sharesMinted: f.managerMinted } : null,
    netValuePerShareDisplay: f.navPerNftWei === null ? null : `${ethDisplay(f.navPerNftWei, 8)} ETH`,
    protectionBits: f.protection ? `${f.protection.met} of ${f.protection.total}` : null,
    page: `${SITE_ORIGIN}/funds/${f.address}`,
    explorer: `${EXPLORER}/address/${f.address}`,
  };
}

export type FundFilters = {
  status?: string; templateId?: number; asset?: string; manager?: Addr; factory?: string; open?: boolean; q?: string; sort?: string; limit?: number;
};

export async function listFunds(ctx: Ctx, f: FundFilters) {
  let rows = await allFunds(ctx);
  const now = ctx.nowSec();
  if (f.status) rows = rows.filter((x) => x.statusName === f.status);
  if (f.templateId !== undefined) rows = rows.filter((x) => x.templateId === f.templateId);
  if (f.factory) rows = rows.filter((x) => x.factoryId === f.factory);
  if (f.manager) rows = rows.filter((x) => x.manager === f.manager);
  if (f.open) rows = rows.filter((x) => x.statusName === 'raising' && x.deadline > now && x.minted < x.maxSupply);
  if (f.asset) {
    const a = f.asset.trim().toLowerCase();
    rows = rows.filter((x) => (x.assets.length === 0 ? a === 'eth' || a === 'weth' || a === ADDR.weth.toLowerCase() : x.assets.some((y) => y.symbol.toLowerCase() === a || y.address.toLowerCase() === a)));
  }
  if (f.q) {
    const q = f.q.trim().toLowerCase();
    rows = rows.filter((x) => x.name.toLowerCase().includes(q) || x.symbol.toLowerCase().includes(q) || x.address.toLowerCase() === q);
  }
  const sort = f.sort ?? 'newest';
  const sorters: Record<string, (a: Fund, b: Fund) => number> = {
    newest: () => 0,
    raise_progress: (a, b) => b.minted / (b.maxSupply || 1) - a.minted / (a.maxSupply || 1),
    deadline: (a, b) => a.deadline - b.deadline,
    shares: (a, b) => b.minted - a.minted,
  };
  if (!sorters[sort]) throw new ApiError(400, 'invalid_params', 'sort must be newest, raise_progress, deadline, or shares.', { field: 'sort' });
  rows = sort === 'newest' ? [...rows].reverse() : [...rows].sort(sorters[sort]);
  const limit = Math.min(LIMITS.listMax, Math.max(1, f.limit ?? 12));
  return {
    ok: true,
    total: rows.length,
    funds: rows.slice(0, limit).map((x) => fundView(x, now)),
    note: 'Funds hold ETH and the assets their template allows. Investors can lose some or all of their ETH.',
    disclaimer: WORDING.notAudited,
  };
}

/** Find one fund by address, vault address, name, or symbol. `fresh` skips the shared list cache. */
export async function findFund(ctx: Ctx, ref: string, opts: { fresh?: boolean } = {}): Promise<Fund> {
  const all = await allFunds(opts.fresh ? { ...ctx, cache: new Map() } : ctx);
  const q = ref.trim();
  let hit: Fund | undefined;
  if (isAddress(q, { strict: false })) {
    const a = getAddress(q);
    hit = all.find((x) => x.address === a || x.vault === a);
  } else {
    const l = q.toLowerCase();
    const m = all.filter((x) => x.name.toLowerCase() === l || x.symbol.toLowerCase() === l);
    if (m.length > 1) throw new ApiError(409, 'ambiguous_fund', `More than one fund matches "${q}". Use the fund address.`, { matches: m.map((x) => ({ name: x.name, fund: x.address })) });
    hit = m[0];
  }
  if (!hit) throw new ApiError(404, 'not_found', 'No Polypad fund matches that name or address.');
  return hit;
}

export async function getFund(ctx: Ctx, ref: string) {
  const hit = await findFund(ctx, ref);
  const tpl = hit.templateId ? (await loadTemplates(ctx)).find((t) => t.id === hit.templateId) : undefined;
  return { ok: true, fund: fundView(hit, ctx.nowSec()), template: tpl ? templateView(tpl) : null, disclaimer: WORDING.notAudited };
}

// ---------------------------------------------------------------- prepare_fund_create

const RISK_FUND = [
  'Investors can lose some or all of their ETH. A template limits a manager. It does not remove market risk.',
  'Price feeds can be missing or stale, which makes net value reads fail.',
  WORDING.notAudited,
];

export type AssetWish = { raw: string; matched: boolean };

/** Which templates can hold every asset the user asked for. Assets are matched by symbol or address. */
export function matchTemplates(templates: Template[], wishes: string[]): { matches: Template[]; unmatched: string[] } {
  const want = wishes.map((w) => w.trim().toLowerCase()).filter(Boolean).filter((w) => !['eth', 'weth', 'ether'].includes(w));
  const known = new Set<string>();
  for (const t of templates) for (const a of t.assets) { known.add(a.symbol.toLowerCase()); known.add(a.address.toLowerCase()); }
  const unmatched = want.filter((w) => !known.has(w));
  const matches = want.length === 0
    ? templates.filter((t) => t.assets.length === 0)
    : templates.filter((t) => want.every((w) => t.assets.some((a) => a.symbol.toLowerCase() === w || a.address.toLowerCase() === w)));
  return { matches, unmatched };
}

export async function prepareFundCreate(ctx: Ctx, rawInput: unknown, meta: Meta) {
  const input = bodyGuard(rawInput);
  const from = reqAddress(input, 'from');
  assertNotFeeWallet(from);
  const templates = await loadTemplates(ctx);

  let templateId: number | undefined = input.templateId === undefined || input.templateId === '' ? undefined : optUint(input.templateId, 'templateId', 0, 1, 1000);
  if (templateId === undefined) {
    const wishes = Array.isArray(input.assets) ? input.assets.map(String) : [];
    const { matches, unmatched } = matchTemplates(templates, wishes);
    if (unmatched.length || matches.length === 0) {
      throw new ApiError(422, 'no_matching_template', unmatched.length
        ? `No published template can hold: ${unmatched.join(', ')}. A fund can only hold the assets its template lists. Stock tokens are not part of the shipped funds.`
        : 'Pick a template to continue.', {
        unmatchedAssets: unmatched,
        availableTemplates: templates.map(templateView),
        hint: 'Ask the user to choose one of the available templates, or to launch an ETH-only fund (template 1).',
      });
    }
    if (matches.length > 1) {
      throw new ApiError(409, 'choose_template', 'More than one template fits. Ask the user which one.', { candidates: matches.map(templateView) });
    }
    templateId = matches[0].id;
  }
  const tpl = templates.find((t) => t.id === templateId);
  if (!tpl) throw new ApiError(404, 'unknown_template', `Template ${templateId} does not exist.`, { availableTemplates: templates.map((t) => t.id) });

  const factory = ADDR.fundFactories.find((f) => f.id === (typeof input.factory === 'string' ? input.factory : 'phase6'));
  if (!factory || !factory.creatable) throw new ApiError(400, 'invalid_params', 'factory must be "phase6", "phase3", or "v3".', { field: 'factory' });

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const symbol = typeof input.symbol === 'string' ? input.symbol.trim() : '';
  const enc = new TextEncoder();
  if (!name || enc.encode(name).length > 64) throw new ApiError(400, 'invalid_params', 'name is required, at most 64 bytes.', { field: 'name' });
  if (!symbol || enc.encode(symbol).length > 16) throw new ApiError(400, 'invalid_params', 'symbol is required, at most 16 bytes.', { field: 'symbol' });
  const imageUri = typeof input.imageUri === 'string' ? input.imageUri.trim() : '';
  const baseURI = typeof input.baseURI === 'string' ? input.baseURI.trim() : '';
  for (const [k, v] of [['imageUri', imageUri], ['baseURI', baseURI]] as const) {
    if (enc.encode(v).length > 512 || /\s/.test(v) || (v && !/^(https:|ipfs:)\/\//.test(v))) throw new ApiError(400, 'invalid_params', `${k} must be an https:// or ipfs:// URL of at most 512 bytes, or empty.`, { field: k });
  }

  const [minPrice, maxPrice, maxSupplyLimit, maxEntry, minDur, maxDur] = await Promise.all(
    (['MIN_MINT_PRICE', 'MAX_MINT_PRICE', 'MAX_SUPPLY', 'MAX_ENTRY_FEE_BPS', 'MIN_RAISE_DURATION', 'MAX_RAISE_DURATION'] as const).map(
      (fn) => ctx.client.readContract({ address: factory.factory, abi: fundFactoryAbi, functionName: fn }) as Promise<bigint>,
    ),
  );
  const mintPrice = parseUnits10(input.mintPriceWei, 'mintPriceWei');
  const raiseCap = parseUnits10(input.raiseCapWei, 'raiseCapWei');
  if (mintPrice < minPrice || mintPrice > maxPrice) throw new ApiError(400, 'invalid_params', `mintPrice must be from ${ethDisplay(minPrice)} to ${ethDisplay(maxPrice)} ETH.`, { field: 'mintPriceWei' });
  const maxSupply = raiseCap / mintPrice;
  if (maxSupply < 1n || maxSupply > maxSupplyLimit) throw new ApiError(400, 'invalid_params', `raiseCap divided by mintPrice must be from 1 to ${maxSupplyLimit} shares. It is ${maxSupply}.`, { field: 'raiseCapWei' });
  const entryFeeBps = BigInt(optUint(input.entryFeeBps, 'entryFeeBps', 0, 0, Number(maxEntry)));
  const skinBpsIn = BigInt(optUint(input.minSkinBps, 'minSkinBps', 0, 0, 10_000));
  if (skinBpsIn !== 0n && skinBpsIn < 500n) throw new ApiError(400, 'invalid_params', 'minSkinBps must be 0 (default 5%) or from 500 to 10000.', { field: 'minSkinBps' });
  const durDays = input.raiseDurationDays;
  const duration = durDays !== undefined && durDays !== '' ? BigInt(optUint(durDays, 'raiseDurationDays', 7, 1, 30)) * 86_400n : BigInt(optUint(input.raiseDurationSeconds, 'raiseDurationSeconds', 7 * 86_400, Number(minDur), Number(maxDur)));
  const skinBps = skinBpsIn === 0n ? 500n : skinBpsIn;
  const skinShares = (maxSupply * skinBps + BPS - 1n) / BPS;
  const skinCost = skinShares * mintPrice;

  const params = { templateId: BigInt(templateId), name, symbol, imageUri, baseURI, mintPrice, raiseCap, entryFeeBps, minSkinBps: skinBpsIn, raiseDuration: duration };
  const data = encodeFunctionData({ abi: createFundAbi, functionName: 'createFund', args: [params] });

  const prepared = await finishPrepared(ctx, {
    action: 'fund-create',
    signParams: { fx: factory.id, tpl: templateId, n: name, s: symbol, mp: mintPrice.toString(), rc: raiseCap.toString(), ef: entryFeeBps.toString(), sk: skinBpsIn.toString(), rd: duration.toString(), img: imageUri, bu: baseURI },
    from, meta, allowTargets: [],
    returnUrl: validReturnUrl(input.returnUrl),
    steps: [{ kind: 'create_fund', description: 'Create the fund. The sending wallet becomes the manager.', to: factory.factory, data, value: 0n, simulate: true }],
    summary: {
      headline: `Create the fund "${name}" (${symbol}) from template ${templateId}`,
      lines: [
        `Template: ${tpl.label}`,
        `Assets: ${tpl.assets.length ? tpl.assets.map((a) => a.symbol).join(', ') : 'ETH and WETH only'}`,
        `Share price: ${ethDisplay(mintPrice)} ETH, up to ${maxSupply} shares (cap ${ethDisplay(raiseCap)} ETH)`,
        `Raise lasts ${Number(duration) / 86_400} days. Entry fee ${Number(entryFeeBps) / 100}% plus 0.2% protocol fee.`,
        `Template rules: max position ${tpl.maxPositionBps / 100}%, max trade ${tpl.maxTradeBps / 100}%, performance fee ${tpl.performanceFeeBps / 100}%, drawdown brake ${tpl.drawdownBrakeBps ? tpl.drawdownBrakeBps / 100 + '%' : 'off'}.`,
        `Next step after creating: you, as manager, must mint ${skinShares} share${skinShares === 1n ? '' : 's'} (${ethDisplay(skinCost)} ETH) before anyone else can mint. Those shares are locked for ${Math.round(tpl.skinLockSeconds / 86_400)} days.`,
      ],
      fees: { entryFeeBps: Number(entryFeeBps), protocolFeeBps: 20 },
      risks: RISK_FUND,
    },
    extra: { template: templateView(tpl), managerSkin: { shares: skinShares.toString(), costWei: skinCost.toString(), costDisplay: `${ethDisplay(skinCost)} ETH` }, factory: { id: factory.id, label: factory.label } },
  });
  // The simulated return value is the new fund address. Surface it as a preview, not a promise.
  try {
    const raw = await ctx.client.call({ account: from, to: factory.factory, data });
    if (raw.data) {
      const fundAddr = decodeFunctionResult({ abi: createFundAbi, functionName: 'createFund', data: raw.data }) as Addr;
      (prepared as Record<string, unknown>).preview = { fundAddress: fundAddr, note: 'This address matches the real one only if this wallet sends this transaction next, at the same nonce.' };
    }
  } catch { /* preview is optional */ }
  return prepared;
}

// ---------------------------------------------------------------- prepare_fund_mint

export async function prepareFundMint(ctx: Ctx, rawInput: unknown, meta: Meta) {
  const input = bodyGuard(rawInput);
  const from = reqAddress(input, 'from');
  assertNotFeeWallet(from);
  const f = await findFund(ctx, String(input.fund ?? ''), { fresh: true });
  const now = ctx.nowSec();
  if (f.statusName !== 'raising' || f.deadline <= now) throw new ApiError(409, 'raise_closed', `${f.name} is not open for minting (status: ${f.statusName}).`);
  const qty = BigInt(optUint(input.quantity, 'quantity', 1, 1, 10_000));
  if (BigInt(f.maxSupply - f.minted) < qty) throw new ApiError(409, 'sold_out', `Only ${f.maxSupply - f.minted} shares are left.`);
  if (!f.publicOpen && f.manager !== from) {
    throw new ApiError(409, 'skin_required', `Public minting is not open yet. The manager has to mint ${f.skinRequired} shares (${f.managerMinted} so far).`, { sharesRequired: f.skinRequired, sharesMinted: f.managerMinted });
  }
  const cost = f.mintPriceWei * qty;
  guardAmountWei(cost, input, 'cost');
  const bal = await ctx.client.getBalance({ address: from });
  if (bal < cost) throw new ApiError(409, 'insufficient_balance', `The wallet holds ${ethDisplay(bal)} ETH, less than the ${ethDisplay(cost)} ETH cost.`);
  const entry = (cost * BigInt(f.entryFeeBps)) / BPS;
  const protocol = (cost * BigInt(f.protocolFeeBps)) / BPS;
  return finishPrepared(ctx, {
    action: 'fund-mint',
    signParams: { fund: f.address, q: qty.toString() },
    from, meta, allowTargets: [f.address],
    returnUrl: validReturnUrl(input.returnUrl),
    steps: [{ kind: 'fund_mint', description: 'Mint fund shares. The ETH goes into the fund vault in the same transaction.', to: f.address, data: encodeFunctionData({ abi: fundNftAbi, functionName: 'mint', args: [qty] }), value: cost, simulate: true }],
    summary: {
      headline: `Mint ${qty} share${qty === 1n ? '' : 's'} of ${f.name} for ${ethDisplay(cost)} ETH`,
      lines: [
        `Price per share: ${ethDisplay(f.mintPriceWei)} ETH`,
        `Fees taken from your ETH: entry ${ethDisplay(entry, 8)} ETH, protocol ${ethDisplay(protocol, 8)} ETH`,
        `You can exit after the raise closes for a pro-rata share of the vault. You can refund if the raise fails.`,
        `Raise ends ${new Date(f.deadline * 1000).toISOString()}.`,
      ],
      youPay: `${ethDisplay(cost)} ETH`,
      fees: { entryWei: entry.toString(), protocolWei: protocol.toString() },
      risks: RISK_FUND,
    },
    extra: { fund: fundView(f, now) },
  });
}

// ---------------------------------------------------------------- prepare_fund_redeem

export async function ownedFundIds(ctx: Ctx, fund: Addr, owner: Addr): Promise<bigint[]> {
  const balance = (await ctx.client.readContract({ address: fund, abi: fundNftAbi, functionName: 'balanceOf', args: [owner] }).catch(() => null)) as bigint | null;
  if (balance === 0n) return [];
  const verify = async (ids: bigint[]) => {
    const res = await ctx.client.multicall({ contracts: ids.map((id) => ({ address: fund, abi: fundNftAbi, functionName: 'ownerOf' as const, args: [id] as const })), allowFailure: true });
    return ids.filter((_, i) => res[i].status === 'success' && (res[i].result as Addr) === owner).sort((a, b) => (a < b ? -1 : 1));
  };
  // Share NFTs are not enumerable. Read Transfer logs to the wallet, then confirm each id with ownerOf.
  const transfer = fundNftAbi.find((x) => x.type === 'event' && x.name === 'Transfer')!;
  const logs = (await getLogsChunked(ctx, { address: fund, event: transfer, args: { to: owner }, fromBlock: CHAIN_FIRST_BLOCK }).catch(() => [])) as { args: { tokenId: bigint } }[];
  let owned = await verify([...new Set(logs.map((l) => l.args.tokenId.toString()))].map((s) => BigInt(s)));
  // If the logs were incomplete, fall back to checking every id up to totalMinted (bounded).
  if (balance !== null && BigInt(owned.length) < balance) {
    const total = Number((await ctx.client.readContract({ address: fund, abi: fundNftAbi, functionName: 'totalMinted' })) as bigint);
    if (total <= 5000) owned = await verify(Array.from({ length: total }, (_, i) => BigInt(i + 1)));
  }
  return owned;
}

const failRaiseAbi = parseAbi(['function failRaise()']);

export async function prepareFundRedeem(ctx: Ctx, rawInput: unknown, meta: Meta) {
  const input = bodyGuard(rawInput);
  const from = reqAddress(input, 'from');
  assertNotFeeWallet(from);
  const f = await findFund(ctx, String(input.fund ?? ''), { fresh: true });
  const lapsed = f.statusName === 'raising' && f.deadline <= ctx.nowSec() && f.vault !== null;
  if (f.statusName === 'raising' && !lapsed) throw new ApiError(409, 'raise_open', `${f.name} is still raising. Exit opens after the raise closes. A refund opens only if the raise fails.`);
  if (f.statusName === 'unknown') throw new ApiError(409, 'unsupported_fund', 'This fund type is not supported for prepared exits yet. Open the fund page.', { page: `${SITE_ORIGIN}/funds/${f.address}` });
  const owned = await ownedFundIds(ctx, f.address, from);
  if (!owned.length) throw new ApiError(409, 'no_shares', `This wallet holds no ${f.name} shares.`);

  let ids: bigint[];
  if (Array.isArray(input.ids) && input.ids.length) {
    ids = input.ids.slice(0, 200).map((x) => parseUnits10(x, 'ids'));
    const missing = ids.filter((i) => !owned.includes(i));
    if (missing.length) throw new ApiError(409, 'not_holder', `This wallet does not hold share(s): ${missing.slice(0, 5).join(', ')}.`);
  } else if (input.quantity !== undefined && input.quantity !== '') {
    const q = optUint(input.quantity, 'quantity', 1, 1, owned.length);
    ids = owned.slice(0, q);
  } else {
    ids = owned;
  }
  const mode = f.statusName === 'failed' || lapsed ? 'refund' : 'exit';
  const outstanding = BigInt(f.minted - f.burned);
  const spendable = f.vault ? ((await ctx.client.readContract({ address: f.vault, abi: [{ type: 'function', name: 'spendableEth', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const, functionName: 'spendableEth' }).catch(() => null)) as bigint | null) : null;
  const ethShare = spendable !== null && outstanding > 0n ? (spendable * BigInt(ids.length)) / outstanding : null;
  return finishPrepared(ctx, {
    action: 'fund-redeem',
    signParams: { fund: f.address, ids: ids.join(',') },
    from, meta, allowTargets: [f.address, ...(f.vault ? [f.vault] : [])],
    returnUrl: validReturnUrl(input.returnUrl),
    steps: [
      ...(lapsed ? [{ kind: 'fail_raise', description: 'The raise deadline passed before the raise closed. Anyone can mark the raise as failed so refunds open. This is step 1 of 2.', to: f.vault as Addr, data: encodeFunctionData({ abi: failRaiseAbi, functionName: 'failRaise' }), value: 0n, simulate: true }] : []),
      { kind: mode, description: mode === 'exit' ? 'Burn the shares and take a pro-rata share of the vault.' : 'Burn the shares of the failed raise and get your share of the ETH back.', to: f.address, data: encodeFunctionData({ abi: fundNftAbi, functionName: mode, args: [ids] }), value: 0n, simulate: !lapsed },
    ],
    summary: {
      headline: `${mode === 'exit' ? 'Exit' : 'Refund'} ${ids.length} share${ids.length === 1 ? '' : 's'} of ${f.name}`,
      lines: [
        ...(lapsed ? ['The raise passed its deadline without closing. Two transactions: one marks the raise failed, then one refunds your shares.'] : []),
        mode === 'exit' ? 'You receive a pro-rata share of the vault: spendable ETH plus a share of any other assets it holds.' : 'The raise failed. Each share gets its part of the spendable ETH. Entry and protocol fees are not returned.',
        ethShare !== null ? `Spendable ETH share right now: about ${ethDisplay(ethShare)} ETH. The final amount depends on the vault at execution.` : 'The vault amount could not be read.',
        `Shares: ${ids.slice(0, 12).join(', ')}${ids.length > 12 ? ', ...' : ''}`,
      ],
      youReceiveAtLeast: undefined,
      risks: RISK_FUND,
    },
    extra: { fund: fundView(f, ctx.nowSec()), mode },
  });
}

