import { NextResponse } from 'next/server';
import { MAX_ITEMS, draftKey, exists, isDraftId, publicUrl, putJson } from '@/lib/nft-storage';

export const dynamic = 'force-dynamic';

interface Attr { trait_type: string; value: string | number }

function cleanAttrs(v: unknown): Attr[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 30).flatMap((a: any) => {
    const t = String(a?.trait_type ?? '').trim().slice(0, 64);
    const val = typeof a?.value === 'number' && Number.isFinite(a.value) ? a.value : String(a?.value ?? '').trim().slice(0, 128);
    return t && val !== '' ? [{ trait_type: t, value: val }] : [];
  });
}

/** Writes write-once ERC-721 metadata files <n>.json for a draft (max 250 per call) and returns the base URI. */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const draftId = body?.draftId;
    if (!isDraftId(draftId)) return NextResponse.json({ error: 'Invalid draft.' }, { status: 400 });
    const collectionName = String(body?.collectionName ?? '').trim().slice(0, 64);
    const description = String(body?.description ?? '').trim().slice(0, 1000);
    if (!collectionName) return NextResponse.json({ error: 'Collection name is required.' }, { status: 400 });
    const items: any[] = Array.isArray(body?.items) ? body.items : [];
    if (items.length === 0 || items.length > 250) return NextResponse.json({ error: 'Send 1 to 250 items per request.' }, { status: 400 });

    const imagePrefix = await publicUrl(draftKey(draftId, 'images/'));
    for (const it of items) {
      const n = Number(it?.index);
      if (!Number.isInteger(n) || n < 1 || n > MAX_ITEMS) return NextResponse.json({ error: 'Invalid item number.' }, { status: 400 });
      if (typeof it?.image !== 'string' || !it.image.startsWith(imagePrefix)) {
        return NextResponse.json({ error: `Item ${n} has no uploaded image.` }, { status: 400 });
      }
    }

    await Promise.all(items.map(async (it) => {
      const n = Number(it.index);
      const key = draftKey(draftId, `metadata/${n}.json`);
      if (await exists(key)) throw new Error(`Metadata ${n} already exists. Start a new upload.`);
      await putJson(key, {
        name: String(it?.name ?? '').trim().slice(0, 100) || `${collectionName} #${n}`,
        description,
        image: it.image,
        attributes: cleanAttrs(it?.attributes),
      });
    }));

    return NextResponse.json({ baseURI: await publicUrl(draftKey(draftId, 'metadata/')) });
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.startsWith('Metadata ')) return NextResponse.json({ error: msg }, { status: 409 });
    console.error('nft metadata write failed', e);
    return NextResponse.json({ error: 'Could not save metadata.' }, { status: 500 });
  }
}
