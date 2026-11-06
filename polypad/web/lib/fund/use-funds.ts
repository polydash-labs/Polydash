'use client';

import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import type { PublicClient } from 'viem';
import { FundFactoryABI, FundNFTABI, FundVaultABI } from '@/lib/contracts/fund-abi';
import { getFundFactoryAddress } from '@/lib/fund/address';
import { fundStatus, type FundStatus } from '@/lib/fund/model';
import { robinhoodChain } from '@/lib/chain';

const NFT_FIELDS = [
  'name', 'symbol', 'imageUri', 'manager', 'vault', 'mintPrice', 'maxSupply',
  'totalMinted', 'managerMinted', 'publicOpen', 'entryFeeBps', 'skinRequired', 'minSkinBps',
] as const;

const VAULT_FIELDS = ['raiseCap', 'raised', 'status'] as const;

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
  status: FundStatus;
  balance: bigint;
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
    status: fundStatus(vaultStatus, publicOpen),
    balance,
  };
}

async function listFunds(client: PublicClient): Promise<FundSummary[]> {
  const factory = getFundFactoryAddress();
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
  const funds = await Promise.all(found.map((item) => readFund(client, item.address, item.index)));
  return funds.filter((fund): fund is FundSummary => fund !== null);
}

/** Funds created through FundFactory, newest index last in the raw list. */
export function useFunds() {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const factory = getFundFactoryAddress();
  return useQuery({
    queryKey: ['funds', factory],
    enabled: !!client && !!factory,
    refetchInterval: 20_000,
    queryFn: async () => {
      if (!client) return [];
      return listFunds(client);
    },
  });
}

export function useFund(address: string, account?: `0x${string}`) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const factory = getFundFactoryAddress();
  const valid = /^0x[0-9a-fA-F]{40}$/.test(address);
  return useQuery({
    queryKey: ['fund', factory, address.toLowerCase(), account ?? ''],
    enabled: !!client && valid,
    refetchInterval: 15_000,
    queryFn: async () => {
      if (!client) return null;
      const listed = await client.readContract({
        address: factory,
        abi: FundFactoryABI,
        functionName: 'isFund',
        args: [address as `0x${string}`],
      });
      if (!listed) return null;
      return readFund(client, address as `0x${string}`, 0, account);
    },
  });
}
