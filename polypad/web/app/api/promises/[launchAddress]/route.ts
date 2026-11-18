import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAddress, isHex } from 'viem';
import { prisma } from '@/lib/db';
import { ensureCto } from '@/lib/cto/chain';
import { cookieName, readSession } from '@/lib/cto/session';
import { publicClient, erc20ReadAbi } from '@/lib/agents/tools';
import { PolydashLaunchABI } from '@/lib/contracts/abis';
import { canonicalJson, endsAtFor, MAX_ACTIVE, promiseTypedData, validateParams, type PromiseKind } from '@/lib/promises/presets';
import { invalidatePromiseCounts, listPromises, summarize, toView } from '@/lib/promises/summary';

export const dynamic = 'force-dynamic';

const CHAIN_ID = 4663;
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function GET(_req: Request, { params }: { params: Promise<{ launchAddress: string }> }) {
  const { launchAddress } = await params;
  try {
    const row = await ensureCto(launchAddress);
    if (!row) return bad('Launch not found.', 404);
    const promises = await listPromises(row.launchAddress, row.symbol);
    return NextResponse.json({ promises, summary: summarize(promises) });
  } catch (e: any) {
    console.error('promises list failed', e?.message);
    return bad('Could not load promises.', 500);
  }
}

// Append-only: promises can be added, never edited or deleted (no PUT/PATCH/DELETE handlers).
export async function POST(req: Request, { params }: { params: Promise<{ launchAddress: string }> }) {
  const { launchAddress } = await params;
  let body: any;
  try { body = await req.json(); } catch { return bad('Invalid request.'); }
  try {
    const row = await ensureCto(launchAddress);
    if (!row) return bad('Launch not found.', 404);
    const session = readSession((await cookies()).get(cookieName(row.launchAddress))?.value, row.launchAddress);
    if (!session) return bad('Sign in as the token creator first.', 401);
    if (session !== row.creator) return bad('Only the token creator can publish promises.', 403);

    const kind = String(body?.kind ?? '') as PromiseKind;
    const v = validateParams(kind, body?.params, [row.creator, row.launchAddress, row.tokenAddress]);
    if (!v.ok) return bad(v.error);
    const p = v.params;
    const startsAt = Number(body?.startsAt);
    const endsAt = Number(body?.endsAt);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isInteger(startsAt) || Math.abs(startsAt - now) > 600) return bad('This request expired. Try again.');
    if (endsAt !== endsAtFor(kind, p, startsAt)) return bad('The promise dates do not match the preset.');
    const nonce = String(body?.nonce ?? '');
    const signature = String(body?.signature ?? '');
    if (!/^promise:[0-9a-f]{32}$/.test(nonce) || !isHex(signature)) return bad('Invalid request.');

    const stored = await prisma.authNonce.findUnique({ where: { nonce } });
    if (!stored || stored.address !== `promise:${row.creator}` || stored.expiresAt < new Date()) return bad('This request expired. Try again.', 401);

    // The signer must be the on-chain creator of this launch.
    const onchainCreator = (await publicClient.readContract({ address: getAddress(row.launchAddress), abi: PolydashLaunchABI, functionName: 'creator' })) as string;
    const paramsJson = canonicalJson(p);
    const td = promiseTypedData({ launch: row.launchAddress, token: row.tokenAddress, kind, params: paramsJson, startsAt, endsAt, nonce, chainId: CHAIN_ID });
    const ok = await publicClient.verifyTypedData({ address: getAddress(onchainCreator), ...td, signature: signature as `0x${string}` }).catch(() => false);
    if (!ok) return bad('Only the token creator can publish promises. The signature does not match the creator wallet.', 403);

    const active = await prisma.creatorPromise.findMany({ where: { launchAddress: row.launchAddress, status: { in: ['active', 'needs_review'] } }, select: { kind: true, endsAt: true } });
    if (active.length >= MAX_ACTIVE) return bad(`Up to ${MAX_ACTIVE} open promises per token.`);
    if (kind === 'no_sell') {
      const cur = active.filter((a) => a.kind === 'no_sell');
      if (cur.some((a) => a.endsAt >= endsAt)) return bad('You already have an open no-selling promise that ends later. A new one must end after it.');
    }

    const wallets = [row.creator, ...p.wallets];
    const block = Number(await publicClient.getBlockNumber());
    let baseline = BigInt(0);
    if (kind === 'hold') {
      const bals = await Promise.all(wallets.map((w) => publicClient.readContract({ address: getAddress(row.tokenAddress), abi: erc20ReadAbi, functionName: 'balanceOf', args: [getAddress(w)], blockNumber: BigInt(block) })));
      baseline = bals.reduce((a, b) => a + (b as bigint), BigInt(0));
      if (baseline === BigInt(0)) return bad('Your wallets hold no tokens right now, so there is nothing to keep.');
    }

    const deleted = await prisma.authNonce.deleteMany({ where: { nonce } }); // one-time use
    if (deleted.count !== 1) return bad('This request was already used. Try again.', 409);

    const typedData = { ...td, message: { ...td.message, startsAt: String(startsAt), endsAt: String(endsAt) } };
    const created = await prisma.creatorPromise.create({
      data: {
        launchAddress: row.launchAddress, tokenAddress: row.tokenAddress, creator: onchainCreator.toLowerCase(), kind,
        params: p as any, startsAt, endsAt, startBlock: block, baselineBalance: baseline.toString(), linkedWallets: p.wallets,
        typedData: typedData as any, signature, nonce, lastCheckedBlock: block,
      },
    });
    invalidatePromiseCounts();
    return NextResponse.json({ promise: toView(created, row.symbol, null) });
  } catch (e: any) {
    console.error('promise publish failed', e?.message);
    return bad('Could not publish the promise. Try again.', 500);
  }
}
