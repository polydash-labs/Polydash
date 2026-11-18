import { NextResponse } from 'next/server';
import { IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_ITEMS, draftKey, exists, isDraftId, presignPut, publicUrl } from '@/lib/nft-storage';

export const dynamic = 'force-dynamic';

/** Presigns write-once uploads for a collection draft: the cover image and/or numbered item images (max 100 per call). */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const draftId = body?.draftId;
    if (!isDraftId(draftId)) return NextResponse.json({ error: 'Invalid draft.' }, { status: 400 });
    const files: any[] = Array.isArray(body?.files) ? body.files : [];
    if (files.length === 0 || files.length > 100) return NextResponse.json({ error: 'Send 1 to 100 files per request.' }, { status: 400 });

    const out = await Promise.all(files.map(async (f) => {
      const ext = IMAGE_TYPES[String(f?.contentType ?? '')];
      const size = Number(f?.size ?? 0);
      if (!ext) throw new Error('Use PNG, JPG, WEBP or GIF images.');
      if (!size || size > MAX_IMAGE_BYTES) throw new Error('Each image must be 10 MB or smaller.');
      let rel: string;
      if (f?.kind === 'cover') rel = `cover.${ext}`;
      else {
        const n = Number(f?.index);
        if (!Number.isInteger(n) || n < 1 || n > MAX_ITEMS) throw new Error('Invalid image number.');
        rel = `images/${n}.${ext}`;
      }
      const key = draftKey(draftId, rel);
      if (await exists(key)) throw new Error('This draft already has that file. Start a new upload.');
      return { kind: f?.kind === 'cover' ? 'cover' : 'image', index: f?.index ?? null, uploadUrl: await presignPut(key, f.contentType), publicUrl: await publicUrl(key) };
    }));
    return NextResponse.json({ files: out });
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : '';
    if (msg && !msg.includes('credential') && msg.length < 120) return NextResponse.json({ error: msg }, { status: 400 });
    console.error('nft upload presign failed', e);
    return NextResponse.json({ error: 'Could not prepare upload.' }, { status: 500 });
  }
}
