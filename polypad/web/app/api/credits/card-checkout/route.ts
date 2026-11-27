import { NextResponse } from "next/server";
import { allowAttempt, clientIpHash } from "@/lib/agents-api/core";
import { isWalletAddress, resolveKeyId } from "../_lib/subject";
import { verifyCreditsSignature } from "../_lib/nonce";
import { createCardCheckoutSession, isCardPackCents } from "@/lib/credits/card";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

/**
 * POST /api/credits/card-checkout { packCents, wallet, key?, nonce, signature }
 * Creates a Stripe Checkout session for one fixed card pack ($25 / $50 /
 * $100). The wallet signature over the single-use nonce (purpose 'topup')
 * proves the caller owns the wallet the credits will land on; a Pro key
 * (optional) targets that key's account instead. Returns the hosted
 * Checkout URL — the browser redirects there to pay by card.
 */
export async function POST(req: Request) {
  if (!allowAttempt(`credits-card-checkout:${clientIpHash(req)}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json(
      { ok: false, reason: "Too many card checkout attempts from here. Wait an hour and try again." },
      { status: 429, headers: { ...noStore, "retry-after": "3600" } },
    );
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, reason: "Send a JSON body." }, { status: 400, headers: noStore });
  }

  const packCents = typeof body.packCents === "number" ? body.packCents : Number(body.packCents);
  if (!isCardPackCents(packCents)) {
    return NextResponse.json(
      { ok: false, reason: "Pick a pack: $25, $50, or $100." },
      { status: 400, headers: noStore },
    );
  }
  const wallet = typeof body.wallet === "string" ? body.wallet.trim() : "";
  if (!isWalletAddress(wallet)) {
    return NextResponse.json(
      { ok: false, reason: "Enter the wallet address the credits should land on — it should start with 0x and be 42 characters long." },
      { status: 400, headers: noStore },
    );
  }

  // Optional Pro key: credits land on the key's account instead of the wallet.
  let subject: string | null = null;
  if (body.key !== undefined && body.key !== null && body.key !== "") {
    const resolved = await resolveKeyId(body.key);
    if (resolved.keyId === null) {
      return NextResponse.json(
        {
          ok: false,
          reason: resolved.degraded
            ? "Could not verify the Pro key right now. Try again in a moment, or buy without a key."
            : "That Pro key is unknown or revoked. Check it, or buy without a key.",
        },
        { status: 400, headers: noStore },
      );
    }
    subject = `key:${resolved.keyId}`;
  }
  if (!subject) subject = `wallet:${wallet.toLowerCase()}`;

  // Wallet ownership proof: signature over the single-use nonce.
  const nonce = typeof body.nonce === "string" ? body.nonce : "";
  const signature = typeof body.signature === "string" ? body.signature : "";
  if (!nonce || !signature) {
    return NextResponse.json(
      { ok: false, reason: "Sign the message in your wallet first — ask for a nonce, sign it, then check out." },
      { status: 401, headers: noStore },
    );
  }
  const verified = await verifyCreditsSignature({ wallet, nonce, signature, purpose: "topup" });
  if (!verified.ok) {
    return NextResponse.json({ ok: false, reason: verified.reason }, { status: verified.status, headers: noStore });
  }

  const origin = new URL(req.url).origin;
  try {
    const session = await createCardCheckoutSession({ subject, packCents, origin });
    if (!session.ok) {
      if (session.reason === "not_configured") {
        return NextResponse.json(
          { ok: false, reason: "Card checkout is not set up yet. Pay with ETH or POLYDASH for now." },
          { status: 503, headers: noStore },
        );
      }
      return NextResponse.json(
        { ok: false, reason: "Could not start the card checkout right now. Try again in a moment." },
        { status: 500, headers: noStore },
      );
    }
    return NextResponse.json({ ok: true, url: session.url, sessionId: session.sessionId }, { headers: noStore });
  } catch (e: unknown) {
    console.error("credits card checkout failed", e instanceof Error ? e.message : e);
    return NextResponse.json(
      { ok: false, reason: "Could not start the card checkout right now." },
      { status: 500, headers: noStore },
    );
  }
}
