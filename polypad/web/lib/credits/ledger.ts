/**
 * Poly credits ledger — the data layer for Polypad's own credits system.
 * Implements spec §5.2 (~/workspace/goals/ai-agent-defi-economy-infrastructure/files/poly-credits-spec.md).
 *
 * Money is integer cents. Balances live on PolyCreditAccount (subject =
 * "key:<AgentApiKey.id>" or "wallet:<lowercase address>"); every movement
 * is recorded append-only in PolyCreditLedger (no FKs — the log survives
 * key revocation). Starter grants are one-per-wallet via PolyCreditClaim.
 * The ledger enum has no 'transfer' kind: linkKeyTransfer records a move
 * as a 'spend' row out + a 'grant' row in. Match caps are per-account
 * LIFETIME (sum of kind='match' rows); top-ups never extend expiry and
 * never revive expired balances.
 *
 * All functions return { ok: false, reason } for expected conditions and
 * never throw for them. No key value is ever logged here.
 */
import { isAddress } from "viem";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { polyCreditsConfig } from "./config";

export type LedgerKind = "grant" | "spend" | "revoke" | "expire" | "match" | "topup";

export type SpendFailureReason = "insufficient" | "expired" | "no_account";

/* ------------------------------------------------------------------ */
/* Subject helpers                                                     */
/* ------------------------------------------------------------------ */

/** Subject for an operator API key. */
export function keySubject(keyId: string): string {
  return `key:${keyId}`;
}

/** Subject for a wallet address (lowercased). */
export function walletSubject(address: string): string {
  return `wallet:${address.toLowerCase()}`;
}

function isExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt <= now;
}

function starterExpiryDate(): Date {
  return new Date(Date.now() + polyCreditsConfig.starterExpiryDays * 24 * 60 * 60 * 1000);
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/**
 * Current balance for a subject. An expired account reads as 0
 * (the account is NOT deleted — its ledger history stays intact).
 * availableCents = expired ? 0 : balanceCents. Missing account →
 * exists: false, balanceCents 0.
 */
export async function getBalance(subject: string): Promise<{
  balanceCents: number;
  availableCents: number;
  expiresAt: Date | null;
  expired: boolean;
  exists: boolean;
}> {
  const account = await prisma.polyCreditAccount.findUnique({ where: { subject } });
  if (!account) {
    return { balanceCents: 0, availableCents: 0, expiresAt: null, expired: false, exists: false };
  }
  const expired = isExpired(account.expiresAt, new Date());
  // The brief's contract: an expired account reads as 0. availableCents
  // mirrors balanceCents (spec §5.2: availableCents = expired ? 0 : balance).
  return {
    balanceCents: expired ? 0 : account.balanceCents,
    availableCents: expired ? 0 : account.balanceCents,
    expiresAt: account.expiresAt,
    expired,
    exists: true,
  };
}

/* ------------------------------------------------------------------ */
/* Grants                                                              */
/* ------------------------------------------------------------------ */

/**
 * Append a ledger row and update the account balance, inside the caller's
 * transaction. Creates the account if missing. expiresAt is set to now +
 * starterExpiryDays only when the account is NEW and reason is
 * 'starter-grant' — otherwise expiresAt is left alone, unless
 * expiresAtOnCreate is given (paid top-ups pass a fresh expiry when the
 * account is new or expired — see recordTopupPayment). An existing
 * account keeps its earlier expiry; topups/matches never extend it and
 * never revive an expired balance (except the paid-top-up path, which
 * passes expiresAtOnCreate explicitly).
 */
export async function grantCreditsTx(
  tx: Prisma.TransactionClient,
  args: {
    subject: string;
    amountCents: number;
    kind: LedgerKind;
    reason: string;
    productId?: string;
    txHash?: string;
    expiresAtOnCreate?: Date | null;
  },
): Promise<{ balanceAfterCents: number; expiresAt: Date | null }> {
  const { subject, amountCents, kind, reason, productId, txHash, expiresAtOnCreate } = args;
  const existing = await tx.polyCreditAccount.findUnique({ where: { subject } });
  // Starter expiry clock starts only on account creation. When
  // expiresAtOnCreate is given (paid top-ups), it wins — including on an
  // existing account, so a paid top-up can revive an expired account.
  const expiresAt =
    expiresAtOnCreate !== undefined
      ? expiresAtOnCreate
      : !existing
        ? reason === "starter-grant"
          ? starterExpiryDate()
          : null
        : existing.expiresAt;
  const account = await tx.polyCreditAccount.upsert({
    where: { subject },
    create: { subject, balanceCents: amountCents, expiresAt },
    update: {
      balanceCents: { increment: amountCents },
      ...(expiresAtOnCreate !== undefined ? { expiresAt: expiresAtOnCreate } : {}),
    },
  });
  await tx.polyCreditLedger.create({
    data: {
      accountId: account.id,
      kind,
      amountCents,
      balanceAfterCents: account.balanceCents,
      productId: productId ?? null,
      reason,
      txHash: txHash ?? null,
    },
  });
  return { balanceAfterCents: account.balanceCents, expiresAt: account.expiresAt };
}

/**
 * Append a ledger row and update the account balance in one transaction.
 * Creates the account if missing. expiresAt is set to now +
 * starterExpiryDays only when the account is NEW and reason is
 * 'starter-grant' — otherwise expiresAt is left alone (an existing
 * account keeps its earlier expiry; topups/matches never extend it
 * and never revive an expired balance).
 */
export async function grantCredits(args: {
  subject: string;
  amountCents: number;
  kind: LedgerKind;
  reason: string;
  productId?: string;
  txHash?: string;
}): Promise<{ ok: true; balanceAfterCents: number } | { ok: false; reason: "invalid_amount" }> {
  const { subject, amountCents, kind, reason, productId, txHash } = args;
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { ok: false, reason: "invalid_amount" };
  }
  const { balanceAfterCents } = await prisma.$transaction((tx) =>
    grantCreditsTx(tx, { subject, amountCents, kind, reason, productId, txHash }),
  );
  return { ok: true, balanceAfterCents };
}

/** Zero an account's balance and write a 'revoke' ledger row (admin only). */
export async function revokeCredits(
  subject: string,
  reason: string,
): Promise<{ ok: true; revokedCents: number } | { ok: false; reason: "no_account" | "nothing_to_revoke" }> {
  return prisma.$transaction(async (tx) => {
    const account = await tx.polyCreditAccount.findUnique({ where: { subject } });
    if (!account) return { ok: false as const, reason: "no_account" as const };
    if (account.balanceCents <= 0) return { ok: false as const, reason: "nothing_to_revoke" as const };
    const revokedCents = account.balanceCents;
    await tx.polyCreditAccount.update({ where: { subject }, data: { balanceCents: 0 } });
    await tx.polyCreditLedger.create({
      data: {
        accountId: account.id,
        kind: "revoke",
        amountCents: -revokedCents,
        balanceAfterCents: 0,
        reason,
      },
    });
    return { ok: true as const, revokedCents };
  });
}

/* ------------------------------------------------------------------ */
/* Spends (race-safe)                                                  */
/* ------------------------------------------------------------------ */

/**
 * Spend credits. RACE-SAFE: the decrement is a conditional updateMany
 * (balanceCents >= amount AND not expired) inside a transaction, and the
 * ledger row is written only if that update actually affected a row —
 * so two concurrent spends cannot both succeed on the last cent.
 */
export async function spendCredits(args: {
  subject: string;
  amountCents: number;
  productId: string;
  reason: string;
}): Promise<
  | { ok: true; balanceAfterCents: number }
  | { ok: false; reason: SpendFailureReason }
> {
  const { subject, amountCents, productId, reason } = args;
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { ok: false, reason: "insufficient" };
  }
  const now = new Date();
  const balanceAfterCents = await prisma.$transaction(async (tx) => {
    const updated = await tx.polyCreditAccount.updateMany({
      where: {
        subject,
        balanceCents: { gte: amountCents },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      data: { balanceCents: { decrement: amountCents } },
    });
    if (updated.count === 0) return null;
    const account = await tx.polyCreditAccount.findUniqueOrThrow({ where: { subject } });
    await tx.polyCreditLedger.create({
      data: {
        accountId: account.id,
        kind: "spend",
        amountCents: -amountCents,
        balanceAfterCents: account.balanceCents,
        productId,
        reason,
      },
    });
    return account.balanceCents;
  });
  if (balanceAfterCents !== null) return { ok: true, balanceAfterCents };

  // Conditional update failed — classify why (read outside the tx is fine:
  // it only decides which failure reason to report).
  const account = await prisma.polyCreditAccount.findUnique({ where: { subject } });
  if (!account) return { ok: false, reason: "no_account" };
  if (isExpired(account.expiresAt, new Date())) return { ok: false, reason: "expired" };
  return { ok: false, reason: "insufficient" };
}

/* ------------------------------------------------------------------ */
/* Starter claim (one per wallet)                                      */
/* ------------------------------------------------------------------ */

/**
 * Claim the starter grant for a wallet. Enforced one-per-wallet by the
 * PolyCreditClaim.wallet unique constraint — concurrent duplicate claims
 * hit a unique violation and return already_claimed (no double-grant).
 * Credits land on subject `key:<keyId>` when a keyId is given, else
 * `wallet:<wallet>`. keyId must resolve to an existing, unrevoked
 * AgentApiKey (validated BEFORE the transaction). `note` is the
 * applicant's "what you're building" text (trimmed, ≤500 chars,
 * empty → null); `whatBuilding` is accepted as an alias for it.
 * Claim row + account upsert + ledger row run in ONE $transaction,
 * so a failed grant never leaves a claim row behind.
 */
export async function claimStarter(args: {
  wallet: string;
  keyId?: string;
  note?: string;
  whatBuilding?: string;
}): Promise<
  | { ok: true; subject: string; amountCents: number; balanceAfterCents: number; expiresAt: Date | null }
  | { ok: false; reason: "already_claimed" | "invalid_wallet" | "invalid_key" }
> {
  const { wallet, keyId } = args;
  const note = normalizeNote(args.note ?? args.whatBuilding ?? "");
  if (!isAddress(wallet)) return { ok: false, reason: "invalid_wallet" };
  const walletLower = wallet.toLowerCase();

  // keyId must resolve to an existing, unrevoked AgentApiKey (before the tx).
  if (keyId) {
    const key = await prisma.agentApiKey.findUnique({ where: { id: keyId } });
    if (!key || key.revoked) return { ok: false, reason: "invalid_key" };
  }

  const subject = keyId ? keySubject(keyId) : walletSubject(walletLower);
  const amountCents = polyCreditsConfig.starterCents;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Unique wallet guard: the loser of a race gets P2002 and the
      // whole transaction rolls back — no claim row, no grant.
      await tx.polyCreditClaim.create({
        data: { wallet: walletLower, keyId: keyId ?? null, amountCents, note },
      });
      const existing = await tx.polyCreditAccount.findUnique({ where: { subject } });
      // Expiry starts on account creation; an existing account keeps
      // its expiry (even if earlier).
      const expiresAt = !existing ? starterExpiryDate() : existing.expiresAt;
      const account = await tx.polyCreditAccount.upsert({
        where: { subject },
        create: { subject, balanceCents: amountCents, expiresAt },
        update: { balanceCents: { increment: amountCents } },
      });
      await tx.polyCreditLedger.create({
        data: {
          accountId: account.id,
          kind: "grant",
          amountCents,
          balanceAfterCents: account.balanceCents,
          reason: "starter-grant",
        },
      });
      return { balanceAfterCents: account.balanceCents, expiresAt: account.expiresAt };
    });
    return { ok: true, subject, amountCents, ...result };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, reason: "already_claimed" };
    throw err;
  }
}

/** Trim, cap at 500 chars, empty → null (spec §3). */
function normalizeNote(raw: string): string | null {
  const trimmed = raw.trim().slice(0, 500);
  return trimmed === "" ? null : trimmed;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

/* ------------------------------------------------------------------ */
/* Topups (+ optional 1:1 match)                                       */
/* ------------------------------------------------------------------ */

/**
 * 1:1 match for a top-up, inside the caller's transaction. matchedCents =
 * min(topupCents, remaining cap), where the cap is
 * POLY_CREDITS_MATCH_CAP_CENTS TOTAL MATCHED PER ACCOUNT, LIFETIME
 * (alreadyMatchedCents = SUM(amountCents) over this account's existing
 * kind="match" ledger rows). Returns the matched cents (0 when matching is
 * off or the cap is used up). The match row is written by grantCreditsTx.
 */
async function grantMatchTx(
  tx: Prisma.TransactionClient,
  args: { accountId: string; subject: string; topupCents: number; reason: string },
): Promise<number> {
  const { accountId, subject, topupCents, reason } = args;
  if (!polyCreditsConfig.matchEnabled) return 0;
  const matched = await tx.polyCreditLedger.aggregate({
    _sum: { amountCents: true },
    where: { accountId, kind: "match" },
  });
  const matchedSoFar = matched._sum.amountCents ?? 0;
  const remaining = polyCreditsConfig.matchCapCents - matchedSoFar;
  if (remaining <= 0) return 0;
  const matchCents = Math.min(topupCents, remaining);
  await grantCreditsTx(tx, {
    subject,
    amountCents: matchCents,
    kind: "match",
    reason: `1:1 match for topup (${reason})`,
  });
  return matchCents;
}

/**
 * Grant a topup. When POLY_CREDITS_MATCH_ENABLED is on, the topup is
 * matched 1:1 — matchedCents = min(topup, remaining cap), where the cap
 * is POLY_CREDITS_MATCH_CAP_CENTS TOTAL MATCHED PER ACCOUNT, LIFETIME
 * (alreadyMatchedCents = SUM(amountCents) over this account's existing
 * kind="match" ledger rows). A top-up does NOT extend expiresAt and does
 * NOT revive an expired balance (spend/getBalance still refuse it).
 * The grant + match land in ONE transaction. Returns both amounts granted.
 */
export async function grantTopup(args: {
  subject: string;
  amountCents: number;
  reason: string;
}): Promise<
  | { ok: true; topupCents: number; matchCents: number; balanceAfterCents: number }
  | { ok: false; reason: "invalid_amount" }
> {
  const { subject, amountCents, reason } = args;
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { ok: false, reason: "invalid_amount" };
  }
  const result = await prisma.$transaction(async (tx) => {
    const topup = await grantCreditsTx(tx, { subject, amountCents, kind: "topup", reason });
    const account = await tx.polyCreditAccount.findUniqueOrThrow({ where: { subject } });
    const matchCents = await grantMatchTx(tx, { accountId: account.id, subject, topupCents: amountCents, reason });
    const after = await tx.polyCreditAccount.findUniqueOrThrow({ where: { subject } });
    return { topupCents: amountCents, matchCents, balanceAfterCents: after.balanceCents };
  });
  return { ok: true, ...result };
}

/**
 * Record a PAID top-up (ETH / POLYDASH sent to X402_PAY_TO and verified
 * on-chain by lib/credits/topup.ts). Everything lands in ONE transaction:
 * the PolyCreditTopup row (txHash @unique — a concurrent duplicate submit
 * hits P2002 and the whole transaction rolls back, so the same payment can
 * never credit twice), the 'topup' ledger row (with txHash), the optional
 * 1:1 'match' row, and the balance update.
 *
 * Expiry rule (paid top-ups only — deliberately different from the admin
 * grantTopup rule): a paid top-up sets expiresAt = now + starterExpiryDays
 * when the account is new OR expired, because paid money must always buy
 * usable credits. A live (unexpired) account keeps its existing expiry.
 */
export async function recordTopupPayment(args: {
  subject: string;
  amountCents: number;
  reason: string;
  txHash: string;
  asset: "ETH" | "POLYDASH";
  amountRaw: string;
  priceUsd: string;
  sender: string;
  blockNumber: number;
}): Promise<
  | { ok: true; topupCents: number; matchCents: number; balanceAfterCents: number }
  | { ok: false; reason: "already_credited" | "invalid_amount" }
> {
  const { subject, amountCents, reason, txHash, asset, amountRaw, priceUsd, sender, blockNumber } = args;
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { ok: false, reason: "invalid_amount" };
  }
  const txHashLower = txHash.toLowerCase();
  try {
    const result = await prisma.$transaction(async (tx) => {
      // The replay guard: unique txHash. A duplicate insert throws P2002
      // and rolls the whole transaction back — no credit, no ledger row.
      await tx.polyCreditTopup.create({
        data: {
          txHash: txHashLower,
          subject,
          asset,
          amountRaw,
          amountCents,
          priceUsd,
          sender: sender.toLowerCase(),
          blockNumber,
        },
      });
      const existing = await tx.polyCreditAccount.findUnique({ where: { subject } });
      const now = new Date();
      // Paid money must buy usable credits: new or expired accounts get a
      // fresh 180-day clock; live accounts keep their expiry.
      const expiresAtOnCreate =
        !existing || isExpired(existing.expiresAt, now) ? starterExpiryDate() : undefined;
      const topup = await grantCreditsTx(tx, {
        subject,
        amountCents,
        kind: "topup",
        reason,
        txHash: txHashLower,
        ...(expiresAtOnCreate !== undefined ? { expiresAtOnCreate } : {}),
      });
      const account = await tx.polyCreditAccount.findUniqueOrThrow({ where: { subject } });
      const matchCents = await grantMatchTx(tx, { accountId: account.id, subject, topupCents: amountCents, reason });
      const after = await tx.polyCreditAccount.findUniqueOrThrow({ where: { subject } });
      return { topupCents: amountCents, matchCents, balanceAfterCents: after.balanceCents };
    });
    return { ok: true, ...result };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, reason: "already_credited" };
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Liability + key linking                                             */
/* ------------------------------------------------------------------ */

/**
 * Sum of live balances — accounts whose expiresAt is null or in the
 * future. Expired balances are excluded (they read as 0 everywhere).
 */
export async function totalOutstandingLiability(): Promise<number> {
  const now = new Date();
  const total = await prisma.polyCreditAccount.aggregate({
    _sum: { balanceCents: true },
    where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
  });
  return total._sum.balanceCents ?? 0;
}

/**
 * Move a wallet subject's full live balance onto a key subject, in one
 * $transaction. The ledger enum has no 'transfer' kind, so the move is
 * recorded as TWO rows: source kind 'spend' (negative, reason
 * 'link-key-transfer-out') + destination kind 'grant' (positive, reason
 * 'link-key-transfer-in'). keyId must resolve to an existing, unrevoked
 * AgentApiKey (validated BEFORE the transaction). Destination expiresAt
 * becomes the earlier of the two expiries when both are set, otherwise
 * whichever is set. PolyCreditClaim.keyId is set when a claim row exists
 * for the wallet. The wallet account row stays (balance 0) — the
 * one-per-wallet claim block is unaffected. Returns the moved amount,
 * or ok:false when the wallet has no live balance.
 */
export async function linkKeyTransfer(args: {
  wallet: string;
  keyId: string;
}): Promise<
  | { ok: true; keySubject: string; movedCents: number; balanceAfterCents: number; expiresAt: Date | null }
  | { ok: false; reason: "no_wallet_balance" | "invalid_key" | "nothing_to_move" }
> {
  const { wallet, keyId } = args;
  const walletLower = wallet.toLowerCase();
  const fromSubject = walletSubject(walletLower);
  const toSubject = keySubject(keyId);
  const now = new Date();

  // keyId must resolve to an existing, unrevoked AgentApiKey (before the tx).
  const key = await prisma.agentApiKey.findUnique({ where: { id: keyId } });
  if (!key || key.revoked) return { ok: false, reason: "invalid_key" };

  return prisma.$transaction(async (tx) => {
    const from = await tx.polyCreditAccount.findUnique({ where: { subject: fromSubject } });
    if (!from) return { ok: false as const, reason: "no_wallet_balance" as const };
    if (from.balanceCents <= 0 || isExpired(from.expiresAt, now)) {
      return { ok: false as const, reason: "nothing_to_move" as const };
    }

    const amount = from.balanceCents;
    await tx.polyCreditAccount.update({
      where: { subject: fromSubject },
      data: { balanceCents: 0 },
    });
    await tx.polyCreditLedger.create({
      data: {
        accountId: from.id,
        kind: "spend",
        amountCents: -amount,
        balanceAfterCents: 0,
        reason: "link-key-transfer-out",
      },
    });

    // Destination expiry: earlier of the two when both are set,
    // otherwise whichever is set.
    const existingTo = await tx.polyCreditAccount.findUnique({ where: { subject: toSubject } });
    const destExpiresAt = earlierExpiry(existingTo?.expiresAt ?? null, from.expiresAt);
    const to = await tx.polyCreditAccount.upsert({
      where: { subject: toSubject },
      create: { subject: toSubject, balanceCents: amount, expiresAt: destExpiresAt },
      update: { balanceCents: { increment: amount }, expiresAt: destExpiresAt },
    });
    await tx.polyCreditLedger.create({
      data: {
        accountId: to.id,
        kind: "grant",
        amountCents: amount,
        balanceAfterCents: to.balanceCents,
        reason: "link-key-transfer-in",
      },
    });

    // Link the wallet's claim row to the key, when one exists.
    await tx.polyCreditClaim.updateMany({
      where: { wallet: walletLower },
      data: { keyId },
    });

    return {
      ok: true as const,
      keySubject: toSubject,
      movedCents: amount,
      balanceAfterCents: to.balanceCents,
      expiresAt: to.expiresAt,
    };
  });
}

/** Earlier of two expiries; null means "no expiry" (the other one wins). */
function earlierExpiry(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a <= b ? a : b;
}
