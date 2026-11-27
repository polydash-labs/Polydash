import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import { keccak256, pad, parseEther, toHex } from 'viem';
import { POLYDASH_ADDRESS, X402_PAY_TO } from '../x402/constants';
import { prisma } from '@/lib/db';
import { confirmTopup, verifyTopupPayment, type TopupChainClient } from './topup';

// Loads DATABASE_URL for the confirmTopup tests (run from the repo root).
dotenv.config({ path: '.env.local' });

// ---------------------------------------------------------------------------
// Mock chain client (hand-built, no network)
// ---------------------------------------------------------------------------

const SENDER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const TX_HASH = `0x${'ab'.repeat(32)}`;
const NOW_SEC = Math.floor(Date.now() / 1000);

const TRANSFER_TOPIC = keccak256(toHex('Transfer(address,address,uint256)'));

/** A 32-byte topic encoding an address (12 zero bytes + 20 address bytes). */
function topicAddress(address: string): `0x${string}` {
  return pad(address as `0x${string}`, { size: 32 });
}

/** An ERC-20 Transfer log. */
function transferLog(args: {
  token?: string;
  topic0?: string;
  from?: string;
  to?: string;
  value?: bigint;
  data?: string;
}) {
  return {
    address: args.token ?? POLYDASH_ADDRESS,
    topics: [
      args.topic0 ?? TRANSFER_TOPIC,
      topicAddress(args.from ?? SENDER),
      topicAddress(args.to ?? X402_PAY_TO),
    ] as [`0x${string}`, `0x${string}`, `0x${string}`],
    data: args.data ?? toHex(args.value ?? parseEther('1'), { size: 32 }),
  };
}

type MockOverrides = {
  receipt?: Record<string, unknown>;
  tx?: Record<string, unknown>;
  blockTimestamp?: number;
  readContract?: unknown;
  receiptThrows?: boolean;
  txThrows?: boolean;
  blockThrows?: boolean;
};

/**
 * Plain-object mock of TopupChainClient. Counters record which RPCs the
 * code under test actually made.
 */
function mockClient(overrides: MockOverrides = {}) {
  const calls = { receipt: 0, tx: 0, block: 0, readContract: 0 };
  const client = {
    getTransactionReceipt: async () => {
      calls.receipt += 1;
      if (overrides.receiptThrows) throw new Error('tx not found');
      return {
        status: 'success',
        from: SENDER,
        blockNumber: 123n,
        logs: [],
        ...overrides.receipt,
      };
    },
    getTransaction: async () => {
      calls.tx += 1;
      if (overrides.txThrows) throw new Error('tx not found');
      return { to: X402_PAY_TO, value: parseEther('1'), from: SENDER, ...overrides.tx };
    },
    getBlock: async () => {
      calls.block += 1;
      if (overrides.blockThrows) throw new Error('block not found');
      return { timestamp: BigInt(overrides.blockTimestamp ?? NOW_SEC) };
    },
    readContract: async () => {
      calls.readContract += 1;
      if (overrides.readContract !== undefined) return overrides.readContract;
      throw new Error('unexpected readContract call');
    },
  };
  return { client: client as unknown as TopupChainClient, calls };
}

// ---------------------------------------------------------------------------
// verifyTopupPayment — no DB
// ---------------------------------------------------------------------------

test('Transfer topic is the keccak256 of the ERC-20 Transfer signature', () => {
  assert.equal(
    TRANSFER_TOPIC,
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  );
});

test('verify ETH happy path: value to X402_PAY_TO in a fresh block', async () => {
  const { client } = mockClient();
  const res = await verifyTopupPayment({ txHash: TX_HASH, asset: 'ETH', sender: SENDER, client });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.amountRaw, parseEther('1'));
  assert.equal(res.blockNumber, 123);
  assert.equal(res.blockTimestamp, NOW_SEC);
});

test('verify ETH wrong recipient -> recipient_mismatch', async () => {
  const { client } = mockClient({ tx: { to: OTHER } });
  const res = await verifyTopupPayment({ txHash: TX_HASH, asset: 'ETH', sender: SENDER, client });
  assert.deepEqual(res, { ok: false, reason: 'recipient_mismatch' });
});

test('verify ETH wrong sender (receipt.from != sender) -> wrong_sender', async () => {
  const { client } = mockClient({ receipt: { from: OTHER } });
  const res = await verifyTopupPayment({ txHash: TX_HASH, asset: 'ETH', sender: SENDER, client });
  assert.deepEqual(res, { ok: false, reason: 'wrong_sender' });
});

test('verify ETH reverted receipt -> tx_reverted', async () => {
  const { client } = mockClient({ receipt: { status: 'reverted' } });
  const res = await verifyTopupPayment({ txHash: TX_HASH, asset: 'ETH', sender: SENDER, client });
  assert.deepEqual(res, { ok: false, reason: 'tx_reverted' });
});

test('verify ETH block older than 24h -> too_old', async () => {
  const { client } = mockClient({ blockTimestamp: NOW_SEC - 25 * 3600 });
  const res = await verifyTopupPayment({ txHash: TX_HASH, asset: 'ETH', sender: SENDER, client });
  assert.deepEqual(res, { ok: false, reason: 'too_old' });
});

test('verify ETH block just inside 24h is fresh', async () => {
  const { client } = mockClient({ blockTimestamp: NOW_SEC - 24 * 3600 + 60 });
  const res = await verifyTopupPayment({ txHash: TX_HASH, asset: 'ETH', sender: SENDER, client });
  assert.equal(res.ok, true);
});

test('verify ETH zero value -> amount_too_small', async () => {
  const { client } = mockClient({ tx: { value: 0n } });
  const res = await verifyTopupPayment({ txHash: TX_HASH, asset: 'ETH', sender: SENDER, client });
  assert.deepEqual(res, { ok: false, reason: 'amount_too_small' });
});

test('verify malformed tx hash -> tx_not_found without any RPC call', async () => {
  const { client, calls } = mockClient();
  const res = await verifyTopupPayment({ txHash: '0x123', asset: 'ETH', sender: SENDER, client });
  assert.deepEqual(res, { ok: false, reason: 'tx_not_found' });
  assert.equal(calls.receipt, 0);
});

test('verify receipt lookup throwing -> tx_not_found', async () => {
  const { client } = mockClient({ receiptThrows: true });
  const res = await verifyTopupPayment({ txHash: TX_HASH, asset: 'ETH', sender: SENDER, client });
  assert.deepEqual(res, { ok: false, reason: 'tx_not_found' });
});

test('verify unsupported asset and invalid sender fail before any RPC call', async () => {
  const { client, calls } = mockClient();
  const badAsset = await verifyTopupPayment({
    txHash: TX_HASH,
    asset: 'BTC' as never,
    sender: SENDER,
    client,
  });
  assert.deepEqual(badAsset, { ok: false, reason: 'unsupported_asset' });
  const badSender = await verifyTopupPayment({ txHash: TX_HASH, asset: 'ETH', sender: 'not-an-address', client });
  assert.deepEqual(badSender, { ok: false, reason: 'wrong_sender' });
  assert.equal(calls.receipt, 0);
});

test('verify POLYDASH happy path: one matching Transfer log', async () => {
  const { client, calls } = mockClient({
    receipt: { logs: [transferLog({ value: parseEther('100') })] },
  });
  const res = await verifyTopupPayment({ txHash: TX_HASH, asset: 'POLYDASH', sender: SENDER, client });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.amountRaw, parseEther('100'));
  // POLYDASH pays via logs: the tx itself is never fetched.
  assert.equal(calls.tx, 0);
});

test('verify POLYDASH sums several matching Transfer logs', async () => {
  const { client } = mockClient({
    receipt: {
      logs: [transferLog({ value: parseEther('40') }), transferLog({ value: parseEther('60') })],
    },
  });
  const res = await verifyTopupPayment({ txHash: TX_HASH, asset: 'POLYDASH', sender: SENDER, client });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.amountRaw, parseEther('100'));
});

test('verify POLYDASH ignores a log from the wrong token', async () => {
  const { client } = mockClient({
    receipt: {
      logs: [
        transferLog({ token: OTHER, value: parseEther('999') }),
        transferLog({ value: parseEther('7') }),
      ],
    },
  });
  const res = await verifyTopupPayment({ txHash: TX_HASH, asset: 'POLYDASH', sender: SENDER, client });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.amountRaw, parseEther('7'));
});

test('verify POLYDASH with only a wrong-token log -> recipient_mismatch', async () => {
  const { client } = mockClient({
    receipt: { logs: [transferLog({ token: OTHER, value: parseEther('999') })] },
  });
  const res = await verifyTopupPayment({ txHash: TX_HASH, asset: 'POLYDASH', sender: SENDER, client });
  assert.deepEqual(res, { ok: false, reason: 'recipient_mismatch' });
});

test('verify POLYDASH ignores logs from the wrong sender or to the wrong recipient', async () => {
  const { client } = mockClient({
    receipt: {
      logs: [
        transferLog({ from: OTHER, value: parseEther('50') }),
        transferLog({ to: OTHER, value: parseEther('50') }),
      ],
    },
  });
  const res = await verifyTopupPayment({ txHash: TX_HASH, asset: 'POLYDASH', sender: SENDER, client });
  assert.deepEqual(res, { ok: false, reason: 'recipient_mismatch' });
});

test('verify POLYDASH ignores a log with the wrong topic and a malformed log', async () => {
  const approvalTopic = keccak256(toHex('Approval(address,address,uint256)'));
  const { client } = mockClient({
    receipt: {
      logs: [
        transferLog({ topic0: approvalTopic, value: parseEther('50') }),
        transferLog({ data: '0xzz' }),
      ],
    },
  });
  const res = await verifyTopupPayment({ txHash: TX_HASH, asset: 'POLYDASH', sender: SENDER, client });
  assert.deepEqual(res, { ok: false, reason: 'recipient_mismatch' });
});

test('verify POLYDASH with no logs -> recipient_mismatch', async () => {
  const { client } = mockClient({ receipt: { logs: [] } });
  const res = await verifyTopupPayment({ txHash: TX_HASH, asset: 'POLYDASH', sender: SENDER, client });
  assert.deepEqual(res, { ok: false, reason: 'recipient_mismatch' });
});

test('verify POLYDASH reverted receipt -> tx_reverted (logs never inspected)', async () => {
  const { client } = mockClient({
    receipt: { status: 'reverted', logs: [transferLog({ value: parseEther('100') })] },
  });
  const res = await verifyTopupPayment({ txHash: TX_HASH, asset: 'POLYDASH', sender: SENDER, client });
  assert.deepEqual(res, { ok: false, reason: 'tx_reverted' });
});

// ---------------------------------------------------------------------------
// confirmTopup — needs the DB (record step) + live ETH price for ETH
// ---------------------------------------------------------------------------

const subjects = new Set<string>();
const txHashes = new Set<string>();

function freshTxHash(): string {
  const hash = `0x${randomBytes(32).toString('hex')}`;
  txHashes.add(hash);
  return hash;
}

function trackSubject(subject: string): string {
  subjects.add(subject);
  return subject;
}

after(async () => {
  // Best-effort cleanup of every row this file created, so the shared DB
  // stays clean even if a test fails midway.
  try {
    await prisma.polyCreditTopup.deleteMany({ where: { txHash: { in: [...txHashes] } } });
    const accounts = await prisma.polyCreditAccount.findMany({
      where: { subject: { in: [...subjects] } },
      select: { id: true },
    });
    await prisma.polyCreditLedger.deleteMany({
      where: { accountId: { in: accounts.map((a) => a.id) } },
    });
    await prisma.polyCreditAccount.deleteMany({ where: { subject: { in: [...subjects] } } });
  } catch (e) {
    console.error('topup.test.ts cleanup failed:', e instanceof Error ? e.message : e);
  }
});

test('confirmTopup ETH happy path credits the wallet at the live ETH price', async () => {
  const wallet = `0x${randomBytes(20).toString('hex')}`;
  const subject = trackSubject(`wallet:${wallet.toLowerCase()}`);
  const txHash = freshTxHash();
  const { client } = mockClient({ tx: { value: parseEther('0.01') } });
  const res = await confirmTopup({ txHash, asset: 'ETH', wallet, client });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.subject, subject);
  // 0.01 ETH at a live price in the low-thousands is ~1,000-5,000 cents.
  // Range, not exact: the price is live and moves between runs.
  assert.ok(res.amountCents >= 1000 && res.amountCents <= 5000, `amountCents ${res.amountCents} outside live-price range`);
  assert.equal(res.balanceAfterCents, res.amountCents);
  assert.equal(res.amountRaw, parseEther('0.01').toString());
  const row = await prisma.polyCreditTopup.findUnique({ where: { txHash: txHash.toLowerCase() } });
  assert.ok(row);
  assert.equal(row?.subject, subject);
  assert.equal(row?.asset, 'ETH');
  assert.equal(row?.amountCents, res.amountCents);
  assert.equal(row?.sender, wallet.toLowerCase());
});

test('confirmTopup replay of the same txHash -> already_credited, balance unchanged', async () => {
  const wallet = `0x${randomBytes(20).toString('hex')}`;
  trackSubject(`wallet:${wallet.toLowerCase()}`);
  const txHash = freshTxHash();
  const { client } = mockClient({ tx: { value: parseEther('0.01') } });
  const first = await confirmTopup({ txHash, asset: 'ETH', wallet, client });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = await confirmTopup({ txHash, asset: 'ETH', wallet, client });
  assert.deepEqual(second, { ok: false, reason: 'already_credited' });
  const balance = await prisma.polyCreditAccount.findUnique({
    where: { subject: `wallet:${wallet.toLowerCase()}` },
  });
  assert.equal(balance?.balanceCents, first.balanceAfterCents);
  const rows = await prisma.polyCreditTopup.findMany({ where: { txHash: txHash.toLowerCase() } });
  assert.equal(rows.length, 1);
});

test('confirmTopup concurrent duplicate submits credit exactly once', async () => {
  const wallet = `0x${randomBytes(20).toString('hex')}`;
  trackSubject(`wallet:${wallet.toLowerCase()}`);
  const txHash = freshTxHash();
  const { client } = mockClient({ tx: { value: parseEther('0.01') } });
  const [a, b] = await Promise.all([
    confirmTopup({ txHash, asset: 'ETH', wallet, client }),
    confirmTopup({ txHash, asset: 'ETH', wallet, client }),
  ]);
  const oks = [a, b].filter((r) => r.ok);
  const replays = [a, b].filter((r) => !r.ok && r.reason === 'already_credited');
  assert.equal(oks.length, 1);
  assert.equal(replays.length, 1);
  const rows = await prisma.polyCreditTopup.findMany({ where: { txHash: txHash.toLowerCase() } });
  assert.equal(rows.length, 1);
});

test('confirmTopup dust (1 wei of ETH) -> amount_too_small, nothing credited', async () => {
  const wallet = `0x${randomBytes(20).toString('hex')}`;
  trackSubject(`wallet:${wallet.toLowerCase()}`);
  const txHash = freshTxHash();
  const { client } = mockClient({ tx: { value: 1n } });
  const res = await confirmTopup({ txHash, asset: 'ETH', wallet, client });
  assert.deepEqual(res, { ok: false, reason: 'amount_too_small' });
  const row = await prisma.polyCreditTopup.findUnique({ where: { txHash: txHash.toLowerCase() } });
  assert.equal(row, null);
});

test('confirmTopup can credit a key subject (no key validation on this path)', async () => {
  const wallet = `0x${randomBytes(20).toString('hex')}`;
  const keyId = `test-${randomBytes(8).toString('hex')}`;
  trackSubject(`key:${keyId}`);
  const txHash = freshTxHash();
  const { client } = mockClient({ tx: { value: parseEther('0.01') } });
  const res = await confirmTopup({ txHash, asset: 'ETH', wallet, keyId, client });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.subject, `key:${keyId}`);
});

test('confirmTopup POLYDASH prices from the mocked pool (1 POLYDASH = 1 WETH at sqrtPriceX96 = 2^96)', async () => {
  const wallet = `0x${randomBytes(20).toString('hex')}`;
  trackSubject(`wallet:${wallet.toLowerCase()}`);
  const txHash = freshTxHash();
  // Pool price: sqrtPriceX96 = 2^96 -> 1 POLYDASH = 1 WETH, so 1 POLYDASH
  // is worth ~1 ETH (~$1,000-$5,000 at a live ETH price).
  const { client } = mockClient({
    receipt: { logs: [transferLog({ value: parseEther('1') })] },
    readContract: { sqrtPriceX96: 2n ** 96n },
  });
  const res = await confirmTopup({ txHash, asset: 'POLYDASH', wallet, client });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.ok(res.amountCents >= 100_000 && res.amountCents <= 500_000, `amountCents ${res.amountCents} outside live-price range`);
  const row = await prisma.polyCreditTopup.findUnique({ where: { txHash: txHash.toLowerCase() } });
  assert.equal(row?.asset, 'POLYDASH');
  assert.equal(row?.amountRaw, parseEther('1').toString());
});
