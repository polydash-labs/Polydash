import { NextResponse, type NextRequest } from 'next/server';
import { isAddress } from 'viem';
import { getWalletDetailState } from '@/lib/agent-wallet/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

/**
 * Everything the wallet-detail page needs, read server-side from Robinhood
 * Chain (Nov 23, 2026): the page used to read this directly from the
 * visitor's browser, but the browser's network path to the official RPC
 * fails — the balance errored out after ~15-20s, the policy never loaded,
 * and the stake section stuck on "…". The identical calls work from the
 * server, so the route reads them here and the page fetches this JSON
 * (the prices-API pattern). All reads are public on-chain data; no key
 * material. A 500 means the page shows its existing error state.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  if (!address || !isAddress(address, { strict: false })) {
    return NextResponse.json({ error: 'That wallet address is not valid.' }, { status: 400 });
  }
  try {
    const state = await getWalletDetailState(address);
    return NextResponse.json(state);
  } catch (e) {
    console.error('[wallet-state]', address, e);
    return NextResponse.json({ error: 'Could not read the wallet from Robinhood Chain.' }, { status: 500 });
  }
}
