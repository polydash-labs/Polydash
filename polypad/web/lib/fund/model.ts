import { formatEther, keccak256, parseEther, toHex } from 'viem';

/** Bounds copied from FundFactory. Integer math matches the contract. */
export const BPS = 10_000n;
export const PROTOCOL_FEE_BPS = 20n;
export const MAX_ENTRY_FEE_BPS = 500n;
export const DEFAULT_MIN_SKIN_BPS = 500n;
export const MAX_SUPPLY = 10_000n;
export const MIN_MINT_PRICE = 10_000_000_000_000n;
export const MAX_MINT_PRICE = 100n * 10n ** 18n;
export const MAX_NAME_BYTES = 64;
export const MAX_SYMBOL_BYTES = 16;
export const MAX_URI_BYTES = 512;
/** Phase 2 mandate + swap policy bounds. Caps match FundVaultStore defaults. */
export const MIN_RAISE_DURATION_DAYS = 1;
export const MAX_RAISE_DURATION_DAYS = 30;
export const DEFAULT_RAISE_DURATION_DAYS = 7;
export const MAX_MANDATE_TEXT_CHARS = 2000;
export const MAX_ASSETS = 16;
export const DEFAULT_MAX_POSITION_BPS = 7500;
export const DEFAULT_MAX_TRADE_BPS = 7500;
export const DEFAULT_MAX_DEVIATION_BPS = 5000;

export type FundKind = 'raise' | 'invest';

export type FundStatus = 'waiting' | 'open' | 'closed' | 'investing';

export const FUND_STATUS_LABEL: Record<FundStatus, string> = {
  waiting: 'Waiting on manager',
  open: 'Open for minting',
  closed: 'Closed',
  investing: 'Investing',
};

export type FundFilter = 'all' | 'open' | 'waiting' | 'closed' | 'investing' | 'mine';
export type FundSort = 'newest' | 'raised';

export type FundDraft = {
  name: string;
  symbol: string;
  imageUri: string;
  baseUri: string;
  mintPriceEth: string;
  raiseCapEth: string;
  entryFeeBps: number;
  /** 500 is the 5% default. The factory is sent 0 so it applies that default. */
  skinBps: number;
  /** 'raise' targets the Phase 1 factory (raise only). 'invest' targets FundFactoryInvest. */
  fundKind: FundKind;
  /** Phase 2 only: the mandate text the manager publishes. The hash is keccak256 of this text. */
  mandateText: string;
  /** Phase 2 only: where the mandate text lives (ipfs:// or https://). Stored on the vault. */
  mandateUri: string;
  /** Phase 2 only: raise length in whole days, 1–30. */
  raiseDurationDays: string;
  /** Phase 2 only: one allowlisted asset address per line. Empty means WETH-only. */
  assetsText: string;
  /** Phase 2 only: swap caps in BPS of NAV. 7500 / 7500 / 5000 are the contract defaults. */
  maxPositionBps: number;
  maxTradeBps: number;
  maxDeviationBps: number;
};

export const DEFAULT_FUND_DRAFT: FundDraft = {
  name: '',
  symbol: '',
  imageUri: '',
  baseUri: '',
  mintPriceEth: '0.01',
  raiseCapEth: '1',
  entryFeeBps: 0,
  skinBps: 500,
  fundKind: 'raise',
  mandateText: '',
  mandateUri: '',
  raiseDurationDays: String(DEFAULT_RAISE_DURATION_DAYS),
  assetsText: '',
  maxPositionBps: DEFAULT_MAX_POSITION_BPS,
  maxTradeBps: DEFAULT_MAX_TRADE_BPS,
  maxDeviationBps: DEFAULT_MAX_DEVIATION_BPS,
};

export type FundField =
  | 'name'
  | 'symbol'
  | 'imageUri'
  | 'baseUri'
  | 'mintPriceEth'
  | 'raiseCapEth'
  | 'entryFeeBps'
  | 'skinBps'
  | 'mandateText'
  | 'mandateUri'
  | 'raiseDurationDays'
  | 'assetsText'
  | 'maxPositionBps'
  | 'maxTradeBps'
  | 'maxDeviationBps';

export type FundIssue = { field: FundField; message: string };

export type RaisePreview = {
  mintPrice: bigint;
  raiseCap: bigint;
  maxSupply: bigint;
  dust: bigint;
  effectiveRaise: bigint;
  skinBps: bigint;
  skinRequired: bigint;
  managerEth: bigint;
  protocolFeeOnManagerMint: bigint;
  protocolFeeOnFullRaise: bigint;
  entryFeeOnManagerMint: bigint;
  entryFeeOnFullRaise: bigint;
};

export type FundCreateParams = RaisePreview & {
  name: string;
  symbol: string;
  imageUri: string;
  baseURI: string;
  entryFeeBps: bigint;
  /** Value passed to createFund. 0 selects the factory's 5% default. */
  minSkinBps: bigint;
  /** Phase 2 only. Present when the draft targets FundFactoryInvest. */
  mandateHash?: `0x${string}`;
  mandateUri?: string;
  /** Phase 2 only: raise length in seconds. */
  raiseDuration?: bigint;
  /** Phase 2 only: the per-fund universe. Empty means WETH-only. */
  assets?: `0x${string}`[];
  maxPositionBps?: bigint;
  maxTradeBps?: bigint;
  maxDeviationBps?: bigint;
};

/** Parse the wizard's asset list: one address per line, unique, at most 16. */
export function parseAssetList(raw: string): { ok: true; assets: `0x${string}`[] } | { ok: false; message: string } {
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length > MAX_ASSETS) return { ok: false, message: `At most ${MAX_ASSETS} assets.` };
  const seen = new Set<string>();
  const assets: `0x${string}`[] = [];
  for (const line of lines) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(line)) return { ok: false, message: `"${line}" is not an address.` };
    const lower = line.toLowerCase();
    if (seen.has(lower)) return { ok: false, message: 'Each asset can appear only once.' };
    seen.add(lower);
    assets.push(line as `0x${string}`);
  }
  return { ok: true, assets };
}

/** keccak256 of the mandate text's UTF-8 bytes, matching what the vault stores. */
export function mandateHashFor(text: string): `0x${string}` {
  return keccak256(toHex(text));
}

export function utf8Size(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function fundStatus(vaultStatus: number, publicOpen: boolean): FundStatus {
  if (vaultStatus === 2) return 'investing';
  if (vaultStatus !== 0) return 'closed';
  if (!publicOpen) return 'waiting';
  return 'open';
}

export function bpsLabel(bps: number): string {
  if (!Number.isFinite(bps)) return '0%';
  const text = (bps / 100).toFixed(2).replace(/\.?0+$/, '');
  return `${text}%`;
}

export function formatFundEth(wei: bigint): string {
  if (wei === 0n) return '0';
  const raw = formatEther(wei);
  const [whole, frac = ''] = raw.split('.');
  const trimmed = frac.replace(/0+$/, '');
  const shown = trimmed.length > 8 ? `${trimmed.slice(0, 8)}…` : trimmed;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return shown ? `${grouped}.${shown}` : grouped;
}

export function parseEthInput(raw: string): { ok: true; wei: bigint } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, message: 'Enter an amount in ETH.' };
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return { ok: false, message: 'Use a plain ETH amount, like 0.01.' };
  const frac = trimmed.split('.')[1] ?? '';
  if (frac.length > 18) return { ok: false, message: 'ETH amounts support up to 18 decimal places.' };
  try {
    return { ok: true, wei: parseEther(trimmed) };
  } catch {
    return { ok: false, message: 'That ETH amount is not valid.' };
  }
}

export function previewSupply(raiseCap: bigint, mintPrice: bigint): { maxSupply: bigint; dust: bigint } {
  if (mintPrice === 0n) throw new Error('mint price is zero');
  return { maxSupply: raiseCap / mintPrice, dust: raiseCap % mintPrice };
}

export function resolveSkinBps(minSkinBps: bigint): bigint {
  return minSkinBps === 0n ? DEFAULT_MIN_SKIN_BPS : minSkinBps;
}

/** ceil(maxSupply * skinBps / 10_000), matching FundFactory. */
export function skinRequiredCount(maxSupply: bigint, minSkinBps: bigint): bigint {
  const skinBps = resolveSkinBps(minSkinBps);
  return (maxSupply * skinBps + BPS - 1n) / BPS;
}

export function feeOn(amount: bigint, bps: bigint): bigint {
  return (amount * bps) / BPS;
}

/** 0 and 500 both mean "use the factory default". Other integers are sent through. */
export function minSkinBpsForDraft(skinBps: number): bigint {
  if (!Number.isInteger(skinBps) || skinBps < 0) return 0n;
  if (skinBps === 0 || skinBps === Number(DEFAULT_MIN_SKIN_BPS)) return 0n;
  return BigInt(skinBps);
}

export function quoteMint(mintPrice: bigint, qty: bigint, entryFeeBps: bigint) {
  const cost = mintPrice * qty;
  const protocolFee = feeOn(cost, PROTOCOL_FEE_BPS);
  const entryFee = feeOn(cost, entryFeeBps);
  const staysInVault = cost - protocolFee - entryFee;
  return {
    cost,
    protocolFee,
    entryFee,
    staysInVault,
    // A failed Phase 2 raise can return this amount. It is not the mint price. Fees are withheld.
    failedRaiseRefund: staysInVault,
  };
}

export function issueFor(issues: FundIssue[], field: FundField): string | undefined {
  return issues.find((issue) => issue.field === field)?.message;
}

export function previewDraft(draft: FundDraft): { issues: FundIssue[]; preview: RaisePreview | null; params: FundCreateParams | null } {
  const issues: FundIssue[] = [];
  const name = draft.name.trim();
  const symbol = draft.symbol.trim();
  const imageUri = draft.imageUri.trim();
  const baseURI = draft.baseUri.trim();

  if (!name) issues.push({ field: 'name', message: 'Give the fund a name.' });
  else if (utf8Size(name) > MAX_NAME_BYTES) {
    issues.push({ field: 'name', message: 'Name must be 64 bytes or fewer. Emoji and some accents count as more than one.' });
  }
  if (!symbol) issues.push({ field: 'symbol', message: 'Add a short ticker.' });
  else if (utf8Size(symbol) > MAX_SYMBOL_BYTES) {
    issues.push({ field: 'symbol', message: 'Ticker must be 16 bytes or fewer.' });
  }
  if (utf8Size(imageUri) > MAX_URI_BYTES) {
    issues.push({ field: 'imageUri', message: 'Image link must be 512 bytes or fewer.' });
  }
  if (utf8Size(baseURI) > MAX_URI_BYTES) {
    issues.push({ field: 'baseUri', message: 'Metadata link must be 512 bytes or fewer.' });
  }

  const price = parseEthInput(draft.mintPriceEth);
  const cap = parseEthInput(draft.raiseCapEth);
  if (!price.ok) issues.push({ field: 'mintPriceEth', message: price.message });
  else if (price.wei < MIN_MINT_PRICE) issues.push({ field: 'mintPriceEth', message: 'Mint price must be at least 0.00001 ETH.' });
  else if (price.wei > MAX_MINT_PRICE) issues.push({ field: 'mintPriceEth', message: 'Mint price must be 100 ETH or less.' });
  if (!cap.ok) issues.push({ field: 'raiseCapEth', message: cap.message });

  if (!Number.isInteger(draft.entryFeeBps) || draft.entryFeeBps < 0 || draft.entryFeeBps > Number(MAX_ENTRY_FEE_BPS)) {
    issues.push({ field: 'entryFeeBps', message: 'Entry fee must be between 0% and 5%.' });
  }
  const skinOk = draft.skinBps === 0 || (Number.isInteger(draft.skinBps) && draft.skinBps >= Number(DEFAULT_MIN_SKIN_BPS) && draft.skinBps <= Number(BPS));
  if (!skinOk) issues.push({ field: 'skinBps', message: 'Manager share must be from 5% to 100%.' });

  // Phase 2 only. A raise-only draft skips the mandate entirely.
  let invest: {
    mandateHash: `0x${string}`;
    mandateUri: string;
    raiseDuration: bigint;
    assets: `0x${string}`[];
    maxPositionBps: bigint;
    maxTradeBps: bigint;
    maxDeviationBps: bigint;
  } | null = null;
  if (draft.fundKind === 'invest') {
    const mandateText = draft.mandateText.trim();
    if (!mandateText) issues.push({ field: 'mandateText', message: 'Write the mandate: what this fund may buy, and the limits.' });
    else if (mandateText.length > MAX_MANDATE_TEXT_CHARS) {
      issues.push({ field: 'mandateText', message: `Mandate must be ${MAX_MANDATE_TEXT_CHARS} characters or fewer.` });
    }
    const mandateUri = draft.mandateUri.trim();
    if (!mandateUri) issues.push({ field: 'mandateUri', message: 'Add a link to the mandate text, so LPs can read what the hash commits to.' });
    else if (!mandateUri.startsWith('ipfs://') && !mandateUri.startsWith('https://')) {
      issues.push({ field: 'mandateUri', message: 'Mandate link must start with ipfs:// or https://.' });
    } else if (utf8Size(mandateUri) > MAX_URI_BYTES) {
      issues.push({ field: 'mandateUri', message: 'Mandate link must be 512 bytes or fewer.' });
    }
    const days = Number(draft.raiseDurationDays);
    if (!Number.isInteger(days) || days < MIN_RAISE_DURATION_DAYS || days > MAX_RAISE_DURATION_DAYS) {
      issues.push({ field: 'raiseDurationDays', message: `Raise must run ${MIN_RAISE_DURATION_DAYS} to ${MAX_RAISE_DURATION_DAYS} days.` });
    }
    const parsedAssets = parseAssetList(draft.assetsText);
    if (!parsedAssets.ok) issues.push({ field: 'assetsText', message: parsedAssets.message });
    for (const [field, value] of [['maxPositionBps', draft.maxPositionBps], ['maxTradeBps', draft.maxTradeBps], ['maxDeviationBps', draft.maxDeviationBps]] as const) {
      if (!Number.isInteger(value) || value < 1 || value > 10_000) {
        issues.push({ field, message: 'Cap must be from 1 to 10,000 BPS (0.01% to 100% of NAV).' });
      }
    }
    if (issues.length === 0 && mandateText && parsedAssets.ok && Number.isInteger(days)) {
      invest = {
        mandateHash: mandateHashFor(mandateText),
        mandateUri,
        raiseDuration: BigInt(days) * 86_400n,
        assets: parsedAssets.assets,
        maxPositionBps: BigInt(draft.maxPositionBps),
        maxTradeBps: BigInt(draft.maxTradeBps),
        maxDeviationBps: BigInt(draft.maxDeviationBps),
      };
    }
  }

  let preview: RaisePreview | null = null;
  if (price.ok && cap.ok && price.wei > 0n) {
    const { maxSupply, dust } = previewSupply(cap.wei, price.wei);
    if (maxSupply === 0n) {
      issues.push({ field: 'raiseCapEth', message: 'Raise goal must cover at least one NFT at this price.' });
    } else if (maxSupply > MAX_SUPPLY) {
      issues.push({ field: 'raiseCapEth', message: 'That price and goal would create more than 10,000 NFTs. Raise the price or lower the goal.' });
    }
    const minSkinBps = minSkinBpsForDraft(draft.skinBps);
    const skinBps = resolveSkinBps(minSkinBps);
    const skinRequired = maxSupply === 0n ? 0n : skinRequiredCount(maxSupply, minSkinBps);
    if (maxSupply > 0n && (skinRequired === 0n || skinRequired > maxSupply)) {
      issues.push({ field: 'skinBps', message: 'Manager share must be at least 1 NFT and cannot exceed the total.' });
    }
    const entryFeeBps = BigInt(Math.max(0, draft.entryFeeBps || 0));
    const managerEth = skinRequired * price.wei;
    const effectiveRaise = maxSupply * price.wei;
    preview = {
      mintPrice: price.wei,
      raiseCap: cap.wei,
      maxSupply,
      dust,
      effectiveRaise,
      skinBps,
      skinRequired,
      managerEth,
      protocolFeeOnManagerMint: feeOn(managerEth, PROTOCOL_FEE_BPS),
      protocolFeeOnFullRaise: feeOn(effectiveRaise, PROTOCOL_FEE_BPS),
      entryFeeOnManagerMint: feeOn(managerEth, entryFeeBps),
      entryFeeOnFullRaise: feeOn(effectiveRaise, entryFeeBps),
    };
  }

  if (issues.length || !preview) return { issues, preview, params: null };
  const minSkinBps = minSkinBpsForDraft(draft.skinBps);
  return {
    issues,
    preview,
    params: {
      ...preview,
      name,
      symbol,
      imageUri,
      baseURI,
      entryFeeBps: BigInt(draft.entryFeeBps),
      minSkinBps,
      ...(invest ? { ...invest } : {}),
    },
  };
}

export function fundTxError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('user rejected') || m.includes('user denied') || m.includes('denied transaction') || m.includes('rejected the request')) {
    return 'Transaction cancelled';
  }
  if (m.includes('skinrequired')) return 'The manager has to mint their share before anyone else can.';
  if (m.includes('soldout')) return 'Not enough NFTs are left at that quantity.';
  if (m.includes('notraising')) return 'This raise is closed.';
  if (m.includes('notallowlisted') || m.includes('notinmandate')) return 'That asset or router is not on the allowlist.';
  if (m.includes('slippage')) return 'The vault would receive less than the minimum you set.';
  if (m.includes('notinvesting')) return 'Investing is not open on this fund.';
  if (m.includes('notauthorized')) return 'Only the manager or an authorized wallet can do that.';
  if (m.includes('notclosed')) return 'The raise is still open.';
  if (m.includes('paused')) return 'Swaps are paused.';
  if (m.includes('positioncap')) return 'That swap would leave more than the fund’s single-asset cap in one asset.';
  if (m.includes('tradecap')) return 'That swap is larger than the fund’s per-trade cap.';
  if (m.includes('deviation')) return 'That swap executes too far from the feed price.';
  if (m.includes('toosoon')) return 'The next NAV checkpoint is not due yet. Checkpoints run once an hour.';
  if (m.includes('raiseended')) return 'The raise deadline has passed.';
  if (m.includes('baduri')) return 'The mandate link is missing or too long.';
  if (m.includes('badvalue')) return 'The ETH amount does not match the mint price.';
  if (m.includes('badquantity')) return 'Enter at least 1 NFT.';
  if (m.includes('invalidparams')) return 'Those settings are outside the allowed limits.';
  if (!message || message.length > 180) return 'Transaction failed.';
  return message;
}

export type FundListItem = {
  address: string;
  index: number;
  name: string;
  symbol: string;
  manager: string;
  status: FundStatus;
  raised: bigint;
  generation?: number;
};

export function filterFunds<T extends FundListItem>(
  items: T[],
  filter: FundFilter,
  query: string,
  account?: string | null,
): T[] {
  const q = query.trim().toLowerCase();
  return items.filter((item) => {
    if (filter === 'open' && item.status !== 'open') return false;
    if (filter === 'waiting' && item.status !== 'waiting') return false;
    if (filter === 'closed' && item.status !== 'closed') return false;
    if (filter === 'investing' && item.status !== 'investing') return false;
    if (filter === 'mine') {
      if (!account) return false;
      if (item.manager.toLowerCase() !== account.toLowerCase()) return false;
    }
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) ||
      item.symbol.toLowerCase().includes(q) ||
      item.address.toLowerCase().includes(q)
    );
  });
}

export function sortFunds<T extends FundListItem>(items: T[], sort: FundSort): T[] {
  const copy = [...items];
  if (sort === 'raised') {
    copy.sort((a, b) => (a.raised === b.raised ? b.index - a.index : a.raised > b.raised ? -1 : 1));
    return copy;
  }
  copy.sort((a, b) => {
    const generation = (b.generation ?? 1) - (a.generation ?? 1);
    if (generation !== 0) return generation;
    return b.index - a.index;
  });
  return copy;
}

export function ratioPercent(part: bigint, whole: bigint): number {
  if (whole <= 0n || part <= 0n) return 0;
  const bps = (part * 10_000n) / whole;
  const capped = bps > 10_000n ? 10_000n : bps;
  return Number(capped) / 100;
}
