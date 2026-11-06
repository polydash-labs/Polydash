import type { PublicClient } from 'viem';
import { FundAllowlistABI, FundErc20ABI, FundVaultInvestABI } from '@/lib/contracts/fund-abi';
import { ZERO_ADDRESS, type BlotterRow, type FundInvestView, type HoldingRow } from '@/lib/fund/invest';

const HEAD = [
  'mandateHash',
  'universeHash',
  'weth',
  'allowlist',
  'nav',
  'navPerNft',
  'spendableEth',
  'claimableFees',
  'swapsPaused',
  'investBlock',
  'mandateAssetCount',
  'tradeCount',
  'protectionBits',
] as const;

type CallResult = { status: string; result?: unknown };

function ok<T>(row: CallResult | undefined, fallback: T): T {
  return row?.status === 'success' && row.result !== undefined ? (row.result as T) : fallback;
}

function asAddress(value: unknown): `0x${string}` | null {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) ? value as `0x${string}` : null;
}

function asBigint(value: unknown, fallback = 0n): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
  return fallback;
}

function bitsOf(value: unknown): number {
  if (typeof value === 'bigint' || typeof value === 'number') return Number(value);
  if (Array.isArray(value)) return Number(value[0] ?? 0);
  if (value && typeof value === 'object' && 'bits' in value) return Number((value as { bits: bigint | number }).bits);
  return 0;
}

function tradeOf(value: unknown): BlotterRow | null {
  const row = Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : null;
  if (!row || row.length < 6) return null;
  const asset = asAddress(row[0]);
  if (!asset) return null;
  return {
    asset,
    side: Number(row[1] ?? 0),
    timestamp: Number(row[2] ?? 0),
    size: asBigint(row[3]),
    price: asBigint(row[4]),
    navAfter: asBigint(row[5]),
  };
}

async function readToken(client: PublicClient, asset: `0x${string}`, vault: `0x${string}`): Promise<{ symbol: string; decimals: number; balance: bigint }> {
  const res = await client.multicall({
    contracts: [
      { address: asset, abi: FundErc20ABI, functionName: 'symbol' },
      { address: asset, abi: FundErc20ABI, functionName: 'decimals' },
      { address: asset, abi: FundErc20ABI, functionName: 'balanceOf', args: [vault] },
    ],
    allowFailure: true,
  });
  const symbol = res[0]?.status === 'success' && typeof res[0].result === 'string' && res[0].result ? res[0].result : `${asset.slice(0, 6)}…${asset.slice(-4)}`;
  const decimalsRaw = res[1]?.status === 'success' ? Number(res[1].result) : 18;
  const decimals = Number.isInteger(decimalsRaw) && decimalsRaw >= 0 && decimalsRaw <= 36 ? decimalsRaw : 18;
  const balance = res[2]?.status === 'success' ? asBigint(res[2].result) : 0n;
  return { symbol, decimals, balance };
}

/** Phase 2 vault views. Returns null when the vault is a Phase 1 raise vault. */
export async function readInvest(
  client: PublicClient,
  vault: `0x${string}`,
  vaultEth: bigint,
  account?: `0x${string}`,
): Promise<FundInvestView | null> {
  const head = await client.multicall({
    contracts: HEAD.map((functionName) => ({ address: vault, abi: FundVaultInvestABI, functionName })),
    allowFailure: true,
  });
  const mandateHash = ok<`0x${string}` | undefined>(head[0], undefined);
  const weth = asAddress(head[2]?.status === 'success' ? head[2].result : undefined);
  const allowlist = asAddress(head[3]?.status === 'success' ? head[3].result : undefined);
  if (!mandateHash || mandateHash === `0x${'0'.repeat(64)}` || !weth || !allowlist) return null;

  const assetCount = Number(ok(head[10], 0n));
  const tradeCount = Number(ok(head[11], 0n));
  const assetN = Number.isFinite(assetCount) ? Math.min(Math.max(assetCount, 0), 16) : 0;
  const tradeN = Number.isFinite(tradeCount) ? Math.min(Math.max(tradeCount, 0), 32) : 0;

  const [listRes, allowRes] = await Promise.all([
    client.multicall({
      contracts: [
        ...Array.from({ length: assetN }, (_, index) => ({
          address: vault,
          abi: FundVaultInvestABI,
          functionName: 'mandateAssets' as const,
          args: [BigInt(index)] as const,
        })),
        ...Array.from({ length: tradeN }, (_, index) => ({
          address: vault,
          abi: FundVaultInvestABI,
          functionName: 'blotter' as const,
          args: [BigInt(index)] as const,
        })),
        ...(account ? [{ address: vault, abi: FundVaultInvestABI, functionName: 'isExecutor' as const, args: [account] as const }] : []),
      ],
      allowFailure: true,
    }),
    client.multicall({
      contracts: [
        { address: allowlist, abi: FundAllowlistABI, functionName: 'paused' as const },
        { address: allowlist, abi: FundAllowlistABI, functionName: 'delay' as const },
        { address: allowlist, abi: FundAllowlistABI, functionName: 'routerCount' as const },
      ],
      allowFailure: true,
    }),
  ]);

  const assets: `0x${string}`[] = [];
  for (let i = 0; i < assetN; i += 1) {
    const asset = asAddress(listRes[i]?.status === 'success' ? listRes[i].result : undefined);
    if (asset) assets.push(asset);
  }
  const trades: BlotterRow[] = [];
  for (let i = 0; i < tradeN; i += 1) {
    const row = listRes[assetN + i];
    if (row?.status !== 'success') continue;
    const trade = tradeOf(row.result);
    if (trade) trades.push(trade);
  }
  const isExecutor = account ? listRes[assetN + tradeN]?.status === 'success' && listRes[assetN + tradeN]?.result === true : false;

  const routerCount = Number(ok(allowRes[2], 0n));
  const routerN = Number.isFinite(routerCount) ? Math.min(Math.max(routerCount, 0), 24) : 0;
  const routerRows = routerN === 0 ? [] : await client.multicall({
    contracts: Array.from({ length: routerN }, (_, index) => ({
      address: allowlist,
      abi: FundAllowlistABI,
      functionName: 'routers' as const,
      args: [BigInt(index)] as const,
    })),
    allowFailure: true,
  });
  const routerAddresses = routerRows.flatMap((row) => {
    const router = asAddress(row.status === 'success' ? row.result : undefined);
    return router ? [router] : [];
  });
  const allowedRows = routerAddresses.length === 0 ? [] : await client.multicall({
    contracts: routerAddresses.map((router) => ({
      address: allowlist,
      abi: FundAllowlistABI,
      functionName: 'routerAllowed' as const,
      args: [router] as const,
    })),
    allowFailure: true,
  });
  const routers = routerAddresses.filter((_, index) => allowedRows[index]?.status === 'success' && allowedRows[index]?.result === true);

  const wethToken = await readToken(client, weth, vault);
  const assetTokens = await Promise.all(assets.map(async (asset) => {
    const token = await readToken(client, asset, vault);
    const costRes = await client.readContract({
      address: vault,
      abi: FundVaultInvestABI,
      functionName: 'costBasis',
      args: [asset],
    }).catch(() => 0n);
    return { asset, ...token, cost: asBigint(costRes), kind: 'asset' as const };
  }));

  const holdings: HoldingRow[] = [
    { asset: ZERO_ADDRESS, symbol: 'ETH', decimals: 18, balance: vaultEth, cost: 0n, kind: 'eth' },
    { asset: weth, symbol: wethToken.symbol || 'WETH', decimals: wethToken.decimals, balance: wethToken.balance, cost: 0n, kind: 'weth' },
    ...assetTokens,
  ];

  return {
    mandateHash,
    universeHash: ok(head[1], `0x${'0'.repeat(64)}` as `0x${string}`),
    weth,
    allowlist,
    nav: ok(head[4], 0n),
    navPerNft: ok(head[5], 0n),
    spendableEth: ok(head[6], 0n),
    claimableFees: ok(head[7], 0n),
    swapsPaused: ok(head[8], false),
    allowlistPaused: ok(allowRes[0], false),
    timelockDelay: ok(allowRes[1], 0n),
    investBlock: ok(head[9], 0n),
    assets,
    holdings,
    routers,
    trades,
    protectionBits: bitsOf(head[12]?.status === 'success' ? head[12].result : 0),
    isExecutor,
  };
}
