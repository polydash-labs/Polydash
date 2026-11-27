'use client';

import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import type { PublicClient } from 'viem';
import { FundFactoryABI, FundNFTABI, FundVaultABI } from '@/lib/contracts/fund-abi';
import { getFundInvestFactoryAddress } from '@/lib/fund/address';
import { fundStatus, type FundStatus } from '@/lib/fund/model';
import { readInvest } from '@/lib/fund/read-invest';
import { fetchFundsListWire } from '@/lib/fund/use-phase3';
import { fundSummaryFromWire, type FundsListWire } from '@/lib/fund/list-wire';
import type { FundInvestView } from '@/lib/fund/invest';
import { robinhoodChain } from '@/lib/chain';

const NFT_FIELDS = [
  'name', 'symbol', 'imageUri', 'manager', 'vault', 'mintPrice', 'maxSupply',
  'totalMinted', 'managerMinted', 'publicOpen', 'entryFeeBps', 'skinRequired', 'minSkinBps',
] as const;

const VAULT_FIELDS = ['raiseCap', 'raised', 'status', 'raiseDeadline'] as const;

export type FundSummary = {
  address: `0x${string}`;
  index: number;
  name: string;
  symbol: string;
  imageUri: string;
  manager: `0x${string}`;
  vault: `0x${string}`;
  mintPrice: bigint;
  maxSupply: bigint;
  totalMinted: bigint;
  managerMinted: bigint;
  publicOpen: boolean;
  entryFeeBps: number;
  skinRequired: bigint;
  minSkinBps: number;
  raiseCap: bigint;
  raised: bigint;
  vaultStatus: number;
  raiseDeadline: number;
  status: FundStatus;
  balance: bigint;
  generation: 1 | 2;
};

export type FundDetail = FundSummary & {
  navPerNft: bigint;
  vaultEth: bigint;
  invest: FundInvestView | null;
};

type CallResult = { status: string; result?: unknown };

function readField<T>(row: CallResult | undefined, fallback: T): T {
  return row?.status === 'success' && row.result !== undefined ? (row.result as T) : fallback;
}

async function readFund(
  client: PublicClient,
  address: `0x${string}`,
  index: number,
  account?: `0x${string}`,
  generation: 1 | 2 = 1,
): Promise<FundSummary | null> {
  const nftRes = await client.multicall({
    contracts: NFT_FIELDS.map((functionName) => ({ address, abi: FundNFTABI, functionName })),
    allowFailure: true,
  });
  const name = readField(nftRes[0], '');
  const manager = readField<`0x${string}` | undefined>(nftRes[3], undefined);
  const vault = readField<`0x${string}` | undefined>(nftRes[4], undefined);
  if (!manager || !vault || vault === '0x0000000000000000000000000000000000000000') return null;

  const vaultRes = await client.multicall({
    contracts: VAULT_FIELDS.map((functionName) => ({ address: vault, abi: FundVaultABI, functionName })),
    allowFailure: true,
  });
  const publicOpen = readField(nftRes[9], false);
  const vaultStatus = Number(readField(vaultRes[2], 0));
  const raiseDeadline = Number(readField(vaultRes[3], 0n));
  let balance = 0n;
  if (account) {
    try {
      balance = await client.readContract({
        address,
        abi: FundNFTABI,
        functionName: 'balanceOf',
        args: [account],
      });
    } catch {
      balance = 0n;
    }
  }
  return {
    address,
    index,
    name: name || 'Fund',
    symbol: readField(nftRes[1], ''),
    imageUri: readField(nftRes[2], ''),
    manager,
    vault,
    mintPrice: readField(nftRes[5], 0n),
    maxSupply: readField(nftRes[6], 0n),
    totalMinted: readField(nftRes[7], 0n),
    managerMinted: readField(nftRes[8], 0n),
    publicOpen,
    entryFeeBps: Number(readField(nftRes[10], 0n)),
    skinRequired: readField(nftRes[11], 0n),
    minSkinBps: Number(readField(nftRes[12], 0n)),
    raiseCap: readField(vaultRes[0], 0n),
    raised: readField(vaultRes[1], 0n),
    vaultStatus,
    raiseDeadline,
    status: fundStatus(vaultStatus, publicOpen),
    balance,
    generation,
  };
}

async function listFunds(client: PublicClient, factory: `0x${string}`, generation: 1 | 2): Promise<FundSummary[]> {
  const length = await client.readContract({
    address: factory,
    abi: FundFactoryABI,
    functionName: 'allFundsLength',
  });
  const count = Number(length);
  if (!Number.isFinite(count) || count <= 0) return [];
  const addrRes = await client.multicall({
    contracts: Array.from({ length: count }, (_, index) => ({
      address: factory,
      abi: FundFactoryABI,
      functionName: 'allFunds' as const,
      args: [BigInt(index)] as const,
    })),
    allowFailure: true,
  });
  const found: { address: `0x${string}`; index: number }[] = [];
  addrRes.forEach((row, index) => {
    if (row.status === 'success' && typeof row.result === 'string') {
      found.push({ address: row.result, index });
    }
  });
  const funds = await Promise.all(found.map((item) => readFund(client, item.address, item.index, undefined, generation)));
  return funds.filter((fund): fund is FundSummary => fund !== null);
}

/** Funds created through the invest factory (Phase 2) only. The Phase 1 factory is never read. */
export function useFunds(initialWire?: FundsListWire) {
  const investFactory = getFundInvestFactoryAddress();
  return useQuery({
    queryKey: ['funds', investFactory ?? ''],
    refetchInterval: 20_000,
    // The list used to read the chain directly from the browser and the
    // official RPC rejected it in the first-load storm, so the /funds lists
    // sat on "Loading tokenized funds…" for 20+s (round 4). The read now
    // runs once on the server behind /api/funds/list (cached 30s); retry
    // with backoff inside the loading state, and keep the last good list
    // when a background refetch fails (same pattern as useV3Funds). Pass
    // the server-read list (from the /funds page's first-paint read) and
    // the directory renders with real figures on first paint instead of
    // the skeleton; the 30s staleTime avoids a redundant refetch the
    // moment the page mounts.
    retry: 5,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    placeholderData: (prev) => prev,
    initialData: !investFactory ? [] : initialWire ? initialWire.legacy.map(fundSummaryFromWire) : undefined,
    staleTime: initialWire ? 30_000 : undefined,
    queryFn: async () => {
      if (!investFactory) return [];
      const wire = await fetchFundsListWire();
      return wire.legacy.map(fundSummaryFromWire);
    },
  });
}

export function useFund(address: string, account?: `0x${string}`) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const investFactory = getFundInvestFactoryAddress();
  const valid = /^0x[0-9a-fA-F]{40}$/.test(address);
  return useQuery({
    queryKey: ['fund', investFactory ?? '', address.toLowerCase(), account ?? ''],
    enabled: !!client && valid,
    refetchInterval: 15_000,
    // A slow first-paint chain read must not flash the error state ("Could
    // not load this tokenized fund right now"): the single RPC times out at
    // 10s under concurrent load, so retry with backoff inside the loading
    // state, and keep the last good fund when a background refetch fails
    // (same pattern as useV2Funds).
    retry: 5,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<FundDetail | null> => {
      if (!client || !investFactory) return null;
      const fundAddress = address as `0x${string}`;
      const generation: 1 | 2 = 2;
      const listed = await client.readContract({
        address: investFactory,
        abi: FundFactoryABI,
        functionName: 'isFund',
        args: [fundAddress],
      });
      if (!listed) return null;
      const summary = await readFund(client, fundAddress, 0, account, generation);
      if (!summary) return null;
      const vaultEth = await client.getBalance({ address: summary.vault }).catch(() => 0n);
      let navPerNft = 0n;
      try {
        navPerNft = await client.readContract({
          address: fundAddress,
          abi: FundNFTABI,
          functionName: 'navPerNft',
        });
      } catch {
        navPerNft = 0n;
      }
      const invest = await readInvest(client, summary.vault, vaultEth, account).catch(() => null);
      return { ...summary, navPerNft: invest?.navPerNft ?? navPerNft, vaultEth, invest };
    },
  });
}
