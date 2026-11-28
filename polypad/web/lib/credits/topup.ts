/**
 * Poly credits top-up confirmation — server-only.
 *
 * A user buys credits by sending ETH or POLYDASH to X402_PAY_TO (the
 * deployer/fee wallet — the same wallet all x402 report revenue lands in)
 * and submitting the transaction hash. This module verifies the payment
 * on-chain and credits the account. No new smart contracts, no changes to
 * the x402 money path.
 *
 * Guards (all enforced before any credit — spec §16.5):
 *  1. tx.from must equal the wallet that signed the top-up nonce. This is
 *     what makes the shared recipient safe: x402 report settlements are
 *     broadcast by the facilitator wallet, so their tx.from is the
 *     facilitator — a report payment can never be re-claimed as a top-up.
 *  2. Freshness: the tx's block timestamp must be within 24 h of the
 *     request (kills historical replay).
 *  3. One credit per payment: PolyCreditTopup.txHash is @unique and the
 *     top-up record + ledger rows + balance update run in ONE transaction
 *     (lib/credits/ledger.ts recordTopupPayment) — a concurrent duplicate
 *     submit hits the unique constraint and credits nothing.
 *  4. Recipient + asset: ETH must arrive as tx.value to X402_PAY_TO;
 *     POLYDASH must arrive as a Transfer log (from == sender, to ==
 *     X402_PAY_TO) on the POLYDASH token.
 *  5. Receipt status must be 'success'.
 *  6. At least 1¢ after conversion at confirmation-time prices.
 *
 * The credited amount is set at confirmation time (see
 * lib/credits/pricing.ts). The quote endpoint is an estimate only.
 */
import { getAddress, isAddress, keccak256, pad, toHex, type PublicClient } from "viem";
import { prisma } from "@/lib/db";
import { POLYDASH_ADDRESS, X402_PAY_TO } from "@/lib/x402/constants";
import { keySubject, recordTopupPayment, walletSubject } from "./ledger";
import {
  centsFromUsd6,
  getPolydashUsdForTopup,
  isFresh,
  quoteTopup,
  topupPublicClient,
  usd6FromWei,
  type TopupAsset,
} from "./pricing";

/** A top-up payment must be from the last 24 h. */
export const TOPUP_FRESHNESS_MS = 24 * 60 * 60 * 1000;

const TRANSFER_TOPIC = keccak256(toHex("Transfer(address,address,uint256)"));

export type TopupVerifyFailure =
  | "tx_not_found"
  | "tx_reverted"
  | "recipient_mismatch"
  | "wrong_sender"
  | "too_old"
  | "amount_too_small"
  | "price_unavailable"
  | "unsupported_asset";

/** The chain reads a top-up needs: receipt, tx, block (pricing reads the pool separately). */
export type TopupChainClient = Pick<
  PublicClient,
  "getTransactionReceipt" | "getTransaction" | "getBlock" | "readContract"
>;

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

function topicAddress(topic: string): string {
  return getAddress(`0x${topic.slice(26)}`).toLowerCase();
}

/**
 * Verify a payment tx on-chain. Pure chain checks — credits nothing.
 * Returns the received amount (wei) and the block it landed in.
 */
export async function verifyTopupPayment(args: {
  txHash: string;
  asset: TopupAsset;
  sender: string;
  client?: TopupChainClient;
}): Promise<
  | { ok: true; amountRaw: bigint; blockNumber: number; blockTimestamp: number }
  | { ok: false; reason: TopupVerifyFailure }
> {
  const { txHash, asset, sender } = args;
  if (!TX_HASH_RE.test(txHash)) return { ok: false, reason: "tx_not_found" };
  if (asset !== "ETH" && asset !== "POLYDASH") return { ok: false, reason: "unsupported_asset" };
  if (!isAddress(sender, { strict: false })) return { ok: false, reason: "wrong_sender" };
  const senderLower = sender.toLowerCase();
  const client = args.client ?? topupPublicClient();

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
  } catch {
    return { ok: false, reason: "tx_not_found" };
  }
  if (!receipt) return { ok: false, reason: "tx_not_found" };
  if (receipt.status !== "success") return { ok: false, reason: "tx_reverted" };
  if (receipt.from.toLowerCase() !== senderLower) return { ok: false, reason: "wrong_sender" };

  const blockNumber = Number(receipt.blockNumber);
  let blockTimestamp: number;
  try {
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    blockTimestamp = Number(block.timestamp);
  } catch {
    return { ok: false, reason: "tx_not_found" };
  }
  if (!isFresh(blockTimestamp, Date.now(), TOPUP_FRESHNESS_MS)) return { ok: false, reason: "too_old" };

  if (asset === "ETH") {
    // Plain transfer: the value arrives as tx.value to X402_PAY_TO.
    let tx;
    try {
      tx = await client.getTransaction({ hash: txHash as `0x${string}` });
    } catch {
      return { ok: false, reason: "tx_not_found" };
    }
    if (!tx.to || tx.to.toLowerCase() !== X402_PAY_TO.toLowerCase()) {
      return { ok: false, reason: "recipient_mismatch" };
    }
    if (tx.value <= 0n) return { ok: false, reason: "amount_too_small" };
    return { ok: true, amountRaw: tx.value, blockNumber, blockTimestamp };
  }

  // POLYDASH: the payment arrives as ERC-20 Transfer log(s) on the token,
  // from the sender to X402_PAY_TO. Sum matching logs (a tx could batch).
  const logs = (receipt.logs ?? []).filter(
    (log) =>
      log.address.toLowerCase() === POLYDASH_ADDRESS.toLowerCase() &&
      log.topics[0]?.toLowerCase() === TRANSFER_TOPIC.toLowerCase() &&
      log.topics[1] !== undefined &&
      log.topics[2] !== undefined &&
      topicAddress(log.topics[1]) === senderLower &&
      topicAddress(log.topics[2]) === X402_PAY_TO.toLowerCase(),
  );
  let amountRaw = 0n;
  for (const log of logs) {
    try {
      amountRaw += BigInt(log.data);
    } catch {
      // A malformed log cannot be a payment — ignore it.
    }
  }
  if (amountRaw <= 0n) return { ok: false, reason: "recipient_mismatch" };
  return { ok: true, amountRaw, blockNumber, blockTimestamp };
}

/**
 * Confirm a top-up: verify the payment, price it at confirmation time,
 * and credit the account (once — the txHash unique constraint is the
 * replay guard). The target is the Pro key account when keyId is given,
 * else the sender's wallet account.
 */
export async function confirmTopup(args: {
  txHash: string;
  asset: TopupAsset;
  wallet: string;
  keyId?: string;
  client?: TopupChainClient;
}): Promise<
  | {
      ok: true;
      subject: string;
      amountCents: number;
      matchCents: number;
      balanceAfterCents: number;
      priceUsd: number;
      amountRaw: string;
    }
  | { ok: false; reason: TopupVerifyFailure | "already_credited" | "invalid_amount" }
> {
  const { txHash, asset, wallet, keyId } = args;
  if (!TX_HASH_RE.test(txHash)) return { ok: false, reason: "tx_not_found" };
  if (!isAddress(wallet, { strict: false })) return { ok: false, reason: "wrong_sender" };
  const txHashLower = txHash.toLowerCase();
  const subject = keyId ? keySubject(keyId) : walletSubject(wallet.toLowerCase());

  // Fast-path replay check (the unique insert in recordTopupPayment is
  // the real guard — this just saves RPC work on replays).
  const existing = await prisma.polyCreditTopup.findUnique({ where: { txHash: txHashLower } });
  if (existing) return { ok: false, reason: "already_credited" };

  const verified = await verifyTopupPayment({ txHash, asset, sender: wallet, client: args.client });
  if (!verified.ok) return verified;

  // Price at confirmation time. A missing price fails closed — never
  // credit at a guessed price.
  const client = args.client ?? topupPublicClient();
  const priced =
    asset === "ETH"
      ? await quoteTopup("ETH", verified.amountRaw, client as PublicClient)
      : await (async () => {
          const priceUsd = await getPolydashUsdForTopup(client as PublicClient);
          if (!Number.isFinite(priceUsd) || priceUsd <= 0) return { ok: false as const, reason: "price_unavailable" as const };
          const usd6 = usd6FromWei(verified.amountRaw, priceUsd);
          return { ok: true as const, cents: centsFromUsd6(usd6), priceUsd, usdValue: Number(usd6) / 1e6 };
        })();
  if (!priced.ok) return { ok: false, reason: "price_unavailable" };
  if (priced.cents < 1) return { ok: false, reason: "amount_too_small" };

  const recorded = await recordTopupPayment({
    subject,
    amountCents: priced.cents,
    reason: `topup:${asset.toLowerCase()}:${txHashLower.slice(0, 10)}`,
    txHash: txHashLower,
    asset,
    amountRaw: verified.amountRaw.toString(),
    priceUsd: String(priced.priceUsd),
    sender: wallet,
    blockNumber: verified.blockNumber,
  });
  if (!recorded.ok) return recorded;
  return {
    ok: true,
    subject,
    amountCents: recorded.topupCents,
    matchCents: recorded.matchCents,
    balanceAfterCents: recorded.balanceAfterCents,
    priceUsd: priced.priceUsd,
    amountRaw: verified.amountRaw.toString(),
  };
}
