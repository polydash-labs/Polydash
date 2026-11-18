'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { isAddress, parseAbiItem } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { SpendVaultABI, SPEND_VAULT_DEPLOY_BLOCK } from '@/lib/contracts/spend-vault-abi';
import { getSpendVaultAddress } from '@/lib/contracts/addresses';
import { erc20Abi } from '@/lib/staking/shared';
import { USDG_ADDRESS, POLYDASH_ADDRESS } from '@/lib/x402/constants';

export const SPEND_VAULT_ADDRESS = getSpendVaultAddress();

type Addr = `0x${string}`;

/** The two tokens the vault holds (and x402 settles in). */
export const VAULT_TOKENS = [
  { key: 'USDG', address: USDG_ADDRESS, decimals: 6, label: 'USDG' },
  { key: 'POLYDASH', address: POLYDASH_ADDRESS, decimals: 18, label: 'POLYDASH' },
] as const;

export function vaultTokenMeta(address: string | undefined) {
  return VAULT_TOKENS.find((t) => t.address.toLowerCase() === address?.toLowerCase()) ?? null;
}

export interface VaultKeyRow {
  key: string;
  owner: string;
  token: string;
  perPaymentCap: bigint;
  dailyCap: bigint;
  expiry: number;
  revoked: boolean;
  spentToday: bigint;
}

const KeyCreatedEvent = parseAbiItem(
  'event KeyCreated(address indexed owner, address indexed key, address indexed token, uint256 perPaymentCap, uint256 dailyCap, uint64 expiry)',
);

/** The connected wallet's vault balances, per token. Never throws. */
export function useVaultBalances(owner: string | undefined) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const valid = !!owner && isAddress(owner, { strict: false });
  return useQuery({
    queryKey: ['spend-vault', 'balances', owner?.toLowerCase()],
    enabled: !!client && valid && !!SPEND_VAULT_ADDRESS,
    refetchInterval: 30_000,
    queryFn: async (): Promise<Record<string, bigint>> => {
      if (!client || !valid || !SPEND_VAULT_ADDRESS) return {};
      const out: Record<string, bigint> = {};
      for (const t of VAULT_TOKENS) {
        out[t.key] = (await client.readContract({
          address: SPEND_VAULT_ADDRESS,
          abi: SpendVaultABI,
          functionName: 'balances',
          args: [owner as Addr, t.address as Addr],
        })) as bigint;
      }
      return out;
    },
  });
}

/** Deposit / withdraw the caller's own vault balance. The user signs in their own wallet; this page never holds keys. */
export function useVault() {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();

  async function deposit(token: Addr, amount: bigint): Promise<string> {
    if (!client || !address || !SPEND_VAULT_ADDRESS) throw new Error('Connect your wallet first.');
    if (amount <= 0n) throw new Error('Enter an amount above zero.');
    const allowance = (await client.readContract({
      address: token, abi: erc20Abi, functionName: 'allowance', args: [address, SPEND_VAULT_ADDRESS],
    })) as bigint;
    if (allowance < amount) {
      const approveHash = await writeContractAsync({
        address: token, abi: erc20Abi, functionName: 'approve', args: [SPEND_VAULT_ADDRESS, amount], chainId: robinhoodChain.id,
      });
      await client.waitForTransactionReceipt({ hash: approveHash });
    }
    const hash = await writeContractAsync({
      address: SPEND_VAULT_ADDRESS, abi: SpendVaultABI, functionName: 'deposit', args: [token, amount], chainId: robinhoodChain.id,
    });
    await client.waitForTransactionReceipt({ hash });
    await queryClient.invalidateQueries({ queryKey: ['spend-vault'] });
    return hash;
  }

  async function withdraw(token: Addr, amount: bigint): Promise<string> {
    if (!client || !address || !SPEND_VAULT_ADDRESS) throw new Error('Connect your wallet first.');
    if (amount <= 0n) throw new Error('Enter an amount above zero.');
    const hash = await writeContractAsync({
      address: SPEND_VAULT_ADDRESS, abi: SpendVaultABI, functionName: 'withdraw', args: [token, amount], chainId: robinhoodChain.id,
    });
    await client.waitForTransactionReceipt({ hash });
    await queryClient.invalidateQueries({ queryKey: ['spend-vault'] });
    return hash;
  }

  return { deposit, withdraw, connected: !!address, address };
}

/** Create a spending key for an agent wallet, and revoke keys you own. */
export function useSpendingKeys() {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();

  async function createKey(
    key: string,
    token: Addr,
    perPaymentCap: bigint,
    dailyCap: bigint,
    allowlist: Addr[],
    expiry: number,
  ): Promise<string> {
    if (!client || !address || !SPEND_VAULT_ADDRESS) throw new Error('Connect your wallet first.');
    if (!isAddress(key, { strict: false })) throw new Error('That key address is not valid.');
    if (perPaymentCap <= 0n || dailyCap <= 0n) throw new Error('Caps must be above zero.');
    if (perPaymentCap > dailyCap) throw new Error('The per-payment cap cannot be larger than the daily cap.');
    if (expiry * 1000 <= Date.now()) throw new Error('The expiry must be in the future.');
    const hash = await writeContractAsync({
      address: SPEND_VAULT_ADDRESS, abi: SpendVaultABI, functionName: 'createKey',
      args: [key as Addr, token, perPaymentCap, dailyCap, allowlist, BigInt(expiry)], chainId: robinhoodChain.id,
    });
    await client.waitForTransactionReceipt({ hash });
    await queryClient.invalidateQueries({ queryKey: ['spend-vault'] });
    return hash;
  }

  async function revokeKey(key: string): Promise<string> {
    if (!client || !address || !SPEND_VAULT_ADDRESS) throw new Error('Connect your wallet first.');
    const hash = await writeContractAsync({
      address: SPEND_VAULT_ADDRESS, abi: SpendVaultABI, functionName: 'revokeKey',
      args: [key as Addr], chainId: robinhoodChain.id,
    });
    await client.waitForTransactionReceipt({ hash });
    await queryClient.invalidateQueries({ queryKey: ['spend-vault'] });
    return hash;
  }

  return { createKey, revokeKey, connected: !!address, address };
}

/** One key's live state, or null when the address has no key. Never throws. */
export function useKeyStatus(keyAddress: string | undefined) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const valid = !!keyAddress && isAddress(keyAddress, { strict: false });
  return useQuery({
    queryKey: ['spend-vault', 'key', keyAddress?.toLowerCase()],
    enabled: !!client && valid && !!SPEND_VAULT_ADDRESS,
    queryFn: async (): Promise<VaultKeyRow | null> => {
      if (!client || !valid || !SPEND_VAULT_ADDRESS) return null;
      const k = (await client.readContract({
        address: SPEND_VAULT_ADDRESS, abi: SpendVaultABI, functionName: 'keys', args: [keyAddress as Addr],
      })) as unknown as readonly [string, string, bigint, bigint, bigint, boolean, bigint, bigint, bigint];
      if (k[0] === '0x0000000000000000000000000000000000000000') return null;
      return {
        key: keyAddress, owner: k[0], token: k[1], perPaymentCap: k[2], dailyCap: k[3],
        expiry: Number(k[4]), revoked: k[5], spentToday: k[7],
      } satisfies VaultKeyRow;
    },
  });
}

/** Keys the connected wallet created (from KeyCreated events, vault deploy → now). */
export function useMyKeys(owner: string | undefined) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const valid = !!owner && isAddress(owner, { strict: false });
  return useQuery({
    queryKey: ['spend-vault', 'my-keys', owner?.toLowerCase()],
    enabled: !!client && valid && !!SPEND_VAULT_ADDRESS,
    refetchInterval: 60_000,
    queryFn: async (): Promise<VaultKeyRow[]> => {
      if (!client || !valid || !SPEND_VAULT_ADDRESS) return [];
      const latest = await client.getBlockNumber();
      const logs: { args: { key: string; token: string; perPaymentCap: bigint; dailyCap: bigint; expiry: bigint } }[] = [];
      for (let s = SPEND_VAULT_DEPLOY_BLOCK; s <= latest; s += 99_000n) {
        const e = s + 99_000n - 1n;
        const part = await client.getLogs({
          address: SPEND_VAULT_ADDRESS, event: KeyCreatedEvent,
          args: { owner: owner as Addr },
          fromBlock: s, toBlock: e > latest ? latest : e,
        });
        logs.push(...(part as typeof logs));
      }
      const keyAddrs = [...new Set(logs.map((l) => l.args.key.toLowerCase()))];
      if (!keyAddrs.length) return [];
      const states = await client.multicall({
        allowFailure: true,
        contracts: keyAddrs.map((k) => ({
          address: SPEND_VAULT_ADDRESS, abi: SpendVaultABI, functionName: 'keys' as const, args: [k as Addr] as const,
        })),
      });
      return keyAddrs
        .map((k) => {
          const i = keyAddrs.indexOf(k);
          const s = states[i]?.status === 'success'
            ? (states[i].result as unknown as readonly [string, string, bigint, bigint, bigint, boolean, bigint, bigint, bigint])
            : null;
          const log = logs.find((l) => l.args.key.toLowerCase() === k);
          if (!s && !log) return null;
          return {
            key: k,
            owner: s ? s[0] : owner,
            token: s ? s[1] : log!.args.token,
            perPaymentCap: s ? s[2] : log!.args.perPaymentCap,
            dailyCap: s ? s[3] : log!.args.dailyCap,
            expiry: s ? Number(s[4]) : Number(log!.args.expiry),
            revoked: s ? s[5] : false,
            spentToday: s ? s[7] : 0n,
          } satisfies VaultKeyRow;
        })
        .filter((r): r is VaultKeyRow => r !== null);
    },
  });
}
