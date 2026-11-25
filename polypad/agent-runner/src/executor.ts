/**
 * On-chain executor client: validate() pre-check, execute submission,
 * receipt handling, and revert decoding.
 *
 * Flow per action (see SPEC.md): build the instruction -> sign it -> call
 * validate() -> submit execute() only when validate says ok. A rejected
 * execute REVERTS on-chain with a custom error (there is no non-reverting
 * execute), so reverts are decoded here into their kebab-case reason.
 */
import { decodeErrorResult, type Address, type Hash, type Hex, type PublicClient, type WalletClient } from 'viem';
import { agentExecutorAbi } from './chain.js';
import type { Instruction } from './signer.js';

/** validate() reasons (kebab-case, per SPEC.md). */
export const VALIDATE_REASONS = [
  'ok',
  'wrong-vault',
  'expired',
  'bad-nonce',
  'bad-signature',
  'paused',
  'not-investing',
  'vault-paused',
  'not-executor',
  'not-in-mandate',
  'not-allowlisted',
  'bad-router',
  'trade-cap',
  'position-cap',
  'daily-limit',
  'circuit-breaker',
  'too-soon',
] as const;

export interface ExecutorState {
  paused: boolean;
  retired: boolean;
  nextNonce: bigint;
  agentKey: Address;
  vault: Address;
  highWaterNavPerNft: bigint;
  lastExecution: bigint;
  templateId: number;
  riskLevel: number;
  maxPositionBps: number;
  maxTradeBps: number;
  maxDeviationBps: number;
  dailyTradeLimit: number;
  circuitBreakerBps: number;
  rebalanceIntervalSeconds: number;
  rulesHash: Hex;
}

export interface ValidateResult {
  ok: boolean;
  reason: string;
}

export interface ExecuteResult {
  hash: Hash;
  status: 'success' | 'reverted';
  blockNumber: bigint;
}

export class ExecutorClient {
  constructor(
    private readonly publicClient: PublicClient,
    private readonly walletClient: WalletClient,
    private readonly executorAddress: Address,
  ) {}

  async getState(): Promise<ExecutorState> {
    const [paused, retired, nextNonce, agentKey, vault, highWaterNavPerNft, lastExecution, params] =
      await Promise.all([
        this.publicClient.readContract({
          address: this.executorAddress,
          abi: agentExecutorAbi,
          functionName: 'paused',
        }),
        this.publicClient.readContract({
          address: this.executorAddress,
          abi: agentExecutorAbi,
          functionName: 'retired',
        }),
        this.publicClient.readContract({
          address: this.executorAddress,
          abi: agentExecutorAbi,
          functionName: 'nextNonce',
        }),
        this.publicClient.readContract({
          address: this.executorAddress,
          abi: agentExecutorAbi,
          functionName: 'agentKey',
        }),
        this.publicClient.readContract({
          address: this.executorAddress,
          abi: agentExecutorAbi,
          functionName: 'vault',
        }),
        this.publicClient.readContract({
          address: this.executorAddress,
          abi: agentExecutorAbi,
          functionName: 'highWaterNavPerNft',
        }),
        this.publicClient.readContract({
          address: this.executorAddress,
          abi: agentExecutorAbi,
          functionName: 'lastExecution',
        }),
        this.publicClient.readContract({
          address: this.executorAddress,
          abi: agentExecutorAbi,
          functionName: 'params',
        }),
      ]);
    return {
      paused,
      retired,
      nextNonce,
      agentKey,
      vault,
      highWaterNavPerNft,
      lastExecution,
      templateId: params.templateId,
      riskLevel: params.riskLevel,
      maxPositionBps: params.maxPositionBps,
      maxTradeBps: params.maxTradeBps,
      maxDeviationBps: params.maxDeviationBps,
      dailyTradeLimit: params.dailyTradeLimit,
      circuitBreakerBps: params.circuitBreakerBps,
      rebalanceIntervalSeconds: params.rebalanceIntervalSeconds,
      rulesHash: params.rulesHash,
    };
  }

  /** Dry-run the instruction against the executor's checks 1-10. */
  async validate(ix: Instruction, signature: Hex): Promise<ValidateResult> {
    const [ok, reason] = await this.publicClient.readContract({
      address: this.executorAddress,
      abi: agentExecutorAbi,
      functionName: 'validate',
      args: [ix, signature],
    });
    return { ok, reason };
  }

  /**
   * Submit execute(). The caller must have run validate() first; a revert
   * here is decoded into its custom-error name and thrown as an Error whose
   * message starts with that name.
   */
  async execute(ix: Instruction, signature: Hex): Promise<ExecuteResult> {
    let hash: Hash;
    try {
      hash = await this.walletClient.writeContract({
        address: this.executorAddress,
        abi: agentExecutorAbi,
        functionName: 'execute',
        args: [ix, signature],
        chain: this.walletClient.chain,
        account: this.walletClient.account ?? null,
      });
    } catch (error) {
      throw new Error(`execute rejected: ${decodeRevertReason(error)}`, { cause: error });
    }
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === 'reverted') {
      throw new Error('execute reverted on-chain (receipt status reverted)');
    }
    return { hash, status: receipt.status, blockNumber: receipt.blockNumber };
  }
}

/** Decode a viem revert (custom error or plain message) into a short reason. */
export function decodeRevertReason(error: unknown): string {
  const asError = error as { cause?: unknown; shortMessage?: string; message?: string };
  const data = (asError.cause as { data?: Hex } | undefined)?.data;
  if (data) {
    try {
      const decoded = decodeErrorResult({ abi: agentExecutorAbi, data });
      return decoded.errorName;
    } catch {
      // Fall through to the message.
    }
  }
  const message = asError.shortMessage ?? asError.message ?? String(error);
  // viem messages often embed the custom error name, e.g. "BadSignature()".
  const match = /([A-Z][A-Za-z]+)\(\)/.exec(message);
  if (match) return match[1]!;
  return message.slice(0, 200);
}
