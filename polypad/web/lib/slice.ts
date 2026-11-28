// Airdrop slice: config, gas, copy. ABIs/bytecode/args live in lib/sliceArtifacts.ts (owner file, never retype).
import { gasLimit } from '@/lib/nftStaking';
import { SLICE_GAS, SLICE_ROOTS_URL, SLICE_DISTRIBUTOR_EXPECTED_ADDRESS, SLICE_ESCROW_EXPECTED_ADDRESS } from '@/lib/sliceArtifacts';
export { errorName, sameAddress, isZeroAddr, short, blockscoutAddr, blockscoutTx, fmtPT, fmtToken } from '@/lib/buyback';
import { errorName } from '@/lib/buyback';

export const SLICE_DISTRIBUTOR_ADDRESS: `0x${string}` | null = "0x5ca4B6bc4e40C6E7120b8d28467cc6b00410c0E0";
export const SLICE_ESCROW_ADDRESS: `0x${string}` | null = "0xa43A2F3512133F2559Cd6199AF628bebE2417556";
export const SLICE_DEPLOY_BLOCK: bigint | null = BigInt(103999132);
export const sourcifyUrl = (addr: string) => `https://repo.sourcify.dev/4663/${addr}`;
export const PENDING_REVIEW = "This week's list is pending the 24h review";
export const SLICE_EPOCH_DATA_URL = SLICE_ROOTS_URL;
export const REWARDS_POOL = "0x608d106Bb58A804fcd45823e0C6087801dee2aCa";
export const LAUNCH_FACTORIES = ["0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2", "0x2C84cFCD8d283EF750E09Fbed735d67F67845dB2"] as const;
export const SLICE_GUARDIAN = "0x9a21c75aC263cC43125E70200636f6397f8776d0";

export type Addr = `0x${string}`;
export const sliceLive = () => !!SLICE_ESCROW_ADDRESS && !!SLICE_DISTRIBUTOR_ADDRESS;
export const EXPECTED = { distributor: SLICE_DISTRIBUTOR_EXPECTED_ADDRESS as Addr, escrow: SLICE_ESCROW_EXPECTED_ADDRESS as Addr };
export const DISTRIBUTOR_NONCE = 51;

export const writeGas = (est: bigint | null) => gasLimit(est, SLICE_GAS.writeMin);
export const distributorDeployGas = (est: bigint | null) => gasLimit(est, BigInt(1_600_000));
export const escrowDeployGas = (est: bigint | null) => gasLimit(est, BigInt(1_800_000));

export const ERRORS: Record<string, string> = {
  NotPolypadToken: 'This token is not a Polypad launch.',
  NotCreator: 'Only the creator of a Polypad launch can add a slice.',
  BadDuration: 'The period must be between 30 and 365 days.',
  BadAmount: 'Minimum is 0.25% of supply',
  CapExceeded: 'A token can commit at most 5% of supply in total',
  FeeOnTransfer: 'Tokens with a transfer fee cannot be used for a slice.',
};
export const errorText = (e: any) => {
  const n = errorName(e);
  return (n && ERRORS[n]) || (n ? `Transaction would fail: ${n}` : '') || e?.shortMessage || e?.message || 'Transaction failed';
};

export const pctOf = (bps: number) => `${(bps / 100).toFixed(2).replace(/0$/, '')}%`;
export const fmtUTC = (ts: number) => new Date(ts * 1000).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });

// ---------- Copy ----------
export const NOT_LIVE = 'The airdrop slice opens when its contracts go live.';
export const NOT_CREATOR = 'Only the creator of a Polypad launch can add a slice.';
export const FOOTER = 'Distributions depend on creator opt-in and are not promised. New contracts. Security-scanned with Bevor. Not a formal audit. Scans are not audits. Not financial advice.';
export const VALUE_NOTE = 'Received tokens may have no value. This is a voluntary distribution by creators, not a return on POLYDASH. Amounts vary and can be zero.';
export const AUTOCLAIM_NOTE = 'Weekly auto-claim may send these to your wallet for you; you never have to claim.';
export const CREATE_SUB = 'Set aside a share of your token for POLYDASH stakers. It is released automatically over the period you choose.';
export const STAKER_SUB = 'Some creators give a small share of their new token to people who stake POLYDASH. If you qualify, it appears here each week. You usually don\'t need to do anything.';
export const HOW_IT_WORKS = [
  'A creator sets aside 0.25% to 1% of their token (up to 5% in total) in a locked holding account (escrow); it cannot be withdrawn.',
  'The holding account releases it evenly over 30 to 365 days; anyone can trigger a release.',
  "Every week (from Sunday 00:00 UTC), each wallet's share is based on its POLYDASH Rewards Pool stake multiplied by time staked. A stake counts after 7 days staked.",
  'The weekly list is published with its data and proposed on-chain; after a 24-hour review window it becomes claimable. The Polydash fee wallet can only cancel a pending list; nobody can move slice tokens.',
  'Claims never expire. Small remainders roll into the next week.',
];
export const PERIODS = [30, 60, 90, 180, 365];
