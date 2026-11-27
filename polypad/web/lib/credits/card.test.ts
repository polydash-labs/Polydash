import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { prisma } from '@/lib/db';
import { polyCreditsConfig } from './config';
import { getBalance, recordCardTopupPayment, walletSubject } from './ledger';
import {
  CARD_TOPUP_PACKS,
  cardPackLabel,
  isCardPackCents,
  recordCardTopupFromSession,
} from './card';

// Loads DATABASE_URL for the integration tests (run from the repo root).
dotenv.config({ path: '.env.local' });

const runId = randomBytes(4).toString('hex');
const subjects = new Set<string>();
const sessionIds = new Set<string>();

function trackSubject(subject: string): string {
  subjects.add(subject);
  return subject;
}

function newWalletSubject(): string {
  const address = privateKeyToAccount(generatePrivateKey()).address;
  return trackSubject(walletSubject(address.toLowerCase()));
}

function newSessionId(): string {
  const id = `cs_test_cardtest_${runId}_${randomBytes(6).toString('hex')}`;
  sessionIds.add(id);
  return id;
}

function fakeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: newSessionId(),
    payment_status: 'paid',
    amount_total: 2500,
    payment_intent: `pi_test_${runId}_${randomBytes(4).toString('hex')}`,
    customer_details: { email: 'buyer@example.com' },
    metadata: { kind: 'poly-credits-card-topup', subject: newWalletSubject(), packCents: '2500' },
    ...overrides,
  } as unknown as Parameters<typeof recordCardTopupFromSession>[0];
}

after(async () => {
  // Best-effort cleanup of every row this file created. Order: card
  // top-ups, ledger rows, accounts.
  try {
    await prisma.polyCreditCardTopup.deleteMany({
      where: { stripeSessionId: { in: [...sessionIds] } },
    });
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
  } catch (e) {
    console.error('card.test.ts cleanup failed:', e instanceof Error ? e.message : e);
  }
});

// ---------------------------------------------------------------------------
// Packs (pure)
// ---------------------------------------------------------------------------

test('card packs: exactly $25/$50/$100, 100c = $1, no surcharge', () => {
  assert.deepEqual(
    CARD_TOPUP_PACKS.map((p) => p.amountCents),
    [2500, 5000, 10000],
  );
  for (const pack of CARD_TOPUP_PACKS) {
    assert.ok(isCardPackCents(pack.amountCents));
  }
  assert.equal(isCardPackCents(2500), true);
  assert.equal(isCardPackCents(5000), true);
  assert.equal(isCardPackCents(10000), true);
  assert.equal(isCardPackCents(100), false);
  assert.equal(isCardPackCents(0), false);
  assert.equal(isCardPackCents('2500'), false);
  assert.equal(cardPackLabel(2500), '$25 — 2,500 credits');
  assert.equal(cardPackLabel(10000), '$100 — 10,000 credits');
});

// ---------------------------------------------------------------------------
// recordCardTopupFromSession validation (no DB writes on rejection)
// ---------------------------------------------------------------------------

test('card session: wrong kind is not a card top-up', async () => {
  const res = await recordCardTopupFromSession(
    fakeSession({ metadata: { kind: 'something-else', subject: newWalletSubject(), packCents: '2500' } }),
  );
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'not_a_card_topup');
});

test('card session: unpaid session is not credited', async () => {
  const res = await recordCardTopupFromSession(fakeSession({ payment_status: 'unpaid' }));
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'not_paid');
});

test('card session: amount_total must equal the pack', async () => {
  const res = await recordCardTopupFromSession(fakeSession({ amount_total: 2600 }));
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'amount_mismatch');
});

test('card session: unknown pack in metadata is rejected', async () => {
  const res = await recordCardTopupFromSession(
    fakeSession({ metadata: { kind: 'poly-credits-card-topup', subject: newWalletSubject(), packCents: '9999' } }),
  );
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'not_a_card_topup');
});

// ---------------------------------------------------------------------------
// recordCardTopupPayment (integration, Neon)
// ---------------------------------------------------------------------------

test('env: DATABASE_URL is set (integration tests need the Neon DB)', () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is not set — is .env.local present?');
});

test('card top-up: credits the pack once, sets a fresh expiry on a new account', async () => {
  const subject = newWalletSubject();
  const sessionId = newSessionId();
  const res = await recordCardTopupPayment({ stripeSessionId: sessionId, subject, amountCents: 2500 });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.topupCents, 2500);
  assert.equal(res.balanceAfterCents, 2500);
  // Match is off by default (matchEnabled false) — no matched cents.
  assert.equal(res.matchCents, 0);
  const bal = await getBalance(subject);
  assert.equal(bal.balanceCents, 2500);
  assert.ok(bal.expiresAt !== null);
  const days = (new Date(bal.expiresAt as unknown as string).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  assert.ok(days > polyCreditsConfig.starterExpiryDays - 1 && days <= polyCreditsConfig.starterExpiryDays);
});

test('card top-up: the same session can never credit twice', async () => {
  const subject = newWalletSubject();
  const sessionId = newSessionId();
  const first = await recordCardTopupPayment({ stripeSessionId: sessionId, subject, amountCents: 5000 });
  assert.equal(first.ok, true);
  const second = await recordCardTopupPayment({ stripeSessionId: sessionId, subject, amountCents: 5000 });
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.reason, 'already_credited');
  const bal = await getBalance(subject);
  assert.equal(bal.balanceCents, 5000);
});

test('card top-up: a second pack adds to the same balance', async () => {
  const subject = newWalletSubject();
  const first = await recordCardTopupPayment({ stripeSessionId: newSessionId(), subject, amountCents: 2500 });
  assert.equal(first.ok, true);
  const second = await recordCardTopupPayment({ stripeSessionId: newSessionId(), subject, amountCents: 10000 });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.balanceAfterCents, 12500);
});

test('card top-up: invalid amounts are refused', async () => {
  const subject = newWalletSubject();
  for (const bad of [0, -100, 12.5, NaN]) {
    const res = await recordCardTopupPayment({ stripeSessionId: newSessionId(), subject, amountCents: bad });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'invalid_amount');
  }
  const empty = await recordCardTopupPayment({ stripeSessionId: '   ', subject, amountCents: 2500 });
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.reason, 'invalid_amount');
});

test('card session: happy path credits via the session object', async () => {
  const subject = newWalletSubject();
  const session = fakeSession({ metadata: { kind: 'poly-credits-card-topup', subject, packCents: '5000' }, amount_total: 5000 });
  const res = await recordCardTopupFromSession(session);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.topupCents, 5000);
  assert.equal(res.balanceAfterCents, 5000);
  // Same session again → already credited.
  const again = await recordCardTopupFromSession(session);
  assert.equal(again.ok, false);
  if (!again.ok) assert.equal(again.reason, 'already_credited');
});
