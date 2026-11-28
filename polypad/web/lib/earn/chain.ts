// Agent-earn chain reads — server-side only.
// The escrow is the source of truth for money: lock state, amounts, fee
// snapshot, settlement. The board never trusts a client claim about a
// transaction — the events route verifies every reported tx hash against
// the chain (receipt + decoded logs) before recording it.

import { decodeEventLog, getAddress, type Address, type Hex } from 'viem';
import { publicClient } from '@/lib/agents/tools';
import { AGENT_EARN_ESCROW_ADDRESS } from './constants';
import { AgentEarnEscrowABI, type EscrowLock, LOCK_STATE_NAMES, OUTCOME_NAMES } from './abi';

/** Block the escrow deployed in (Nov 28, 2026, v2) — the event scan starts here. */
const ESCROW_DEPLOY_BLOCK = 125169479n;
const LOG_CHUNK = 99_000n;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function lockStateName(state: number): string {
  return LOCK_STATE_NAMES[state] ?? 'Unknown';
}

export function outcomeName(outcome: number): string {
  return OUTCOME_NAMES[outcome] ?? 'Unknown';
}

/** Full on-chain lock record, or null when no lock exists for the jobId. */
export async function readLock(jobId: Hex): Promise<EscrowLock | null> {
  const lock = (await publicClient.readContract({
    address: AGENT_EARN_ESCROW_ADDRESS,
    abi: AgentEarnEscrowABI,
    functionName: 'getLock',
    args: [jobId],
  })) as unknown as EscrowLock;
  if (lock.state === 0) return null;
  return {
    ...lock,
    poster: getAddress(lock.poster),
    agent: lock.agent === ZERO_ADDRESS ? ZERO_ADDRESS : getAddress(lock.agent),
    assignee: lock.assignee === ZERO_ADDRESS ? ZERO_ADDRESS : getAddress(lock.assignee),
    feeBpsAtLock: Number(lock.feeBpsAtLock),
  };
}

/** Live escrow config — used to confirm the board points at the real
 * deployment (token / panelExecutor / feeBps / feeRecipient). */
export async function readEscrowConfig(): Promise<{
  token: string;
  panelExecutor: string;
  feeBps: number;
  feeRecipient: string;
}> {
  const [token, panelExecutor, feeBps, feeRecipient] = await Promise.all([
    publicClient.readContract({ address: AGENT_EARN_ESCROW_ADDRESS, abi: AgentEarnEscrowABI, functionName: 'token' }),
    publicClient.readContract({ address: AGENT_EARN_ESCROW_ADDRESS, abi: AgentEarnEscrowABI, functionName: 'panelExecutor' }),
    publicClient.readContract({ address: AGENT_EARN_ESCROW_ADDRESS, abi: AgentEarnEscrowABI, functionName: 'feeBps' }),
    publicClient.readContract({ address: AGENT_EARN_ESCROW_ADDRESS, abi: AgentEarnEscrowABI, functionName: 'feeRecipient' }),
  ]);
  return {
    token: getAddress(token as Address),
    panelExecutor: getAddress(panelExecutor as Address),
    feeBps: Number(feeBps),
    feeRecipient: getAddress(feeRecipient as Address),
  };
}

export interface LockChainEvent {
  event: 'Locked' | 'Claimed' | 'Delivered' | 'Released' | 'PanelResolved' | 'Refunded';
  txHash: Hex;
  blockNumber: bigint;
  blockTimestamp: number;
  args: Record<string, unknown>;
}

/** Every escrow event for one jobId, oldest first. The receipt reads these. */
export async function readLockEvents(jobId: Hex): Promise<LockChainEvent[]> {
  const latest = await publicClient.getBlockNumber();
  const out: LockChainEvent[] = [];
  for (let from = ESCROW_DEPLOY_BLOCK; from <= latest; from += LOG_CHUNK) {
    const to = from + LOG_CHUNK - 1n > latest ? latest : from + LOG_CHUNK - 1n;
    const logs = await publicClient.getLogs({
      address: AGENT_EARN_ESCROW_ADDRESS,
      fromBlock: from,
      toBlock: to,
      args: { jobId },
    } as never);
    for (const log of logs) {
      try {
        const decoded = decodeEventLog({ abi: AgentEarnEscrowABI as never, data: log.data, topics: log.topics });
        const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
        out.push({
          event: decoded.eventName as unknown as LockChainEvent['event'],
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          blockTimestamp: Number(block.timestamp),
          args: decoded.args as unknown as Record<string, unknown>,
        });
      } catch {
        // Skip a log that does not decode against the escrow ABI.
      }
    }
  }
  out.sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0));
  return out;
}

export interface VerifiedTx {
  hash: Hex;
  status: 'success' | 'reverted';
  blockNumber: bigint;
  blockTimestamp: number;
  from: string;
  /** The decoded escrow event in this tx for this jobId, if any. */
  event: LockChainEvent['event'] | null;
  eventArgs: Record<string, unknown> | null;
}

/** Verify a client-reported transaction hash on-chain before the board
 * records it: the receipt must exist and have succeeded, and (when an
 * event name is given) the tx must contain that escrow event for this
 * jobId. Returns null when the tx cannot be verified. */
export async function verifyTxEvent(
  hash: Hex,
  jobId: Hex,
  eventName?: LockChainEvent['event'],
): Promise<VerifiedTx | null> {
  let receipt;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash });
  } catch {
    return null;
  }
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  let event: LockChainEvent['event'] | null = null;
  let eventArgs: Record<string, unknown> | null = null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== AGENT_EARN_ESCROW_ADDRESS.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: AgentEarnEscrowABI as never, data: log.data, topics: log.topics });
      const args = decoded.args as unknown as Record<string, unknown>;
      if ((args.jobId as string | undefined)?.toLowerCase() !== jobId.toLowerCase()) continue;
      event = decoded.eventName as unknown as LockChainEvent['event'];
      eventArgs = args;
    } catch {
      // Not an escrow event — ignore.
    }
  }
  if (eventName && event !== eventName) return null;
  return {
    hash,
    status: receipt.status,
    blockNumber: receipt.blockNumber,
    blockTimestamp: Number(block.timestamp),
    from: getAddress(receipt.from),
    event,
    eventArgs,
  };
}
