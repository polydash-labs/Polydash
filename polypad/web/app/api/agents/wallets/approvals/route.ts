import { isAddress } from 'viem';
import { prisma, withTimeout } from '@/lib/db';
import { fail, json } from '@/lib/agents-api/core';

export const dynamic = 'force-dynamic';

const STATUSES = ['pending', 'approved', 'denied', 'executed'] as const;

/** List a wallet's approval queue, newest first. Public read — rows contain
 * no key material, only the move's destination and amount. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const wallet = (url.searchParams.get('wallet') ?? '').toLowerCase();
  const status = url.searchParams.get('status') ?? '';
  if (!isAddress(wallet, { strict: false })) {
    return fail(400, 'invalid_params', 'Pass a valid wallet address as ?wallet=0x…');
  }
  const rows = await withTimeout(
    prisma.agentWalletApproval.findMany({
      where: { wallet, ...(STATUSES.includes(status as (typeof STATUSES)[number]) ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  );
  if (rows === null) return fail(503, 'db_unavailable', 'The approval store is unavailable right now — the on-chain state is unaffected.');
  return json({ approvals: rows });
}

/** Queue a big move for the human to approve. The move does NOT execute here —
 * approval executes it client-side with the owner's Safe signature. */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return fail(400, 'invalid_json', 'Send a JSON body.');
    const wallet = String(body.wallet ?? '').toLowerCase();
    const owner = String(body.owner ?? '').toLowerCase();
    const to = String(body.to ?? '').toLowerCase();
    const title = String(body.title ?? '').trim().slice(0, 120);
    const description = String(body.description ?? '').trim().slice(0, 1000);
    const value = String(body.value ?? '0').trim();
    const data = String(body.data ?? '0x').trim();
    const requestedBy = String(body.requestedBy ?? owner).toLowerCase();
    const errors: string[] = [];
    if (!isAddress(wallet, { strict: false })) errors.push('wallet must be a valid address.');
    if (!isAddress(owner, { strict: false })) errors.push('owner must be a valid address.');
    if (!isAddress(to, { strict: false })) errors.push('to must be a valid address.');
    if (!title) errors.push('title is required.');
    if (!/^\d+$/.test(value)) errors.push('value must be a whole number of wei.');
    if (!/^0x([0-9a-fA-F]{2})*$/.test(data)) errors.push('data must be 0x hex.');
    if (errors.length) return fail(400, 'invalid_params', 'Some fields are invalid.', { details: errors });
    const row = await prisma.agentWalletApproval.create({
      data: { wallet, owner, title, description, to, value, data, requestedBy, status: 'pending' },
    });
    return json({ approval: row }, 201);
  } catch (e) {
    console.error('agent wallet approvals POST failed', e);
    return fail(500, 'server_error', 'Could not queue the move.');
  }
}
