import { NextResponse } from 'next/server';
import { buildX402Catalog } from '@/lib/x402/catalog';

export const dynamic = 'force-dynamic';

/**
 * GET /.well-known/x402 — the same machine-readable catalog as
 * /api/x402/catalog, at the well-known discovery path agents check first.
 */
export async function GET() {
  return NextResponse.json(buildX402Catalog(), {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
