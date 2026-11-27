import { NextResponse } from 'next/server';
import { X402_SUPPORTED_KINDS } from '@/lib/x402/constants';

export const dynamic = 'force-dynamic';

/** GET /api/x402/supported — the facilitator's supported payment kinds. */
export async function GET() {
  return NextResponse.json({
    kinds: X402_SUPPORTED_KINDS,
    extensions: [],
    signers: {},
  });
}
