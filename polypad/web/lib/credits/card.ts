/**
 * Poly credits card top-up — Stripe Checkout. Server-only.
 *
 * A business (or anyone) without crypto buys Poly credits with a card:
 * pick a pack, pay in Stripe Checkout, and the webhook credits the SAME
 * ledger the ETH/POLYDASH flow writes to. No new contracts, no changes
 * to the crypto top-up flow, no surcharge — Polypad absorbs the card
 * fees (~2.9% + 30¢) unless Jon decides otherwise.
 *
 * Packs are fixed dollar amounts (100¢ = $1): $25 → 2,500 credits,
 * $50 → 5,000, $100 → 10,000. The credited amount is the pack amount —
 * never computed from a price, never guessed.
 *
 * Guards:
 *  1. The Checkout session carries metadata { kind, subject, packCents }
 *     so the webhook knows exactly who to credit and how much.
 *  2. One credit per payment: PolyCreditCardTopup.stripeSessionId is
 *     @unique and the card-topup row + ledger rows + balance update run
 *     in ONE transaction (recordCardTopupPayment) — a duplicate webhook
 *     delivery credits nothing.
 *  3. The webhook verifies the amount_total from Stripe against the
 *     pack in metadata before crediting.
 *  4. A card top-up NEVER touches the starter grant — the $25 starter
 *     stays one-per-wallet via PolyCreditClaim.
 *
 * Stripe keys: STRIPE_SECRET_KEY (+ STRIPE_WEBHOOK_SECRET for the
 * webhook). Test mode on Preview; live mode needs Jon's call on which
 * Stripe account Polypad uses.
 */
import Stripe from "stripe";
import { recordCardTopupPayment } from "./ledger";

/** Fixed card packs: USD cents paid = credits granted. No surcharge. */
export const CARD_TOPUP_PACKS = [
  { amountCents: 2500, label: "$25", credits: "2,500 credits" },
  { amountCents: 5000, label: "$50", credits: "5,000 credits" },
  { amountCents: 10000, label: "$100", credits: "10,000 credits" },
] as const;

export function isCardPackCents(value: unknown): value is 2500 | 5000 | 10000 {
  return value === 2500 || value === 5000 || value === 10000;
}

export function cardPackLabel(amountCents: number): string {
  const pack = CARD_TOPUP_PACKS.find((p) => p.amountCents === amountCents);
  return pack ? `${pack.label} — ${pack.credits}` : `$${(amountCents / 100).toFixed(2)}`;
}

/** Stripe client from STRIPE_SECRET_KEY. Null when unconfigured. */
export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

const CARD_TOPUP_KIND = "poly-credits-card-topup";

/**
 * Create a Stripe Checkout session for one card pack. The buyer pays on
 * Stripe's page and lands back on /agents/credits. Returns the hosted
 * Checkout URL to redirect to.
 */
export async function createCardCheckoutSession(args: {
  subject: string;
  packCents: 2500 | 5000 | 10000;
  origin: string;
}): Promise<
  | { ok: true; url: string; sessionId: string }
  | { ok: false; reason: "not_configured" | "stripe_error" }
> {
  const { subject, packCents, origin } = args;
  const stripe = getStripe();
  if (!stripe) return { ok: false, reason: "not_configured" };
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: packCents,
            product_data: { name: `Poly credits — ${cardPackLabel(packCents)}` },
          },
          quantity: 1,
        },
      ],
      metadata: { kind: CARD_TOPUP_KIND, subject, packCents: String(packCents) },
      success_url: `${origin}/agents/credits?card=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/agents/credits?card=cancelled`,
    });
    if (!session.url) return { ok: false, reason: "stripe_error" };
    return { ok: true, url: session.url, sessionId: session.id };
  } catch (e: unknown) {
    console.error("credits card checkout failed", e instanceof Error ? e.message : e);
    return { ok: false, reason: "stripe_error" };
  }
}

export type CardTopupSessionCheck =
  | {
      ok: true;
      paymentStatus: string;
      amountCents: number;
      credited: boolean;
      balanceAfterCents: number | null;
    }
  | { ok: false; reason: "not_configured" | "not_a_card_topup" | "stripe_error" };

/**
 * Validate a Checkout session as a card top-up and credit it (once).
 * Called by the webhook on checkout.session.completed. The session id
 * is the replay guard — a second delivery returns already_credited.
 */
export async function recordCardTopupFromSession(session: Stripe.Checkout.Session): Promise<
  | { ok: true; topupCents: number; matchCents: number; balanceAfterCents: number }
  | { ok: false; reason: "not_a_card_topup" | "not_paid" | "amount_mismatch" | "already_credited" | "invalid_amount" }
> {
  const meta = session.metadata ?? {};
  if (meta.kind !== CARD_TOPUP_KIND || typeof meta.subject !== "string" || meta.subject === "") {
    return { ok: false, reason: "not_a_card_topup" };
  }
  if (session.payment_status !== "paid") return { ok: false, reason: "not_paid" };
  const packCents = Number(meta.packCents);
  if (!isCardPackCents(packCents)) return { ok: false, reason: "not_a_card_topup" };
  // Stripe's amount_total (cents) must equal the pack — never credit a
  // different amount than the buyer paid for.
  if (typeof session.amount_total !== "number" || session.amount_total !== packCents) {
    return { ok: false, reason: "amount_mismatch" };
  }
  const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : null;
  const email = session.customer_details?.email ?? null;
  return recordCardTopupPayment({
    stripeSessionId: session.id,
    stripePaymentIntent: paymentIntent,
    subject: meta.subject,
    amountCents: packCents,
    email,
  });
}
