// Agent-earn fee math — pure functions, no chain reads.
// The fee is taken from the AGENT's share at settlement, at the bps
// snapshotted into the lock at lock time (feeBpsAtLock). Never compute it
// from the live feeBps view: a mid-job fee change cannot alter a locked
// job's split (brief §2.1). Integer math throughout, same as the contract's
// _feeOn: fee = share * bps / 10_000 (rounds down, like Solidity).

import {
  AGENT_EARN_BPS_DENOMINATOR,
  AGENT_EARN_TOKEN_DECIMALS,
} from './constants';

export interface PayoutSplit {
  /** Gross agent share before the fee (USDG smallest units). */
  gross: bigint;
  /** Fee taken from the agent's share (0 on no-pay / refund). */
  fee: bigint;
  /** What the agent actually receives. */
  net: bigint;
}

/** Fee on a gross agent share at the lock-time bps. */
export function feeOn(gross: bigint, feeBpsAtLock: number): bigint {
  if (feeBpsAtLock === 0 || gross <= 0n) return 0n;
  return (gross * BigInt(feeBpsAtLock)) / BigInt(AGENT_EARN_BPS_DENOMINATOR);
}

/** Net payout for a gross agent share at the lock-time bps. */
export function netPayout(gross: bigint, feeBpsAtLock: number): PayoutSplit {
  const fee = feeOn(gross, feeBpsAtLock);
  return { gross, fee, net: gross - fee };
}

/** Whole dollars → USDG smallest units (6 decimals). */
export function usdToUsdgUnits(usd: number): bigint {
  return BigInt(Math.round(usd * 10 ** AGENT_EARN_TOKEN_DECIMALS));
}

/** USDG smallest units → whole dollars (exact when the amount is whole). */
export function usdgUnitsToUsd(units: bigint): number {
  return Number(units) / 10 ** AGENT_EARN_TOKEN_DECIMALS;
}

/** Format USDG smallest units as a dollar figure, e.g. "$9.75". */
export function formatUsdg(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / 10n ** BigInt(AGENT_EARN_TOKEN_DECIMALS);
  const frac = abs % 10n ** BigInt(AGENT_EARN_TOKEN_DECIMALS);
  const fracStr = frac.toString().padStart(AGENT_EARN_TOKEN_DECIMALS, '0').slice(0, 2);
  return `${negative ? '-' : ''}$${whole.toString()}.${fracStr}`;
}

/** Format USDG smallest units with full 6-decimal precision, e.g. "$9.750000". */
export function formatUsdgExact(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / 10n ** BigInt(AGENT_EARN_TOKEN_DECIMALS);
  const frac = abs % 10n ** BigInt(AGENT_EARN_TOKEN_DECIMALS);
  return `${negative ? '-' : ''}$${whole.toString()}.${frac.toString().padStart(AGENT_EARN_TOKEN_DECIMALS, '0')}`;
}

/** The panel split rules (contract panelResolve): PayFull needs 10_000,
 * NoPay needs 0, PayPart needs 1..9_999 with both shares > 0. Returns the
 * reason the split is invalid, or null when it is valid. */
export function validatePanelSplit(
  outcome: 'PayFull' | 'PayPart' | 'NoPay',
  splitBps: number,
  amount: bigint,
): string | null {
  if (outcome === 'PayFull' && splitBps !== AGENT_EARN_BPS_DENOMINATOR) {
    return 'Pay in full needs a 100% split.';
  }
  if (outcome === 'NoPay' && splitBps !== 0) {
    return 'Pay nothing needs a 0% split.';
  }
  if (outcome === 'PayPart') {
    if (splitBps <= 0 || splitBps >= AGENT_EARN_BPS_DENOMINATOR) {
      return 'A partial payment needs a split between 1% and 99%.';
    }
    const agentShare = (amount * BigInt(splitBps)) / BigInt(AGENT_EARN_BPS_DENOMINATOR);
    if (agentShare === 0n || amount - agentShare === 0n) {
      return 'A partial payment must leave something for both sides.';
    }
  }
  return null;
}

/** Seconds left in the 72h dispute window from a delivery timestamp. */
export function disputeSecondsLeft(deliveredAtSeconds: number, nowSeconds = Math.floor(Date.now() / 1000)): number {
  return deliveredAtSeconds + 72 * 3600 - nowSeconds;
}

/** Plain-language countdown, e.g. "2d 4h left" / "expired". */
export function formatCountdown(secondsLeft: number): string {
  if (secondsLeft <= 0) return 'expired';
  const d = Math.floor(secondsLeft / 86400);
  const h = Math.floor((secondsLeft % 86400) / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}
