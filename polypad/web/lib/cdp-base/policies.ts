// CDP Policy Engine rules for a Base agent wallet.
//
// The policy is the on-Coinbase backstop behind Polypad's own caps. It is
// an account-level policy, attached at account creation. Rules are
// evaluated in order; a matching `reject` rule blocks the operation.
//
// What it enforces (and what it cannot):
// - Network: only Base. A Base wallet can never send on another chain.
// - ETH value: at most 0.01 ETH per transaction — blocks ETH drains. (A
//   USDC transfer carries 0 ETH, so this does not cap token payments;
//   those are capped by the USDC rules below + Polypad's per-payment cap.)
// - Destination: on-chain sends may only call the USDC contract — the
//   wallet cannot call any other contract or send to an arbitrary address.
// - Typed-data signing: a TransferWithAuthorization may only pay Polypad's
//   x402 fee wallet. This is the EIP-3009 guardrail for x402 payments:
//   even if Polypad's server were tricked into signing, CDP refuses to
//   sign an authorization that pays anyone else.
//
// What it does NOT enforce: the daily cap. CDP policies are evaluated per
// transaction, so the daily cap lives in Polypad (lib/cdp-base/wallets.ts
// checks the day's settled payments in Neon before signing anything).
// The UI says this plainly — the daily cap is ours, the per-payment
// network + destination rules are Coinbase's.
import type { CdpClient, CreatePolicyBody } from '@coinbase/cdp-sdk';
import { USDC_BASE_ADDRESS, X402_PAY_TO } from '@/lib/x402/constants';

/** Max native ETH value per transaction, in wei (0.01 ETH). */
const MAX_ETH_VALUE_WEI = '10000000000000000';

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ],
} as const;

// The SDK wants a mutable Record for the typed-data `types`; the shared
// constant is `as const` (readonly), so copy it into a mutable shape.
const TRANSFER_WITH_AUTHORIZATION_TYPES_MUTABLE: Record<string, { name: string; type: string }[]> =
  Object.fromEntries(
    Object.entries(TRANSFER_WITH_AUTHORIZATION_TYPES).map(([key, fields]) => [
      key,
      fields.map((f) => ({ name: f.name, type: f.type })),
    ]),
  );

export function baseWalletPolicyRules(): CreatePolicyBody['rules'] {
  return [
    {
      action: 'reject' as const,
      operation: 'sendEvmTransaction' as const,
      criteria: [{ type: 'evmNetwork' as const, networks: ['base' as const], operator: 'not in' as const }],
    },
    {
      action: 'reject' as const,
      operation: 'sendEvmTransaction' as const,
      criteria: [{ type: 'ethValue' as const, ethValue: MAX_ETH_VALUE_WEI, operator: '>' as const }],
    },
    {
      action: 'reject' as const,
      operation: 'sendEvmTransaction' as const,
      criteria: [{ type: 'evmAddress' as const, addresses: [USDC_BASE_ADDRESS], operator: 'not in' as const }],
    },
    {
      action: 'reject' as const,
      operation: 'signEvmTypedData' as const,
      criteria: [
        {
          type: 'evmTypedDataField' as const,
          types: { types: TRANSFER_WITH_AUTHORIZATION_TYPES_MUTABLE, primaryType: 'TransferWithAuthorization' },
          conditions: [{ path: 'message.to', operator: 'not in' as const, addresses: [X402_PAY_TO] }],
        },
      ],
    },
  ];
}

/** Create the account-level policy for one Base agent wallet. Returns its CDP id. */
export async function createBaseWalletPolicy(cdp: CdpClient, name: string): Promise<string> {
  const policy = await cdp.policies.createPolicy({
    policy: {
      scope: 'account',
      description: `Polypad Base agent wallet policy for ${name} — Base only, USDC only, x402 fee wallet only.`,
      rules: baseWalletPolicyRules(),
    },
  });
  return policy.id;
}

export async function pauseBaseWalletPolicy(cdp: CdpClient, policyId: string): Promise<void> {
  await cdp.policies.pausePolicy({ id: policyId });
}

export async function resumeBaseWalletPolicy(cdp: CdpClient, policyId: string): Promise<void> {
  await cdp.policies.resumePolicy({ id: policyId });
}
