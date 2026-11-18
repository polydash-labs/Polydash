import { NextResponse } from 'next/server';
import { getAddress, isHex } from 'viem';
import { prisma } from '@/lib/db';
import { ensureCto } from '@/lib/cto/chain';
import { publicClient } from '@/lib/agents/tools';
import { PolydashLaunchABI } from '@/lib/contracts/abis';
import { buildMessage, EXPLORER, MAX_REPOS, MAX_WALLETS, normaliseValue, type BuildAction } from '@/lib/buildact/shared';
import { getBuildView } from '@/lib/buildact/view';
import { getExternalToken } from '@/lib/listed-tokens';

export const dynamic = 'force-dynamic';

const ACTIONS: BuildAction[] = ['link_repo', 'unlink_repo', 'link_wallet', 'unlink_wallet'];
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

// Cached read only (no GitHub/explorer calls on this path).
export async function GET(_req: Request, { params }: { params: Promise<{ launchAddress: string }> }) {
  const { launchAddress } = await params;
  try {
    const row = await ensureCto(launchAddress);
    if (!row) return bad('Launch not found.', 404);
    return NextResponse.json({ creator: row.creator, build: await getBuildView(row.launchAddress) });
  } catch (e: any) {
    console.error('build view failed', e?.message);
    return bad('Could not load build activity.', 500);
  }
}

async function creatorWallets(launch: string): Promise<string[]> {
  // Listed (non-factory) tokens have no launch contract: the record's creator is the only signer.
  const ext = getExternalToken(launch);
  if (ext) return [ext.creator.toLowerCase()];
  const read = (functionName: 'creator' | 'creatorPayoutWallet') =>
    publicClient.readContract({ address: getAddress(launch), abi: PolydashLaunchABI, functionName }).then((a) => String(a).toLowerCase()).catch(() => null);
  const out = await Promise.all([read('creator'), read('creatorPayoutWallet')]);
  return Array.from(new Set(out.filter((a): a is string => !!a && a !== '0x0000000000000000000000000000000000000000')));
}

// Signature-gated link/unlink. The creator (creator() or creatorPayoutWallet()) signs; an extra wallet
// being linked also signs the same message itself. No transactions, no GitHub OAuth.
export async function POST(req: Request, { params }: { params: Promise<{ launchAddress: string }> }) {
  const { launchAddress } = await params;
  let body: any;
  try { body = await req.json(); } catch { return bad('Invalid request.'); }
  try {
    const action = String(body?.action ?? '') as BuildAction;
    if (!ACTIONS.includes(action)) return bad('Unknown action.');
    const value = normaliseValue(action, body?.value);
    const nonce = String(body?.nonce ?? '');
    const signature = String(body?.signature ?? '');
    const walletSignature = String(body?.walletSignature ?? '');
    if (!value || !/^build:[0-9a-f]{32}$/.test(nonce) || !isHex(signature)) return bad('Invalid request.');
    const row = await ensureCto(launchAddress);
    if (!row) return bad('Launch not found.', 404);

    const stored = await prisma.buildNonce.findUnique({ where: { nonce } });
    if (!stored || stored.launchAddress !== row.launchAddress || stored.action !== action || stored.expiresAt < new Date()) return bad('This request expired. Try again.', 401);
    const message = buildMessage({ action, token: row.tokenAddress, launch: row.launchAddress, value, nonce, expires: stored.expiresAt.toISOString() });

    const allowed = await creatorWallets(row.launchAddress);
    if (!allowed.length) return bad('Could not read the creator wallet right now. Try again.', 503);
    let signer: string | null = null;
    for (const a of allowed) {
      if (await publicClient.verifyMessage({ address: getAddress(a), message, signature: signature as `0x${string}` }).catch(() => false)) { signer = a; break; }
    }
    if (!signer) return bad('Only the token creator can change build links. The signature does not match the creator wallet.', 403);
    if (action === 'link_wallet') {
      if (!isHex(walletSignature)) return bad('The wallet being linked must also sign the message.', 400);
      const ok = await publicClient.verifyMessage({ address: getAddress(value), message, signature: walletSignature as `0x${string}` }).catch(() => false);
      if (!ok) return bad('The wallet signature does not match that wallet.', 403);
    }

    const kind = action.endsWith('repo') ? 'repo' : 'wallet';
    const links = await prisma.buildLink.findMany({ where: { launchAddress: row.launchAddress, active: true, kind } });
    const current = links.find((l) => l.value.toLowerCase() === value.toLowerCase());
    if (action.startsWith('link')) {
      if (current) return bad('Already linked.', 409);
      if (links.length >= (kind === 'repo' ? MAX_REPOS : MAX_WALLETS)) return bad('Link limit reached.');
    } else if (!current) return bad('That item is not linked.', 404);

    const deleted = await prisma.buildNonce.deleteMany({ where: { nonce } }); // one-time use
    if (deleted.count !== 1) return bad('This request was already used. Try again.', 409);

    const url = kind === 'repo' ? `https://github.com/${value}` : `${EXPLORER}/address/${getAddress(value)}`;
    const label = kind === 'repo' ? `GitHub repo ${value}` : `deployer wallet ${value.slice(0, 6)}…${value.slice(-4)}`;
    if (action.startsWith('link')) {
      const link = await prisma.buildLink.create({ data: { launchAddress: row.launchAddress, kind, value, signer, signature, message } });
      await prisma.buildShip.create({ data: { launchAddress: row.launchAddress, kind: 'link', title: `Creator linked ${label}`, url, at: link.createdAt, dedupeKey: `${row.launchAddress}:link:${link.id}` } });
    } else {
      const at = new Date();
      await prisma.buildLink.update({ where: { id: current!.id }, data: { active: false, removedAt: at } });
      await prisma.buildShip.create({ data: { launchAddress: row.launchAddress, kind: 'unlink', title: `Creator unlinked ${label}`, url, at, dedupeKey: `${row.launchAddress}:unlink:${current!.id}` } });
    }
    // Background refresh (the GitHub client enforces its own hourly budget and pauses).
    import('@/lib/buildact/refresh').then((m) => m.refreshBuild(row, true)).catch(() => null);
    return NextResponse.json({ ok: true, build: await getBuildView(row.launchAddress) });
  } catch (e: any) {
    console.error('build link failed', e?.message);
    return bad('Could not save the change. Try again.', 500);
  }
}
