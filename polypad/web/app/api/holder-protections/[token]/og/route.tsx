import { ImageResponse } from 'next/og';
import { getHolderProtections, type CheckId } from '@/lib/holder-protections';
import { getLaunchLookup } from '@/lib/launches-server';

export const dynamic = 'force-dynamic';

const LABEL: Record<CheckId, string> = {
  liquidity_locked: 'Liquidity locked',
  creator_staking_pool: 'Creator staking pool',
  security_clean: 'Security check clean',
  creator_vesting: 'Creator vesting',
  creator_bond: 'Creator bond',
};
const STATUS: Record<string, [string, string]> = {
  pass: ['Pass', '#00E676'], pending: ['Pending', '#FFD54F'], unknown: ['Unknown', 'rgba(255,255,255,0.55)'], fail: ['Broken', '#FF6B6B'],
};
const TIER_STYLE: Record<string, { base: string; text: string }> = {
  gold: { base: 'linear-gradient(135deg, #F6E9C4 0%, #E6CF95 48%, #D4B26F 100%)', text: '#33240A' },
  silver: { base: 'linear-gradient(135deg, #F5F7FA 0%, #DDE3EA 48%, #C3CCD8 100%)', text: '#1A212B' },
  bronze: { base: 'linear-gradient(135deg, #F0C4A1 0%, #D99568 48%, #B46D45 100%)', text: '#1F0B02' },
};
const HOLO = 'linear-gradient(100deg, rgba(103,232,249,0.32) 0%, rgba(167,139,250,0.3) 30%, rgba(244,114,182,0.26) 60%, rgba(252,211,77,0.32) 85%, rgba(103,232,249,0.3) 100%)';
const BAND = 'linear-gradient(115deg, rgba(255,255,255,0) 30%, rgba(103,232,249,0.38) 40%, rgba(167,139,250,0.36) 47%, rgba(244,114,182,0.32) 54%, rgba(252,211,77,0.38) 61%, rgba(255,255,255,0) 71%)';
const GLOSS = 'linear-gradient(180deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 55%)';

/** Share card for the Holder Protections badge (1200x630). 404 for non-launch tokens. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(token)) return new Response('not_polypad_launch', { status: 404 });
  const [hp, lookup] = await Promise.all([getHolderProtections(token), getLaunchLookup(token, 6_000).catch(() => null)]);
  if (!hp) return new Response('not_polypad_launch', { status: 404 });
  const t = lookup?.token;
  const symbol = t?.symbol ?? 'TOKEN';
  const name = t?.name ?? '';
  const tier = hp.tier ? hp.tier[0].toUpperCase() + hp.tier.slice(1) : null;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0A0A0A', color: '#FFFFFF', padding: 64, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 30, fontWeight: 700 }}>Polypad</div>
          <div style={{ fontSize: 24, color: 'rgba(255,255,255,0.55)' }}>{`${hp.passed}/${hp.total} on-chain checks`}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 40 }}>
          <div style={{ fontSize: 60, fontWeight: 700 }}>{`$${symbol}`}</div>
          <div style={{ fontSize: 28, color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>{name}</div>
          {hp.tier && tier ? (
            <div style={{ display: 'flex', marginTop: 20 }}>
              <div
                style={{
                  display: 'flex', alignItems: 'center', height: 64, padding: '0 30px', borderRadius: 32,
                  border: '1px solid rgba(255,255,255,0.5)', color: TIER_STYLE[hp.tier].text,
                  backgroundImage: `${GLOSS}, ${BAND}, ${HOLO}, ${TIER_STYLE[hp.tier].base}`,
                  textShadow: '0 1px 0 rgba(255,255,255,0.4)',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6), 0 2px 8px rgba(0,0,0,0.35)',
                  fontSize: 26, fontWeight: 700, letterSpacing: 3,
                }}
              >
                <svg width="30" height="30" viewBox="0 0 16 16" fill="none" style={{ marginRight: 14 }}>
                  <path d="M8 1.5 13 3.4v4.1c0 3.1-2.1 5.8-5 7-2.9-1.2-5-3.9-5-7V3.4L8 1.5Z" fill={TIER_STYLE[hp.tier].text} fillOpacity="0.12" stroke={TIER_STYLE[hp.tier].text} strokeWidth="1.3" strokeLinejoin="round" />
                  <path d="m5.6 8.1 1.7 1.7 3.1-3.3" stroke={TIER_STYLE[hp.tier].text} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {`HOLDER PROTECTIONS · ${tier.toUpperCase()}`}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', fontSize: 40, fontWeight: 700, marginTop: 20, color: 'rgba(255,255,255,0.8)' }}>
              {`Holder Protections ${hp.passed}/${hp.total}`}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 28, gap: 10 }}>
          {hp.checks.map((c) => {
            const [label, color] = STATUS[c.status] ?? STATUS.unknown;
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', fontSize: 26 }}>
                <div style={{ width: 14, height: 14, borderRadius: 7, background: color, marginRight: 16 }} />
                <div style={{ display: 'flex', width: 380, color: 'rgba(255,255,255,0.85)' }}>{LABEL[c.id] ?? c.id}</div>
                <div style={{ display: 'flex', color }}>{label}</div>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'auto', fontSize: 22, color: 'rgba(255,255,255,0.5)' }}>
          <div style={{ display: 'flex' }}>Scans are not audits. Checks can change.</div>
          <div style={{ display: 'flex', color: '#00E676' }}>Not financial advice</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { 'Cache-Control': 'public, max-age=300' } },
  );
}
