// AgentEarnEscrow ABI — AgentEarnEscrow.sol (390 lines, Sourcify
// exact_match on Robinhood Chain 4663, deployed Nov 27, 2026).
// Only the functions + events the board calls or reads. Keep in sync with
// the contract source at ~/workspace/polydash/src/escrow/AgentEarnEscrow.sol.

import {
  AGENT_EARN_ESCROW_ADDRESS,
  AGENT_EARN_PANEL_EXECUTOR,
  AGENT_EARN_TOKEN,
  AGENT_EARN_FEE_RECIPIENT,
} from './constants';

export { AGENT_EARN_ESCROW_ADDRESS, AGENT_EARN_PANEL_EXECUTOR, AGENT_EARN_TOKEN, AGENT_EARN_FEE_RECIPIENT };

const lockTuple = {
  name: '',
  type: 'tuple',
  components: [
    { name: 'poster', type: 'address' },
    { name: 'agent', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'state', type: 'uint8' },
    { name: 'lockedAt', type: 'uint256' },
    { name: 'claimedAt', type: 'uint256' },
    { name: 'deliverableHash', type: 'bytes32' },
    { name: 'deliveredAt', type: 'uint256' },
    { name: 'feeBpsAtLock', type: 'uint16' },
    { name: 'settledAt', type: 'uint256' },
    { name: 'outcome', type: 'uint8' },
    { name: 'agentShare', type: 'uint256' },
    { name: 'posterShare', type: 'uint256' },
    { name: 'feePaid', type: 'uint256' },
  ],
} as const;

export const AgentEarnEscrowABI = [
  { type: 'constructor', inputs: [
    { name: 'token_', type: 'address' },
    { name: 'panelExecutor_', type: 'address' },
    { name: 'feeBps_', type: 'uint16' },
    { name: 'feeRecipient_', type: 'address' },
  ], stateMutability: 'nonpayable' },
  { type: 'function', name: 'lock', stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'bytes32' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'claim', stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'deliver', stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'bytes32' }, { name: 'deliverableHash', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'release', stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'panelResolve', stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId', type: 'bytes32' },
      { name: 'outcome', type: 'uint8' },
      { name: 'splitBps', type: 'uint16' },
      { name: 'voters', type: 'address[]' },
    ], outputs: [] },
  { type: 'function', name: 'refund', stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'getLock', stateMutability: 'view',
    inputs: [{ name: 'jobId', type: 'bytes32' }], outputs: [lockTuple] },
  { type: 'function', name: 'token', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'panelExecutor', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'feeBps', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint16' }] },
  { type: 'function', name: 'feeRecipient', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'event', name: 'Locked', inputs: [
    { name: 'jobId', type: 'bytes32', indexed: true },
    { name: 'poster', type: 'address', indexed: true },
    { name: 'amount', type: 'uint256', indexed: false },
  ] },
  { type: 'event', name: 'Claimed', inputs: [
    { name: 'jobId', type: 'bytes32', indexed: true },
    { name: 'agent', type: 'address', indexed: true },
  ] },
  { type: 'event', name: 'Delivered', inputs: [
    { name: 'jobId', type: 'bytes32', indexed: true },
    { name: 'agent', type: 'address', indexed: true },
    { name: 'deliverableHash', type: 'bytes32', indexed: false },
  ] },
  { type: 'event', name: 'Released', inputs: [
    { name: 'jobId', type: 'bytes32', indexed: true },
    { name: 'agent', type: 'address', indexed: true },
    { name: 'amount', type: 'uint256', indexed: false },
    { name: 'fee', type: 'uint256', indexed: false },
  ] },
  { type: 'event', name: 'PanelResolved', inputs: [
    { name: 'jobId', type: 'bytes32', indexed: true },
    { name: 'outcome', type: 'uint8', indexed: false },
    { name: 'agentShare', type: 'uint256', indexed: false },
    { name: 'posterShare', type: 'uint256', indexed: false },
    { name: 'voters', type: 'address[]', indexed: false },
  ] },
  { type: 'event', name: 'Refunded', inputs: [
    { name: 'jobId', type: 'bytes32', indexed: true },
    { name: 'poster', type: 'address', indexed: true },
    { name: 'amount', type: 'uint256', indexed: false },
  ] },
] as const;

/** Minimal ERC-20 for the approve + lock flow (USDG). */
export const Erc20ApproveABI = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
] as const;

/** Lock states (contract LockState enum). */
export const LOCK_STATE_NAMES = ['None', 'Locked', 'Released', 'Refunded', 'PanelResolved'] as const;
/** Panel outcomes (contract Outcome enum). */
export const OUTCOME_NAMES = ['None', 'PayFull', 'PayPart', 'NoPay'] as const;
export const OUTCOME_NUMBERS = { PayFull: 1, PayPart: 2, NoPay: 3 } as const;

export interface EscrowLock {
  poster: string;
  agent: string;
  amount: bigint;
  state: number;
  lockedAt: bigint;
  claimedAt: bigint;
  deliverableHash: string;
  deliveredAt: bigint;
  feeBpsAtLock: number;
  settledAt: bigint;
  outcome: number;
  agentShare: bigint;
  posterShare: bigint;
  feePaid: bigint;
}
