import { NextResponse } from "next/server";
import { allowAttempt, clientIpHash } from "@/lib/agents-api/core";
import { getStripe } from "@/lib/credits/card";
import { prisma } from "@/lib/db";
import { getBalance } from "@/lib/credits/ledger";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

/**
 * GET /api/credits/card-session?session_id=cs_test_...
 * Lets the /agents/credits success page show what happened after a card
 * payment: the Stripe payment status, whether the credits landed, and
 * the new balance. The session id is unguessable, so no wallet
 * signature is needed — the response reveals only this session's own
 * credit status.
 */
export async function GET(req: Request) {
  if (!allowAttempt(`credits-card-session:${clientIpHash(req)}`, 30, 60 * 1000)) {
    return NextResponse.json({ error: "Too many lookups. Wait a minute and try again." }, { status: 429, headers: noStore });
  }
  const sessionId = new URL(req.url).searchParams.get("session_id")?.trim() ?? "";
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
    return NextResponse.json({ error: "That does not look like a checkout session." }, { status: 400, headers: noStore });
  }
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Card checkout is not set up yet." }, { status: 503, headers: noStore });
  }
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const meta = session.metadata ?? {};
    const subject = typeof meta.subject === "string" ? meta.subject : null;
    const row = await prisma.polyCreditCardTopup.findUnique({ where: { stripeSessionId: sessionId } });
    let balanceAfterCents: number | null = null;
    if (row) {
      const bal = await getBalance(row.subject);
      balanceAfterCents = bal.balanceCents;
    }
    return NextResponse.json(
      {
        sessionId,
        paymentStatus: session.payment_status,
        amountCents: typeof session.amount_total === "number" ? session.amount_total : null,
        credited: row !== null,
        subject,
        balanceAfterCents,
      },
      { headers: noStore },
    );
  } catch (e: unknown) {
    console.error("credits card session lookup failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not look up that checkout session." }, { status: 500, headers: noStore });
  }
}
