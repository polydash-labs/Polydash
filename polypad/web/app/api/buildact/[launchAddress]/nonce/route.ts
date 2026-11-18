import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { ensureCto } from '@/lib/cto/chain';
import { buildMessage, MAX_REPOS, MAX_WALLETS, NONCE_TTL_MS, normaliseValue, type BuildAction } from '@/lib/buildact/shared';

export const dynamic = 'force-dynamic';

const ACTIONS: BuildAction[] = ['link_repo', 'unlink_repo', 'link_wallet', 'unlink_wallet'];
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });


// One-time nonce (10 min) for a signed Build activity link/unlink. Signing is free; no transaction.
export async function POST(req: Request, { params }: { params: Promise<{ launchAddress: string }> }) {
  const { launchAddress } = await params;
  let body: any;
  try { body = await req.json(); } catch { return bad('Invalid request.'); }
  try {
    const action = String(body?.action ?? '') as BuildAction;
    if (!ACTIONS.includes(action)) return bad('Unknown action.');
    const value = normaliseValue(action, body?.value);
    if (!value) return bad(action.endsWith('repo') ? 'Enter a GitHub repo as owner/name or a github.com link.' : 'Enter a valid wallet address.');
    const row = await ensureCto(launchAddress);
    if (!row) return bad('Launch not found.', 404);
    const kind = action.endsWith('repo') ? 'repo' : 'wallet';
    const links = await prisma.buildLink.findMany({ where: { launchAddress: row.launchAddress, active: true, kind } });
    const exists = links.some((l) => l.value.toLowerCase() === value.toLowerCase());
    if (action.startsWith('link')) {
      if (exists) return bad(kind === 'repo' ? 'This repo is already linked.' : 'This wallet is already linked.', 409);
      if (kind === 'repo' && links.length >= MAX_REPOS) return bad(`Up to ${MAX_REPOS} repos per token.`);
      if (kind === 'wallet' && links.length >= MAX_WALLETS) return bad(`Up to ${MAX_WALLETS} extra wallets per token.`);
      if (kind === 'wallet' && value === row.creator.toLowerCase()) return bad('The creator wallet is already tracked.');
    } else if (!exists) return bad('That item is not linked.', 404);

    await prisma.buildNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    if ((await prisma.buildNonce.count({ where: { launchAddress: row.launchAddress } })) >= 10) return bad('Too many open requests. Try again in a few minutes.', 429);
    const nonce = `build:${crypto.randomBytes(16).toString('hex')}`;
    const expiresAt = new Date(Date.now() + NONCE_TTL_MS);
    await prisma.buildNonce.create({ data: { nonce, launchAddress: row.launchAddress, action, expiresAt } });
    const message = buildMessage({ action, token: row.tokenAddress, launch: row.launchAddress, value, nonce, expires: expiresAt.toISOString() });
    return NextResponse.json({ nonce, value, expires: expiresAt.toISOString(), message });
  } catch (e: any) {
    console.error('build nonce failed', e?.message);
    return bad('Could not start the request. Try again.', 500);
  }
}
