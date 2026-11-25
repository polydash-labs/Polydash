import { ImageResponse } from 'next/og';
import { ensureCto, getReport, utcDay } from '@/lib/cto/chain';
import { promiseSummary } from '@/lib/promises/summary';
import type { PromiseSummary } from '@/lib/promises/presets';
import { getXray } from '@/lib/xray/scan';
import { getBuildView } from '@/lib/buildact/view';
import { buildLine } from '@/lib/buildact/shared';

const XRAY_OG: Record<string, [string, string]> = {
  clean: ['Clean', '#00E676'], some: ['Some early buyers flagged', '#FFD54F'], heavy: ['Heavy bundling flagged', '#FF5252'],
};

export const dynamic = 'force-dynamic';

async function loadImage(url: string): Promise<string | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !/image\/(png|jpe?g)/i.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 3_000_000) return null;
    return `data:${type.split(';')[0]};base64,${buf.toString('base64')}`;
  } catch { return null; }
}

export async function GET(_req: Request, { params }: { params: Promise<{ launchAddress: string }> }) {
  const { launchAddress } = await params;
  let symbol = 'TOKEN', name = '', health: number | null = null, curve: number | null = null, holders: number | null = null, graduated = false, img: string | null = null, promises: PromiseSummary | null = null;
  let xray: [string, string] = ['Scanning', 'rgba(255,255,255,0.45)'];
  let build = 'Checking';
  try {
    const row = await ensureCto(launchAddress);
    if (row) {
      symbol = row.symbol; name = row.name;
      const [r, i, ps, x, b] = await Promise.all([getReport(row).catch(() => null), loadImage(row.imageUri), promiseSummary(row.launchAddress).catch(() => null), getXray(row.launchAddress), getBuildView(row.launchAddress).catch(() => null)]);
      img = i; promises = ps; build = buildLine(b);
      if (x) xray = x.level === 'waiting' ? ['Waiting for trading', 'rgba(255,255,255,0.45)'] : x.level === 'partial' ? ['Partial scan', 'rgba(255,255,255,0.45)'] : XRAY_OG[x.level] ?? xray;
      if (r) { health = r.health.score; curve = r.graduation.curvePct; holders = r.holders.count; graduated = r.graduation.graduated; }
    }
  } catch (e: any) {
    console.error('cto og failed', launchAddress, e?.message);
  }
  const stat = (label: string, value: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', padding: '24px 28px', borderRadius: 24, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', flex: 1 }}>
      <div style={{ fontSize: 24, color: 'rgba(255,255,255,0.55)' }}>{label}</div>
      <div style={{ fontSize: 56, fontWeight: 700, color: '#FFFFFF', marginTop: 8 }}>{value}</div>
    </div>
  );
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0A0A0A', color: '#FFFFFF', padding: 64, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 30, fontWeight: 700 }}>Polypad</div>
          <div style={{ fontSize: 24, color: 'rgba(255,255,255,0.55)' }}>{`${utcDay()} UTC`}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 56 }}>
          {img ? (
            <img src={img} width={120} height={120} style={{ borderRadius: 60, objectFit: 'cover' }} alt="" />
          ) : (
            <div style={{ width: 120, height: 120, borderRadius: 60, background: '#00E676', color: '#0A0A0A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48, fontWeight: 700 }}>{symbol.slice(0, 2).toUpperCase()}</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 32 }}>
            <div style={{ fontSize: 64, fontWeight: 700 }}>{`$${symbol} CTO Report`}</div>
            <div style={{ fontSize: 28, color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>{name}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 24, marginTop: 56 }}>
          {stat('Health score', health == null ? 'n/a' : `${health}/100`)}
          {stat(graduated ? 'Status' : 'Bonding curve', graduated ? 'Graduated' : curve == null ? 'n/a' : `${curve.toFixed(1)}%`)}
          {stat('Holders', holders == null ? 'n/a' : holders.toLocaleString('en-US'))}
        </div>
        {promises && promises.total > 0 ? (
          <div style={{ display: 'flex', marginTop: 28, fontSize: 28, color: promises.broken > 0 ? '#FF6B6B' : 'rgba(255,255,255,0.8)' }}>
            {`Promises: ${promises.kept} kept, ${promises.active} active${promises.broken > 0 ? `, ${promises.broken} broken` : ''}`}
          </div>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 20, fontSize: 28, color: 'rgba(255,255,255,0.8)' }}>
          <div style={{ width: 16, height: 16, borderRadius: 8, background: xray[1], marginRight: 14 }} />
          <div style={{ display: 'flex' }}>{`X-ray: ${xray[0]}`}</div>
          <div style={{ display: 'flex', marginLeft: 40, color: 'rgba(255,255,255,0.8)' }}>{`Build: ${build}`}</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'auto', fontSize: 22, color: 'rgba(255,255,255,0.5)' }}>
          <div style={{ display: 'flex' }}>Health score is a heuristic, not an audit.</div>
          <div style={{ display: 'flex', color: '#00E676' }}>Not financial advice</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { 'Cache-Control': 'public, max-age=300' } },
  );
}
