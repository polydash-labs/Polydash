import type Stripe from "stripe";
import { NextResponse } from "next/server";
import { getStripe, recordCardTopupFromSession } from "@/lib/credits/card";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/credits/card-webhook — Stripe webhook, the source of truth
 * for card payments. Signature-verified with STRIPE_WEBHOOK_SECRET
 * (raw body, stripe.webhooks.constructEvent).
 *
 *   checkout.session.completed → the buyer paid by card. Credits the
 *   pack amount to the subject in session metadata, idempotent by
 *   Checkout session id — a duplicate delivery is a no-op.
 *
 * Other events are acknowledged and ignored. The webhook secret is one
 * per mode — the test endpoint and the live endpoint are separate in
 * the Stripe Dashboard.
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || "";
  if (!secret) {
    return NextResponse.json({ error: "Webhook is not configured yet." }, { status: 503 });
  }
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Payments are not configured yet." }, { status: 503 });
  }
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature") || "";
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  const type = event.type || "unknown";
  if (type === "checkout.session.completed") {
    // Narrowed by the event type: this is a Checkout Session.
    const session = event.data.object as Stripe.Checkout.Session;
    const result = await recordCardTopupFromSession(session);
    if (!result.ok) {
      if (result.reason === "already_credited") {
        console.log("[card webhook] duplicate delivery, already credited:", session.id);
      } else {
        console.error("[card webhook] card top-up not credited:", result.reason, "session:", session.id);
      }
    }
  }
  return NextResponse.json({ received: true });
}
