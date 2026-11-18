import { NextResponse } from 'next/server';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { prisma } from '@/lib/db';
import { getTreasury } from '@/lib/treasury-server';
import { isAddr, sameAddr, treasuryLive } from '@/lib/treasury';

export const dynamic = 'force-dynamic';

/** GET ?round=&account= returns {amount, proof} from the tree the creator uploaded for that round's root. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!treasuryLive()) return NextResponse.json({ live: false });
  const url = new URL(req.url);
  const round = Number(url.searchParams.get('round'));
  const account = url.searchParams.get('account') ?? '';
  if (!isAddr(token) || !isAddr(account) || !Number.isInteger(round) || round < 0) return NextResponse.json({ error: 'invalid_params' }, { status: 400 });
  try {
    const t = await getTreasury(token.toLowerCase() as `0x${string}`);
    const rd = t.rounds?.find((x) => x.id === round);
    if (!t.vault || !rd) return NextResponse.json({ error: 'round_not_found' }, { status: 404 });
    const row = await prisma.treasuryTree.findUnique({ where: { root: rd.root.toLowerCase() } });
    if (!row) return NextResponse.json({ error: 'tree_not_uploaded' }, { status: 404 });
    const tree = StandardMerkleTree.load(JSON.parse(row.tree));
    for (const [i, v] of tree.entries()) {
      if (sameAddr(String(v[0]), account)) return NextResponse.json({ round, account: account.toLowerCase(), amount: String(v[1]), proof: tree.getProof(i) });
    }
    return NextResponse.json({ error: 'not_in_round' }, { status: 404 });
  } catch (e) {
    console.error('treasury proof lookup failed', e);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

/** POST {tree} stores a StandardMerkleTree dump whose root matches an on-chain round or a pending airdrop change of this token's vault. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!treasuryLive()) return NextResponse.json({ live: false }, { status: 404 });
  if (!isAddr(token)) return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  try {
    const body = await req.json().catch(() => null);
    const dump = typeof body?.tree === 'string' ? JSON.parse(body.tree) : body?.tree;
    if (!dump) return NextResponse.json({ error: 'missing_tree' }, { status: 400 });
    const raw = JSON.stringify(dump);
    if (raw.length > 5_000_000) return NextResponse.json({ error: 'tree_too_large' }, { status: 413 });
    let tree: StandardMerkleTree<any[]>;
    try {
      tree = StandardMerkleTree.load(dump);
      tree.validate();
    } catch {
      return NextResponse.json({ error: 'invalid_tree' }, { status: 400 });
    }
    if (JSON.stringify(dump.leafEncoding) !== JSON.stringify(['address', 'uint256'])) return NextResponse.json({ error: 'leaf_encoding_must_be_address_uint256' }, { status: 400 });
    const root = tree.root.toLowerCase();
    const t = await getTreasury(token.toLowerCase() as `0x${string}`);
    if (!t.vault) return NextResponse.json({ error: 'no_rules' }, { status: 404 });
    const known = (t.rounds ?? []).some((r) => r.root.toLowerCase() === root)
      || (t.pendingChanges ?? []).some((c) => c.kind === 4 && 'root' in c.decoded && String(c.decoded.root).toLowerCase() === root);
    if (!known) return NextResponse.json({ error: 'root_not_found_on_chain' }, { status: 400 });
    await prisma.treasuryTree.upsert({ where: { root }, create: { root, vault: t.vault, tree: raw }, update: { tree: raw, vault: t.vault } });
    return NextResponse.json({ ok: true, root });
  } catch (e) {
    console.error('treasury proof upload failed', e);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
