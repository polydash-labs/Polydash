// Types for Polypad agent action receipts (format polypad.agent-receipt/1).
// The JSON Schema in receipt.schema.json is the source of truth; these types
// mirror it. A receipt proves what happened on-chain. It is not a guarantee,
// reimbursement, or insurance promise.

export type Address = `0x${string}`;
export type TxHash = `0x${string}`;

export interface ScoreComponents {
  performance: number;
  history: number;
  activity: number;
  stake: number;
  conduct: number;
}

/** Verifiable intent (Nov 24, 2026, Scout proposal #1): the pre-captured
 * authorization an action executed under — what was allowed, by whom, within
 * what bounds, and the on-chain record of that authorization. Together with
 * the action and the settlement, a receipt now shows the full
 * intent → action → settlement chain. Mastercard's framing: "Payments aren't
 * the hard part. Authority is."
 *
 * authorizationHash is the record of the authorization: the propose
 * transaction hash for allowlist receipts, the score inputs hash for
 * score-posted receipts. authorizationHashKind says which one it is. */
export interface VerifiableIntent {
  /** The address that authorized the action (proposer / registered updater). */
  authorizedBy: Address;
  /** Plain-language: what was allowed. */
  authorization: string;
  /** Plain-language bounds: cap, allowlist, expiry, price band, wait. */
  bounds?: string;
  authorizationHash: string;
  authorizationHashKind: 'transaction' | 'inputs-hash';
  authorizedAtIso?: string;
  /** On-chain source of the authorization, e.g. "FundAllowlist.proposals(17) + propose transaction". */
  source: string;
}

export interface AgentScorePostedIdentity {
  agentId: number;
  name: string;
  wallet: Address;
  agentAccount: Address;
  stakePolydash: string;
  registeredAt: string;
  registeredAtIso?: string;
  active: true;
  registry: Address;
}

export interface AllowlistExecutedIdentity {
  executor: Address;
  executorNote?: string;
}

export interface AgentScorePostedApproval {
  rule: string;
  components: ScoreComponents;
  weightedScore: number;
  inputsHash: TxHash;
  source: string;
}

export interface AllowlistExecutedApproval {
  rule: string;
  proposalId: number;
  target: Address;
  assetSymbol?: string;
  assetName?: string;
  feed: Address;
  maxStaleSeconds: string;
  minPriceX18: string;
  maxPriceX18: string;
  proposedBy: Address;
  ownerAtProposal?: Address;
  proposeTransactionHash: TxHash;
  proposedAt: string;
  proposedAtIso?: string;
  readyAt: string;
  readyAtIso?: string;
  delaySeconds: string;
  executedAt: string;
  executedAtIso?: string;
  waitElapsedSeconds: string;
  source: string;
}

export interface AgentScorePostedSettlement {
  transactionHash: TxHash;
  blockNumber: string;
  blockTimestamp: string;
  blockTimestampIso?: string;
  from: Address;
  to: Address;
  status: 1;
  score: number;
  band: number;
  bandName?: string;
  updatedAt: string;
  updatedAtIso?: string;
  event: 'ScoreUpdated';
  explorerUrl?: string;
}

export interface AllowlistExecutedSettlement {
  transactionHash: TxHash;
  blockNumber: string;
  blockTimestamp: string;
  blockTimestampIso?: string;
  from: Address;
  to: Address;
  status: 1;
  executed: true;
  canceled: false;
  assetAllowed: true;
  feedStored: Address;
  events: string[];
  explorerUrl?: string;
}

export interface ReceiptBase {
  receiptFormat: 'polypad.agent-receipt/1';
  receiptId: string;
  chain: { id: 4663; name: 'Robinhood Chain' };
  intent?: VerifiableIntent;
  evidence?: Record<string, string>;
  disclaimer: 'This receipt records what happened on-chain. It is not a guarantee, reimbursement, or insurance promise.';
}

export interface AgentScorePostedReceipt extends ReceiptBase {
  action: { type: 'agent-score-posted'; description: string };
  identity: AgentScorePostedIdentity;
  authority: { rule: string; updater: Address; contract: Address; source: string };
  approval: AgentScorePostedApproval;
  settlement: AgentScorePostedSettlement;
}

export interface AllowlistExecutedReceipt extends ReceiptBase {
  action: { type: 'allowlist-executed'; description: string };
  identity: AllowlistExecutedIdentity;
  authority: { rule: string; contract: Address; source: string };
  approval: AllowlistExecutedApproval;
  settlement: AllowlistExecutedSettlement;
}

export type AgentReceipt = AgentScorePostedReceipt | AllowlistExecutedReceipt;

export type ReceiptActionType = AgentReceipt['action']['type'];

/** TypeScript does not narrow unions on a nested discriminant
 *  (receipt.action.type), so these guards do it explicitly. */
export function isAgentScorePostedReceipt(r: AgentReceipt): r is AgentScorePostedReceipt {
  return r.action.type === 'agent-score-posted';
}

export function isAllowlistExecutedReceipt(r: AgentReceipt): r is AllowlistExecutedReceipt {
  return r.action.type === 'allowlist-executed';
}
