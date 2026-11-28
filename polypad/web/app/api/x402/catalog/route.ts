import { NextResponse } from 'next/server';
import { buildX402Catalog } from '@/lib/x402/catalog';

export const dynamic = 'force-dynamic';

/**
 * GET /api/x402/catalog — machine-readable catalog of Polypad's paid x402
 * endpoints: price, settlement chains, and the cross-chain option with its
 * real all-in fee. For registries and agents; no auth, no key.
 */
export async function GET() {
  return NextResponse.json(buildX402Catalog(), {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
