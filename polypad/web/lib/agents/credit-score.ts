'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { isAddress } from 'viem';
import { robinhoodChain } from '@/lib/chain';
import { AgentRegistryABI, AgentScoreABI } from '@/lib/contracts/agent-credit-score-abi';
import { getAgentRegistryAddress, getAgentScoreAddress } from '@/lib/contracts/addresses';
import { POLYDASH_TOKEN, erc20Abi } from '@/lib/staking/shared';

export const REGISTRY_ADDRESS = getAgentRegistryAddress();
export const SCORE_ADDRESS = getAgentScoreAddress();

/** The 1,000 POLYDASH bond an agent puts up to register (18 decimals). */
export const REGISTRATION_STAKE = 1000n * 10n ** 18n;

export type Band = { key: string; label: string; range: string; chip: string };

export const BANDS: Band[] = [
  { key: 'elite', label: 'Elite', range: '800–850', chip: 'bg-polydash-green/15 text-polydash-green' },
  { key: 'prime', label: 'Prime', range: '700–799', chip: 'bg-sky-400/10 text-sky-300' },
  { key: 'standard', label: 'Standard', range: '600–699', chip: 'bg-white/10 text-white' },
  { key: 'building', label: 'Building', range: '500–599', chip: 'bg-yellow-400/10 text-yellow-200' },
  { key: 'new', label: 'New', range: '300–499', chip: 'bg-white/5 text-white/60' },
];

export function bandForScore(score: number): Band {
  if (score >= 800) return BANDS[0];
  if (score >= 700) return BANDS[1];
  if (score >= 600) return BANDS[2];
  if (score >= 500) return BANDS[3];
  return BANDS[4];
}

export const COMPONENTS = [
  { key: 'performance', label: 'Performance', weight: 35, blurb: 'How the funds the agent manages have performed. A new agent with no funds yet scores 0 here.' },
  { key: 'history', label: 'History', weight: 20, blurb: 'How long the agent has been registered and how many funds it has managed.' },
  { key: 'activity', label: 'Activity', weight: 15, blurb: 'How much the agent actually does — trades, launches, and fund actions in the last 30 days.' },
  { key: 'stake', label: 'Stake', weight: 15, blurb: 'Skin in the game: the 1,000 POLYDASH bond, plus POLYDASH the agent has staked.' },
  { key: 'conduct', label: 'Conduct', weight: 15, blurb: 'Good behavior. Starts neutral. A clean record and paying out rewards help; being penalized for bad behavior hurts.' },
] as const;

export interface AgentRow {
  id: number;
  name: string;
  wallet: string;
  agentAccount: string;
  stake: bigint;
  registeredAt: number;
  active: boolean;
  scored: boolean;
  score: number | null;
  components: number[] | null;
  updatedAt: number | null;
}

type Addr = `0x${string}`;

/** Every registered agent with its score, newest first. Read on the server behind /api/agents/scores (round 7): the browser-side chain read (agentCount + two multicalls through wagmi) stopped resolving on /agents/scores in the Nov 21 evening scan — 35s+ on "Loading agents from Robinhood Chain…" while /agents rendered the same 5 scores fine — so the loader, not the chain, was broken. The route returns `stake` as a decimal string (AgentRow carries a bigint, which JSON cannot carry); it is revived here. */
export function useAgentDirectory() {
  return useQuery({
    queryKey: ['agent-credit-score', 'directory'],
    enabled: !!REGISTRY_ADDRESS && !!SCORE_ADDRESS,
    refetchInterval: 60_000,
    // Retry with backoff like the fund hooks: a slow first-paint read must
    // not flash the empty state (same pattern as useV3Funds). A 502 means
    // the server read was not ready in time, not that there are no agents.
    retry: 5,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    queryFn: async (): Promise<AgentRow[]> => {
      const r = await fetch('/api/agents/scores', { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`Agent list read failed: ${r.status}`);
      const j = (await r.json()) as { agents: (Omit<AgentRow, 'stake'> & { stake: string })[] };
      return (j.agents ?? []).map((a) => ({ ...a, stake: BigInt(a.stake ?? '0') }));
    },
  });
}

export interface WalletScore {
  registered: boolean;
  agentId: number | null;
  scored: boolean;
  score: number | null;
  components: number[] | null;
  updatedAt: number | null;
}

/** One wallet's agent record + score (for the fund-page badge). Never throws. */
export function useAgentScoreByWallet(wallet: string | undefined) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const valid = !!wallet && isAddress(wallet, { strict: false });
  return useQuery({
    queryKey: ['agent-credit-score', 'wallet', wallet?.toLowerCase()],
    enabled: !!client && valid && !!REGISTRY_ADDRESS && !!SCORE_ADDRESS,
    staleTime: 60_000,
    retry: 1,
    queryFn: async (): Promise<WalletScore> => {
      const none: WalletScore = { registered: false, agentId: null, scored: false, score: null, components: null, updatedAt: null };
      if (!client || !valid || !REGISTRY_ADDRESS || !SCORE_ADDRESS) return none;
      const id = Number(await client.readContract({ address: REGISTRY_ADDRESS, abi: AgentRegistryABI, functionName: 'agentIdByWallet', args: [wallet as Addr] }));
      if (!id) return none;
      const s = (await client.readContract({ address: SCORE_ADDRESS, abi: AgentScoreABI, functionName: 'scores', args: [BigInt(id)] })) as unknown as { score: number; performance: number; history: number; activity: number; stake: number; conduct: number; updatedAt: bigint; inputsHash: string; exists: boolean };
      // Named access: viem decodes tuples as objects, not arrays (see
      // useAgentDirectory above) — s[8] would be undefined forever.
      const scored = s.exists === true;
      return {
        registered: true,
        agentId: id,
        scored,
        score: scored ? Number(s.score) : null,
        components: scored ? [Number(s.performance), Number(s.history), Number(s.activity), Number(s.stake), Number(s.conduct)] : null,
        updatedAt: scored ? Number(s.updatedAt) : null,
      };
    },
  });
}

/** Approve the 1,000 POLYDASH bond, then register. The user signs in their own wallet; this page never holds keys. */
export function useRegisterAgent() {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();

  async function register(name: string, wallet: string, agentAccount: string): Promise<number> {
    if (!client || !address || !REGISTRY_ADDRESS) throw new Error('Connect your wallet first.');
    if (!isAddress(wallet, { strict: false })) throw new Error('That wallet address is not valid.');
    const account = agentAccount.trim() === '' ? '0x0000000000000000000000000000000000000000' : agentAccount.trim();
    if (!isAddress(account, { strict: false })) throw new Error('That agent account address is not valid.');

    const balance = (await client.readContract({ address: POLYDASH_TOKEN as Addr, abi: erc20Abi, functionName: 'balanceOf', args: [address] })) as bigint;
    if (balance < REGISTRATION_STAKE) throw new Error('You need at least 1,000 POLYDASH in your wallet to register.');
    const allowance = (await client.readContract({ address: POLYDASH_TOKEN as Addr, abi: erc20Abi, functionName: 'allowance', args: [address, REGISTRY_ADDRESS] })) as bigint;
    if (allowance < REGISTRATION_STAKE) {
      const approveHash = await writeContractAsync({
        address: POLYDASH_TOKEN as Addr, abi: erc20Abi, functionName: 'approve', args: [REGISTRY_ADDRESS, REGISTRATION_STAKE], chainId: robinhoodChain.id,
      });
      await client.waitForTransactionReceipt({ hash: approveHash });
    }
    const hash = await writeContractAsync({
      address: REGISTRY_ADDRESS, abi: AgentRegistryABI, functionName: 'registerAgent',
      args: [name.trim(), wallet as Addr, account as Addr], chainId: robinhoodChain.id,
    });
    await client.waitForTransactionReceipt({ hash });
    const id = Number(await client.readContract({ address: REGISTRY_ADDRESS, abi: AgentRegistryABI, functionName: 'agentIdByWallet', args: [wallet as Addr] }));
    await queryClient.invalidateQueries({ queryKey: ['agent-credit-score'] });
    return id;
  }

  return { register, connected: !!address, address };
}
