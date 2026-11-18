import { readFile } from 'fs/promises';
import path from 'path';
import { ImageResponse } from 'next/og';
import { getTokenPreview, statusText } from '@/lib/token-preview';
import { formatUsd } from '@/lib/format';
import { getLaunchLookup } from '@/lib/launches-server';
import { PHASE } from '@/lib/token-types';

export const dynamic = 'force-dynamic';

const CACHE_HEADERS = { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=600' };
const rendered = new Map<string, { png: Buffer; at: number }>();
const RENDER_TTL = 120_000;

async function loadImage(url: string): Promise<string | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !/image\/(png|jpe?g)/i.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 3_000_000) return null;
    return `data:${type.split(';')[0]};base64,${buf.toString('base64')}`;
  } catch { return null; }
}

async function genericImage(req: Request): Promise<Response> {
  try {
    const png = await readFile(path.join(process.cwd(), 'public', 'og-image.png'));
    return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=60' } });
  } catch {
    return Response.redirect(new URL('/og-image.png', req.url), 302);
  }
}

/** Per-token link preview image (1200x630): logo, name, ticker, market cap, curve progress, health score. */
export async function GET(req: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const key = address.toLowerCase();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return new Response('Not found', { status: 404 });
  const hit = rendered.get(key);
  if (hit && Date.now() - hit.at < RENDER_TTL) return new Response(new Uint8Array(hit.png), { headers: CACHE_HEADERS });
  try {
    const { token: t, health } = await getTokenPreview(address, 4_000);
    if (!t) {
      const { missing } = await getLaunchLookup(address, 1_000).catch(() => ({ missing: false }));
      return missing ? new Response('Not found', { status: 404 }) : genericImage(req);
    }
    const img = await loadImage(t.imageUri);
    const graduated = t.graduated || t.phase === PHASE.Graduated;
    const pct = graduated ? 100 : Math.min(100, Math.max(0, t.curveProgress ?? 0));
    const stat = (label: string, value: string) => (
      <div style={{ display: 'flex', flexDirection: 'column', padding: '22px 26px', borderRadius: 24, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', flex: 1 }}>
        <div style={{ fontSize: 24, color: 'rgba(255,255,255,0.55)' }}>{label}</div>
        <div style={{ fontSize: 52, fontWeight: 700, color: '#FFFFFF', marginTop: 6 }}>{value}</div>
      </div>
    );
    const res = new ImageResponse(
      (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0A0A0A', color: '#FFFFFF', padding: 64, fontFamily: 'sans-serif' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', fontSize: 32, fontWeight: 700 }}>
              <div style={{ width: 18, height: 18, borderRadius: 9, background: '#00E676', marginRight: 14 }} />
              Polypad
            </div>
            <div style={{ fontSize: 24, color: 'rgba(255,255,255,0.55)' }}>Robinhood Chain</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 52 }}>
            {img ? (
              <img src={img} width={128} height={128} style={{ borderRadius: 64, objectFit: 'cover' }} alt="" />
            ) : (
              <div style={{ width: 128, height: 128, borderRadius: 64, background: '#00E676', color: '#0A0A0A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 50, fontWeight: 700 }}>{t.symbol.slice(0, 2).toUpperCase()}</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 32, maxWidth: 880 }}>
              <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.05 }}>{`$${t.symbol}`}</div>
              <div style={{ fontSize: 32, color: 'rgba(255,255,255,0.6)', marginTop: 6 }}>{t.name.slice(0, 48)}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 24, marginTop: 48 }}>
            {stat('Market cap', t.marketCapUsd > 0 ? formatUsd(t.marketCapUsd) : 'n/a')}
            {stat(graduated ? 'Status' : 'Bonding curve', graduated ? 'Graduated' : `${pct.toFixed(1)}%`)}
            {stat('Health score', health == null ? 'n/a' : `${health}/100`)}
          </div>
          <div style={{ display: 'flex', marginTop: 32, height: 14, borderRadius: 7, background: 'rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', width: `${Math.max(pct, pct > 0 ? 1 : 0)}%`, height: 14, borderRadius: 7, background: '#00E676' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'auto', fontSize: 22, color: 'rgba(255,255,255,0.5)' }}>
            <div style={{ display: 'flex' }}>{statusText(t)}</div>
            <div style={{ display: 'flex', color: '#00E676' }}>polypad.abacusai.app</div>
          </div>
        </div>
      ),
      { width: 1200, height: 630 },
    );
    const png = Buffer.from(await res.arrayBuffer());
    rendered.set(key, { png, at: Date.now() });
    if (rendered.size > 500) rendered.delete(rendered.keys().next().value as string);
    return new Response(new Uint8Array(png), { headers: CACHE_HEADERS });
  } catch (e) {
    console.error('token og failed', address, (e as Error)?.message);
    return genericImage(req);
  }
}
