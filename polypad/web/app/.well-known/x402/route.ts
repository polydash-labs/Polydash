import { NextResponse } from 'next/server';
import { buildX402Catalog } from '@/lib/x402/catalog';

export const dynamic = 'force-dynamic';

/**
 * GET /.well-known/x402 — the same machine-readable catalog as
 * /api/x402/catalog, at the well-known discovery path agents check first.
 * Shape follows IETF draft-hawkins-x402-dns-discovery-03 (Aug 2026):
 * x402Version + kind + facilitator block + resources. Cross-origin GET
 * is permitted — the draft says the manifest is public data.
 */
export async function GET() {
  return NextResponse.json(buildX402Catalog(), {
    headers: {
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
