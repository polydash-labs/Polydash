/**
 * Decision log: one JSON object per line in decisions.jsonl.
 *
 * EVERY decision is logged — executed, rejected, and hold — with its
 * reasoning and the validate() reason, so a human can audit what the agent
 * did and why. The log lives in DATA_DIR and is the source the front-end's
 * decision feed explains (the LLM's reasoning lives here, not on-chain).
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Address } from 'viem';

export type DecisionStatus = 'executed' | 'rejected' | 'hold' | 'error';

export interface DecisionRecord {
  /** ISO timestamp of the decision. */
  ts: string;
  agentId: string | null;
  executor: Address;
  vault: Address;
  template: string;
  action: 'buy' | 'sell' | 'hold';
  rule: string;
  reasoning: string;
  /** validate() reason, or "ok" for executed, or the hold reason. */
  validateReason: string;
  status: DecisionStatus;
  assetIn: string | null;
  assetOut: string | null;
  /** Raw units (wei for WETH), as a decimal string. */
  amountIn: string | null;
  minAmountOut: string | null;
  nonce: string | null;
  txHash: string | null;
  error: string | null;
}

export function decisionLogPath(dataDir: string): string {
  return join(dataDir, 'decisions.jsonl');
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

/** Append one decision to decisions.jsonl. Returns the log path. */
export function appendDecision(dataDir: string, record: DecisionRecord): string {
  const path = decisionLogPath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record, jsonReplacer)}\n`, 'utf8');
  return path;
}

export function logFileExists(dataDir: string): boolean {
  return existsSync(decisionLogPath(dataDir));
}
