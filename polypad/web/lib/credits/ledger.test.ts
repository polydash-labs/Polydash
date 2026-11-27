import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { randomBytes, createHash } from 'node:crypto';
import dotenv from 'dotenv';
import { parseEther } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { prisma } from '@/lib/db';
import { polyCreditsConfig } from './config';
import {
  claimStarter,
  getBalance,
  grantCredits,
  grantTopup,
  keySubject,
  linkKeyTransfer,
  recordTopupPayment,
  revokeCredits,
  spendCredits,
  totalOutstandingLiability,
  walletSubject,
} from './ledger';

// Loads DATABASE_URL for the integration tests (run from the repo root).
dotenv.config({ path: '.env.local' });

const DAY_MS = 24 * 60 * 60 * 1000;
const STARTER_CENTS = polyCreditsConfig.starterCents;
const STARTER_DAYS = polyCreditsConfig.starterExpiryDays;

// ---------------------------------------------------------------------------
// Run-scoped fixtures + cleanup
// ---------------------------------------------------------------------------

const runId = randomBytes(4).toString('hex');
const subjects = new Set<string>();
const wallets = new Set<string>();
const txHashes = new Set<string>();
const keyIds = new Set<string>();

function trackSubject(subject: string): string {
  subjects.add(subject);
  return subject;
}

/** A fresh throwaway wallet address (never funded, never used on-chain). */
function newWallet(): string {
  const address = privateKeyToAccount(generatePrivateKey()).address;
  wallets.add(address.toLowerCase());
  return address;
}

function newWalletSubject(): string {
  return trackSubject(walletSubject(newWallet()));
}

/** A synthetic key subject — no AgentApiKey row needed (no key validation on this path). */
function newKeySubject(): string {
  return trackSubject(keySubject(`test-${runId}-${randomBytes(4).toString('hex')}`));
}

function freshTxHash(): string {
  const hash = `0x${randomBytes(32).toString('hex')}`;
  txHashes.add(hash);
  return hash;
}

/** A real AgentApiKey row (random keyHash, never a real key) for claim/link paths. */
async function makeTestKey(): Promise<string> {
  const key = await prisma.agentApiKey.create({
    data: {
      keyHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
      prefix: 'test_',
      agentName: 'poly-credits-test',
      operatorUrl: 'https://example.invalid',
    },
  });
  keyIds.add(key.id);
  return key.id;
}

async function ledgerRows(accountSubject: string) {
  const account = await prisma.polyCreditAccount.findUnique({ where: { subject: accountSubject } });
  assert.ok(account, `expected account ${accountSubject} to exist`);
  return prisma.polyCreditLedger.findMany({
    where: { accountId: account!.id },
    orderBy: { id: 'asc' },
  });
}

/** Assert an expiry is ~now + `days` (within 2 minutes — clock skew + test time). */
function assertExpiryAround(expiresAt: Date | null, days: number, label = 'expiresAt') {
  assert.ok(expiresAt, `${label} should be set`);
  const expected = Date.now() + days * DAY_MS;
  assert.ok(
    Math.abs(expiresAt!.getTime() - expected) < 120_000,
    `${label} ${expiresAt!.toISOString()} is not ~${days}d from now`,
  );
}

after(async () => {
  // Best-effort cleanup of every row this file created, so the shared DB
  // stays clean even if a test fails midway. Order: topups, ledger rows,
  // accounts, claims, test keys.
  try {
    await prisma.polyCreditTopup.deleteMany({ where: { txHash: { in: [...txHashes] } } });
    const accounts = await prisma.polyCreditAccount.findMany({
      where: { subject: { in: [...subjects] } },
      select: { id: true },
    });
    if (accounts.length) {
      await prisma.polyCreditLedger.deleteMany({
        where: { accountId: { in: accounts.map((a) => a.id) } },
      });
    }
    await prisma.polyCreditAccount.deleteMany({ where: { subject: { in: [...subjects] } } });
    await prisma.polyCreditClaim.deleteMany({ where: { wallet: { in: [...wallets] } } });
    await prisma.agentApiKey.deleteMany({ where: { id: { in: [...keyIds] } } });
  } catch (e) {
    console.error('ledger.test.ts cleanup failed:', e instanceof Error ? e.message : e);
  }
});

// ---------------------------------------------------------------------------
// Reads + grants
// ---------------------------------------------------------------------------

test('env: DATABASE_URL is set (integration tests need the Neon DB)', () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is not set — is .env.local present?');
});

test('getBalance on a missing account reports exists:false with zero balances', async () => {
  const res = await getBalance(newWalletSubject());
  assert.deepEqual(res, {
    balanceCents: 0,
    availableCents: 0,
    expiresAt: null,
    expired: false,
    exists: false,
  });
});

test('grantCredits: invalid amounts rejected, valid grant lands + ledger row', async () => {
  const subject = newKeySubject();
  assert.deepEqual(await grantCredits({ subject, amountCents: 0, kind: 'grant', reason: 't' }), {
    ok: false,
    reason: 'invalid_amount',
  });
  assert.deepEqual(await grantCredits({ subject, amountCents: -5, kind: 'grant', reason: 't' }), {
    ok: false,
    reason: 'invalid_amount',
  });
  assert.deepEqual(await grantCredits({ subject, amountCents: 1.5, kind: 'grant', reason: 't' }), {
    ok: false,
    reason: 'invalid_amount',
  });
  const res = await grantCredits({ subject, amountCents: 100, kind: 'grant', reason: 'test-grant' });
  assert.deepEqual(res, { ok: true, balanceAfterCents: 100 });
  assert.equal((await getBalance(subject)).balanceCents, 100);
  const rows = await ledgerRows(subject);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.kind, 'grant');
  assert.equal(rows[0]?.amountCents, 100);
  assert.equal(rows[0]?.balanceAfterCents, 100);
});

test('grantCredits on a new account with a non-starter reason sets no expiry', async () => {
  const subject = newKeySubject();
  await grantCredits({ subject, amountCents: 10, kind: 'grant', reason: 'test-grant' });
  const account = await prisma.polyCreditAccount.findUnique({ where: { subject } });
  assert.equal(account?.expiresAt, null);
});

// ---------------------------------------------------------------------------
// Spends (race-safe)
// ---------------------------------------------------------------------------

test('spendCredits: 100 - 1 = 99 with a spend ledger row', async () => {
  const subject = newKeySubject();
  await grantCredits({ subject, amountCents: 100, kind: 'grant', reason: 'test-grant' });
  const res = await spendCredits({ subject, amountCents: 1, productId: 'token-report', reason: 'test-spend' });
  assert.deepEqual(res, { ok: true, balanceAfterCents: 99 });
  assert.equal((await getBalance(subject)).balanceCents, 99);
  const rows = await ledgerRows(subject);
  assert.equal(rows.length, 2);
  assert.equal(rows[1]?.kind, 'spend');
  assert.equal(rows[1]?.amountCents, -1);
  assert.equal(rows[1]?.balanceAfterCents, 99);
  assert.equal(rows[1]?.productId, 'token-report');
});

test('spendCredits: spending more than the balance fails and writes no ledger row', async () => {
  const subject = newKeySubject();
  await grantCredits({ subject, amountCents: 100, kind: 'grant', reason: 'test-grant' });
  await spendCredits({ subject, amountCents: 1, productId: 'token-report', reason: 'test-spend' });
  const before = await ledgerRows(subject);
  const res = await spendCredits({ subject, amountCents: 200, productId: 'token-report', reason: 'test-spend' });
  assert.deepEqual(res, { ok: false, reason: 'insufficient' });
  assert.equal((await getBalance(subject)).balanceCents, 99);
  assert.equal((await ledgerRows(subject)).length, before.length);
});

test('spendCredits: missing account -> no_account, zero/negative amount -> insufficient', async () => {
  assert.deepEqual(
    await spendCredits({ subject: newKeySubject(), amountCents: 1, productId: 'token-report', reason: 't' }),
    { ok: false, reason: 'no_account' },
  );
  const subject = newKeySubject();
  await grantCredits({ subject, amountCents: 10, kind: 'grant', reason: 'test-grant' });
  assert.deepEqual(
    await spendCredits({ subject, amountCents: 0, productId: 'token-report', reason: 't' }),
    { ok: false, reason: 'insufficient' },
  );
  assert.equal((await getBalance(subject)).balanceCents, 10);
});

test('spendCredits: expired account -> expired, and getBalance reads 0', async () => {
  const subject = newKeySubject();
  await grantCredits({ subject, amountCents: 100, kind: 'grant', reason: 'test-grant' });
  await prisma.polyCreditAccount.update({
    where: { subject },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });
  const res = await spendCredits({ subject, amountCents: 1, productId: 'token-report', reason: 't' });
  assert.deepEqual(res, { ok: false, reason: 'expired' });
  const balance = await getBalance(subject);
  assert.equal(balance.expired, true);
  assert.equal(balance.availableCents, 0);
  assert.equal(balance.balanceCents, 0);
  assert.equal((await ledgerRows(subject)).length, 1); // no spend row written
});

test('spendCredits: two concurrent spends of 60 on 100 — exactly one succeeds', async () => {
  const subject = newKeySubject();
  await grantCredits({ subject, amountCents: 100, kind: 'grant', reason: 'test-grant' });
  const [a, b] = await Promise.all([
    spendCredits({ subject, amountCents: 60, productId: 'token-report', reason: 'race' }),
    spendCredits({ subject, amountCents: 60, productId: 'token-report', reason: 'race' }),
  ]);
  const oks = [a, b].filter((r) => r.ok);
  const fails = [a, b].filter((r) => !r.ok && r.reason === 'insufficient');
  assert.equal(oks.length, 1);
  assert.equal(fails.length, 1);
  assert.equal((await getBalance(subject)).balanceCents, 40);
  assert.equal((await ledgerRows(subject)).filter((r) => r.kind === 'spend').length, 1);
});

// ---------------------------------------------------------------------------
// Starter claims (one per wallet)
// ---------------------------------------------------------------------------

test('claimStarter: first claim ok with starter amount + expiry; second -> already_claimed', async () => {
  const wallet = newWallet();
  const first = await claimStarter({ wallet });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.subject, walletSubject(wallet));
  assert.equal(first.amountCents, STARTER_CENTS);
  assert.equal(first.balanceAfterCents, STARTER_CENTS);
  assertExpiryAround(first.expiresAt, STARTER_DAYS);
  const second = await claimStarter({ wallet });
  assert.deepEqual(second, { ok: false, reason: 'already_claimed' });
  assert.equal((await getBalance(walletSubject(wallet))).balanceCents, STARTER_CENTS);
  const claims = await prisma.polyCreditClaim.findMany({ where: { wallet: wallet.toLowerCase() } });
  assert.equal(claims.length, 1);
});

test('claimStarter: two simultaneous claims — exactly one succeeds, no double-grant', async () => {
  const wallet = newWallet();
  const [a, b] = await Promise.all([claimStarter({ wallet }), claimStarter({ wallet })]);
  const oks = [a, b].filter((r) => r.ok);
  const dups = [a, b].filter((r) => !r.ok && r.reason === 'already_claimed');
  assert.equal(oks.length, 1);
  assert.equal(dups.length, 1);
  assert.equal((await getBalance(walletSubject(wallet))).balanceCents, STARTER_CENTS);
  const claims = await prisma.polyCreditClaim.findMany({ where: { wallet: wallet.toLowerCase() } });
  assert.equal(claims.length, 1);
});

test('claimStarter: invalid wallet rejected; note is trimmed to 500 chars', async () => {
  assert.deepEqual(await claimStarter({ wallet: 'not-an-address' }), {
    ok: false,
    reason: 'invalid_wallet',
  });
  const wallet = newWallet();
  const res = await claimStarter({ wallet, note: `x`.repeat(600) });
  assert.equal(res.ok, true);
  const claim = await prisma.polyCreditClaim.findUnique({ where: { wallet: wallet.toLowerCase() } });
  assert.equal(claim?.note?.length, 500);
});

test('claimStarter: key path credits key:<id> and links the claim; bad key rejected', async () => {
  const keyId = await makeTestKey();
  const wallet = newWallet();
  const res = await claimStarter({ wallet, keyId });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.subject, keySubject(keyId));
  assert.equal(res.amountCents, STARTER_CENTS);
  const claim = await prisma.polyCreditClaim.findUnique({ where: { wallet: wallet.toLowerCase() } });
  assert.equal(claim?.keyId, keyId);
  // The same wallet cannot claim again, even without a key.
  assert.deepEqual(await claimStarter({ wallet }), { ok: false, reason: 'already_claimed' });

  const otherWallet = newWallet();
  assert.deepEqual(await claimStarter({ wallet: otherWallet, keyId: 'cmissingkey00000000000000' }), {
    ok: false,
    reason: 'invalid_key',
  });
  assert.equal(
    await prisma.polyCreditClaim.findUnique({ where: { wallet: otherWallet.toLowerCase() } }),
    null,
  );
});

// ---------------------------------------------------------------------------
// Top-ups (+ optional 1:1 match)
// ---------------------------------------------------------------------------

test('grantTopup with matching off credits the top-up only, no match row', async () => {
  const cfg = polyCreditsConfig as unknown as { matchEnabled: boolean };
  const prev = cfg.matchEnabled;
  cfg.matchEnabled = false;
  try {
    const subject = newKeySubject();
    const res = await grantTopup({ subject, amountCents: 500, reason: 'test-topup' });
    assert.deepEqual(res, { ok: true, topupCents: 500, matchCents: 0, balanceAfterCents: 500 });
    assert.equal((await ledgerRows(subject)).filter((r) => r.kind === 'match').length, 0);
  } finally {
    cfg.matchEnabled = prev;
  }
});

test('grantTopup with matching on: match = min(topup, cap - alreadyMatched), lifetime', async () => {
  // polyCreditsConfig is `as const` (compile-time readonly) but the runtime
  // object is not frozen, so the test can override it and restore it.
  const cfg = polyCreditsConfig as unknown as { matchEnabled: boolean; matchCapCents: number };
  const prevEnabled = cfg.matchEnabled;
  const prevCap = cfg.matchCapCents;
  cfg.matchEnabled = true;
  cfg.matchCapCents = 300;
  try {
    const subject = newKeySubject();
    // Top-up 500 with a 300 cap: match is capped at 300.
    const first = await grantTopup({ subject, amountCents: 500, reason: 'test-topup' });
    assert.deepEqual(first, { ok: true, topupCents: 500, matchCents: 300, balanceAfterCents: 800 });
    const matchRows = (await ledgerRows(subject)).filter((r) => r.kind === 'match');
    assert.equal(matchRows.length, 1);
    assert.equal(matchRows[0]?.amountCents, 300);
    // Cap is lifetime: a second top-up on the same account matches 0.
    const second = await grantTopup({ subject, amountCents: 500, reason: 'test-topup-2' });
    assert.deepEqual(second, { ok: true, topupCents: 500, matchCents: 0, balanceAfterCents: 1300 });
    // A fresh account with a top-up under the cap matches 1:1.
    const other = newKeySubject();
    const third = await grantTopup({ subject: other, amountCents: 100, reason: 'test-topup' });
    assert.deepEqual(third, { ok: true, topupCents: 100, matchCents: 100, balanceAfterCents: 200 });
  } finally {
    cfg.matchEnabled = prevEnabled;
    cfg.matchCapCents = prevCap;
  }
});

test('grantTopup: invalid amount rejected', async () => {
  assert.deepEqual(await grantTopup({ subject: newKeySubject(), amountCents: 0, reason: 't' }), {
    ok: false,
    reason: 'invalid_amount',
  });
});

// ---------------------------------------------------------------------------
// Paid top-ups: idempotency + expiry
// ---------------------------------------------------------------------------

function topupArgs(subject: string, txHash: string, amountCents = 1000) {
  return {
    subject,
    amountCents,
    reason: 'test-paid-topup',
    txHash,
    asset: 'ETH' as const,
    amountRaw: parseEther('0.01').toString(),
    priceUsd: '2000',
    sender: newWallet(),
    blockNumber: 123,
  };
}

test('recordTopupPayment: same txHash twice -> second already_credited, one credit only', async () => {
  const subject = newKeySubject();
  const txHash = freshTxHash();
  const first = await recordTopupPayment(topupArgs(subject, txHash));
  assert.deepEqual(first, { ok: true, topupCents: 1000, matchCents: 0, balanceAfterCents: 1000 });
  const second = await recordTopupPayment(topupArgs(subject, txHash));
  assert.deepEqual(second, { ok: false, reason: 'already_credited' });
  assert.equal((await getBalance(subject)).balanceCents, 1000);
  const rows = await prisma.polyCreditTopup.findMany({ where: { txHash: txHash.toLowerCase() } });
  assert.equal(rows.length, 1);
  assert.equal((await ledgerRows(subject)).filter((r) => r.kind === 'topup').length, 1);
});

test('recordTopupPayment: two concurrent submits of one payment credit exactly once', async () => {
  const subject = newKeySubject();
  const txHash = freshTxHash();
  const [a, b] = await Promise.all([
    recordTopupPayment(topupArgs(subject, txHash)),
    recordTopupPayment(topupArgs(subject, txHash)),
  ]);
  const oks = [a, b].filter((r) => r.ok);
  const dups = [a, b].filter((r) => !r.ok && r.reason === 'already_credited');
  assert.equal(oks.length, 1);
  assert.equal(dups.length, 1);
  assert.equal((await getBalance(subject)).balanceCents, 1000);
  const rows = await prisma.polyCreditTopup.findMany({ where: { txHash: txHash.toLowerCase() } });
  assert.equal(rows.length, 1);
});

test('recordTopupPayment: new account gets expiry ~now + starter days', async () => {
  const subject = newKeySubject();
  const res = await recordTopupPayment(topupArgs(subject, freshTxHash()));
  assert.equal(res.ok, true);
  const account = await prisma.polyCreditAccount.findUnique({ where: { subject } });
  assertExpiryAround(account?.expiresAt ?? null, STARTER_DAYS);
});

test('recordTopupPayment: expired account is revived to ~now + starter days', async () => {
  const subject = newKeySubject();
  await grantCredits({ subject, amountCents: 50, kind: 'grant', reason: 'test-grant' });
  await prisma.polyCreditAccount.update({
    where: { subject },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });
  const res = await recordTopupPayment(topupArgs(subject, freshTxHash()));
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.balanceAfterCents, 1050);
  const account = await prisma.polyCreditAccount.findUnique({ where: { subject } });
  assertExpiryAround(account?.expiresAt ?? null, STARTER_DAYS);
  assert.equal((await getBalance(subject)).expired, false);
});

test('recordTopupPayment: live account keeps its existing expiry', async () => {
  const wallet = newWallet();
  const claimed = await claimStarter({ wallet });
  assert.equal(claimed.ok, true);
  if (!claimed.ok) return;
  const subject = claimed.subject;
  trackSubject(subject);
  const before = await prisma.polyCreditAccount.findUnique({ where: { subject } });
  assert.ok(before?.expiresAt);
  const res = await recordTopupPayment(topupArgs(subject, freshTxHash()));
  assert.equal(res.ok, true);
  const after = await prisma.polyCreditAccount.findUnique({ where: { subject } });
  assert.equal(after?.expiresAt?.getTime(), before?.expiresAt?.getTime());
});

test('recordTopupPayment: invalid amount rejected', async () => {
  assert.deepEqual(
    await recordTopupPayment({ ...topupArgs(newKeySubject(), freshTxHash()), amountCents: 0 }),
    { ok: false, reason: 'invalid_amount' },
  );
});

// ---------------------------------------------------------------------------
// Revoke + liability
// ---------------------------------------------------------------------------

test('revokeCredits zeroes the balance with a revoke row; second revoke -> nothing_to_revoke', async () => {
  const subject = newKeySubject();
  assert.deepEqual(await revokeCredits(subject, 'test'), { ok: false, reason: 'no_account' });
  await grantCredits({ subject, amountCents: 100, kind: 'grant', reason: 'test-grant' });
  const res = await revokeCredits(subject, 'test-revoke');
  assert.deepEqual(res, { ok: true, revokedCents: 100 });
  assert.equal((await getBalance(subject)).balanceCents, 0);
  const rows = await ledgerRows(subject);
  const revokeRow = rows.find((r) => r.kind === 'revoke');
  assert.ok(revokeRow);
  assert.equal(revokeRow?.amountCents, -100);
  assert.equal(revokeRow?.balanceAfterCents, 0);
  assert.deepEqual(await revokeCredits(subject, 'test-revoke-2'), {
    ok: false,
    reason: 'nothing_to_revoke',
  });
});

test('totalOutstandingLiability counts live balances only, not expired ones', async () => {
  const before = await totalOutstandingLiability();
  const subject = newKeySubject();
  await grantCredits({ subject, amountCents: 700, kind: 'grant', reason: 'test-grant' });
  assert.equal((await totalOutstandingLiability()) - before, 700);
  // Expiring the account removes it from the liability.
  await prisma.polyCreditAccount.update({
    where: { subject },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });
  assert.equal(await totalOutstandingLiability(), before);
});

// ---------------------------------------------------------------------------
// Key linking
// ---------------------------------------------------------------------------

test('linkKeyTransfer moves the whole wallet balance to the key (two ledger rows)', async () => {
  const wallet = newWallet();
  const claimed = await claimStarter({ wallet });
  assert.equal(claimed.ok, true);
  if (!claimed.ok) return;
  const fromSubject = walletSubject(wallet);
  trackSubject(fromSubject);
  const keyId = await makeTestKey();
  const toSubject = trackSubject(keySubject(keyId));

  const res = await linkKeyTransfer({ wallet, keyId });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.keySubject, toSubject);
  assert.equal(res.movedCents, STARTER_CENTS);
  assert.equal(res.balanceAfterCents, STARTER_CENTS);
  assert.equal((await getBalance(fromSubject)).balanceCents, 0);
  assert.equal((await getBalance(toSubject)).balanceCents, STARTER_CENTS);

  const outRows = await ledgerRows(fromSubject);
  const outRow = outRows.find((r) => r.reason === 'link-key-transfer-out');
  assert.ok(outRow);
  assert.equal(outRow?.kind, 'spend');
  assert.equal(outRow?.amountCents, -STARTER_CENTS);
  assert.equal(outRow?.balanceAfterCents, 0);
  const inRows = await ledgerRows(toSubject);
  const inRow = inRows.find((r) => r.reason === 'link-key-transfer-in');
  assert.ok(inRow);
  assert.equal(inRow?.kind, 'grant');
  assert.equal(inRow?.amountCents, STARTER_CENTS);

  // The claim row is linked to the key.
  const claim = await prisma.polyCreditClaim.findUnique({ where: { wallet: wallet.toLowerCase() } });
  assert.equal(claim?.keyId, keyId);
  // The wallet account keeps the wallet's expiry on the key account.
  assert.equal(res.expiresAt?.getTime(), claimed.expiresAt?.getTime());

  // Nothing left to move.
  assert.deepEqual(await linkKeyTransfer({ wallet, keyId }), {
    ok: false,
    reason: 'nothing_to_move',
  });
});

test('linkKeyTransfer: missing wallet -> no_wallet_balance, bad key -> invalid_key', async () => {
  const keyId = await makeTestKey();
  assert.deepEqual(await linkKeyTransfer({ wallet: newWallet(), keyId }), {
    ok: false,
    reason: 'no_wallet_balance',
  });
  const wallet = newWallet();
  await claimStarter({ wallet });
  assert.deepEqual(await linkKeyTransfer({ wallet, keyId: 'cmissingkey00000000000000' }), {
    ok: false,
    reason: 'invalid_key',
  });
});

test('linkKeyTransfer: expired wallet balance cannot move', async () => {
  const wallet = newWallet();
  const claimed = await claimStarter({ wallet });
  assert.equal(claimed.ok, true);
  if (!claimed.ok) return;
  trackSubject(walletSubject(wallet));
  await prisma.polyCreditAccount.update({
    where: { subject: walletSubject(wallet) },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });
  const keyId = await makeTestKey();
  trackSubject(keySubject(keyId));
  assert.deepEqual(await linkKeyTransfer({ wallet, keyId }), {
    ok: false,
    reason: 'nothing_to_move',
  });
});
