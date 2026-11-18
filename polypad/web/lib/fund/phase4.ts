import { parseEther } from 'viem';
import { phase3TxError } from '@/lib/fund/phase3';

type Addr = `0x${string}`;

/** Reads an address env value. Empty, malformed or zero means not set. */
export function envAddress(raw: string | undefined): Addr | null {
  const v = (raw ?? '').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(v) || /^0x0{40}$/.test(v)) return null;
  return v.toLowerCase() as Addr;
}

// Read literally so the values are inlined into the browser bundle.
export const FUND_PHASE4 = envAddress(process.env.NEXT_PUBLIC_FUND_PHASE4_ADDRESS);
export const FUND_SHARE_ACCOUNT = envAddress(process.env.NEXT_PUBLIC_FUND_SHARE_ACCOUNT_ADDRESS);

/** Phase 4 panels send nothing unless both addresses are set. */
export function phase4Live(): boolean {
  return FUND_PHASE4 !== null && FUND_SHARE_ACCOUNT !== null;
}

/** Block of the FundPhase4 creation transaction on Robinhood Chain. Offer logs are read from here. */
export const PHASE4_DEPLOY_BLOCK = 110_499_147n;
export const P4_MAX_WINDOW_DAYS = 30; // MAX_AGENT_WINDOW and MAX_BID_WINDOW, 2,592,000 s
export const P4_MIN_SEASON = 86_400; // MIN_SEASON
export const P4_MIN_BID = 10_000_000_000_000n; // 0.00001 ETH

export const P4_COPY = {
  notLive: 'Phase 4 is not live on this site yet. No Phase 4 transaction can be sent from here.',
  nfa: 'Not financial advice.',
  note: 'Phase 4 contracts on Robinhood Chain (chain id 4663). Not audited. Not financial advice.',
  cloneTip: 'This starts a new tokenized fund with the same rules as this one. Your wallet becomes the manager. You still mint the manager shares yourself. One signature.',
  agentTip: 'You can name one address that may trade inside the rules already on this tokenized fund. It cannot withdraw, and you can remove it in one signature. It stops at the time you pick, at most 30 days out.',
  cardTip: 'These are readings of net value per share. The largest drop is only the readings someone recorded, not every moment in between. Not financial advice.',
  walletOff: 'Per-share wallets are off on Robinhood Chain right now.',
  walletTip1: 'Anything in this wallet belongs to whoever holds the share. If you transfer the share, the next holder can use the wallet.',
  walletTip2: 'Leaving the tokenized fund burns the share and freezes the wallet. Move assets out before you exit or refund. Do not send the share into its own wallet.',
  offerTip: 'You lock your own ETH. The offer has to be at or below the current net value per share. The holder accepts in one signature. This is not leaving the tokenized fund. The tokenized fund does not pay anyone. The offer can fail if the value falls or the price feed does not answer. Not financial advice.',
} as const;

/** Basis points as a percent. Negative values keep a minus sign. */
export function signedPct(bps: bigint | number): string {
  const n = typeof bps === 'bigint' ? Number(bps) : bps;
  if (!Number.isFinite(n)) return '0%';
  const abs = (Math.abs(n) / 100).toFixed(2).replace(/\.?0+$/, '');
  return `${n < 0 && abs !== '0' ? '-' : ''}${abs}%`;
}

/**
 * Days from now to a unix end time. Accepts decimals (0.5 = 12 hours).
 * Returns an error message when it is outside (0, 30] days.
 */
export function endTimeFromDays(raw: string, now: number): { end: number | null; error?: string } {
  const t = raw.trim();
  if (!t) return { end: null, error: 'Enter how many days from now.' };
  if (!/^\d+(\.\d+)?$/.test(t)) return { end: null, error: 'Enter a number of days, like 7 or 0.5.' };
  const days = Number(t);
  if (days <= 0) return { end: null, error: 'Pick a time after now.' };
  if (days > P4_MAX_WINDOW_DAYS) return { end: null, error: `Pick ${P4_MAX_WINDOW_DAYS} days or fewer.` };
  return { end: now + Math.floor(days * 86_400) };
}

/** Optional ETH amount. Empty means 0. */
export function optionalEth(raw: string): { wei: bigint | null; error?: string } {
  const t = raw.trim();
  if (!t) return { wei: 0n };
  if (!/^\d+(\.\d{1,18})?$/.test(t)) return { wei: null, error: 'Enter an amount like 0.5, or leave it empty.' };
  try { return { wei: parseEther(t) }; } catch { return { wei: null, error: 'That amount does not work.' }; }
}

/** Validates an offer amount against the contract minimum and the current net value per share. */
export function offerAmountIssue(wei: bigint | null, navPerShare: bigint | null): string | undefined {
  if (wei === null || wei === 0n) return 'Enter an ETH amount.';
  if (wei < P4_MIN_BID) return 'The smallest offer is 0.00001 ETH.';
  if (navPerShare !== null && wei > navPerShare) return 'The offer must be at or below the current net value per share.';
  return undefined;
}

export function canCloseSeason(openedAt: number, now: number): boolean {
  return openedAt > 0 && now > 0 && now >= openedAt + P4_MIN_SEASON;
}

const ERRORS: Record<string, string> = {
  abovenav: 'The offer is above the current net value per share.',
  amountcap: 'That trade is larger than the limit set for the agent.',
  badagent: 'That agent address does not work. Use a normal wallet address that is not the vault or this contract.',
  badexpiry: 'Pick an end time after now and at most 30 days out.',
  badindex: 'That card does not exist.',
  bidsmall: 'The smallest offer is 0.00001 ETH.',
  expired: 'This has already ended.',
  gatenotexecutor: 'Do step 1 first: let the gate trade on the vault.',
  invalidparams: 'Some values are outside the factory limits. Check the name, price, goal, fee, stake and raise length.',
  nobid: 'This offer is no longer open.',
  nogrant: 'There is no agent on this tokenized fund.',
  notbidder: 'Only the wallet that placed the offer can cancel it before the end time.',
  notexpired: 'Wait until the end time.',
  notfund: 'This is not a Phase 3 tokenized fund.',
  notholder: 'Only the wallet holding this share can do that.',
  notinvesting: 'This only works after the tokenized fund starts investing.',
  notmanager: 'Only the tokenized fund manager can do that.',
  payfailed: 'The ETH transfer failed.',
  registryabsent: 'Per-share wallets are off on Robinhood Chain right now.',
  seasonstate: 'A card is already open, or there is no open card, or one day has not passed yet.',
  selfbid: 'You cannot place an offer on a share you hold.',
  tooearly: 'Too early. Wait a little and try again.',
  walletloop: 'A share cannot be sent into its own wallet, and its wallet cannot place offers.',
  skinlocked: 'This share is still in the manager lock. The offer stays open until it is cancelled.',
  transferfailed: 'The share could not move. The holder may need to approve this contract first.',
  erc721insufficientapproval: 'The holder must approve this contract for that share first.',
};

export function phase4TxError(message: string): string {
  const m = message.toLowerCase();
  for (const key of Object.keys(ERRORS)) if (m.includes(key)) return ERRORS[key];
  return phase3TxError(message);
}
