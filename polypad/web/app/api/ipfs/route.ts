import { NextResponse } from 'next/server';
import { ipfsToHttp, parseIpfs } from '@/lib/fund/phase6';
import { bundledMandate } from '@/lib/fund/mandates';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 64_000;
const TTL_MS = 60 * 60 * 1000;
/** A gateway miss is remembered this long, so pages with a bundled copy answer at once instead of re-waiting on every gateway. */
const MISS_TTL_MS = 5 * 60 * 1000;
/** Overall wait for gateways when a bundled copy exists. */
const BUNDLED_DEADLINE_MS = 4_000;
const cache = new Map<string, { at: number; text: string | null }>();

function gateways(cid: string, path: string): string[] {
  const p = path ? `/${path}` : '';
  const sub = cid.startsWith('b') ? [`https://${cid}.ipfs.w3s.link${p}`, `https://${cid}.ipfs.dweb.link${p}`] : [];
  return [...sub, `https://dweb.link/ipfs/${cid}${p}`, `https://ipfs.io/ipfs/${cid}${p}`, `https://w3s.link/ipfs/${cid}${p}`, `https://cloudflare-ipfs.com/ipfs/${cid}${p}`,
    `https://gateway.pinata.cloud/ipfs/${cid}${p}`, `https://ipfs.filebase.io/ipfs/${cid}${p}`, `https://4everland.io/ipfs/${cid}${p}`, `https://nftstorage.link/ipfs/${cid}${p}`];
}

/** Asks the public IPFS router whether any node announces this CID. null = unknown. */
async function providerCount(cid: string): Promise<number | null> {
  try {
    const r = await fetch(`https://delegated-ipfs.dev/routing/v1/providers/${cid}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8_000) });
    if (r.status === 404) return 0;
    if (!r.ok) return null;
    const j = (await r.json()) as { Providers?: unknown[] | null };
    return Array.isArray(j.Providers) ? j.Providers.length : 0;
  } catch {
    return null;
  }
}

async function tryFetch(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6_000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { accept: 'text/plain,text/markdown,application/json,text/html;q=0.5' } });
    if (!r.ok) return null;
    const type = r.headers.get('content-type') ?? '';
    if (/image|video|audio|octet-stream/.test(type)) return null;
    const text = (await r.text()).slice(0, MAX_BYTES);
    if (/<html/i.test(text.slice(0, 500))) {
      const plain = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').trim();
      return /service worker|captcha|blocked|just a moment|verify you are human|cf-chl|attention required/i.test(plain.slice(0, 400)) ? null : plain;
    }
    return text;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** GET /api/ipfs?uri=ipfs://CID[/path] → { ok, text, url }. Tries several public gateways server-side. */
export async function GET(req: Request) {
  const uri = new URL(req.url).searchParams.get('uri') ?? '';
  const parsed = parseIpfs(uri);
  if (!parsed) return NextResponse.json({ ok: false, text: null, url: '', error: 'Not a valid IPFS address.' }, { status: 400 });
  const key = `${parsed.cid}/${parsed.path}`;
  const url = ipfsToHttp(uri);
  const bundled = bundledMandate(uri);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS && hit.text) return NextResponse.json({ ok: true, text: hit.text, url, source: 'ipfs' });
  if (bundled && hit && !hit.text && Date.now() - hit.at < MISS_TTL_MS) {
    return NextResponse.json({ ok: true, text: bundled, url, reason: 'gateways_failed', source: 'bundled' }, { headers: { 'cache-control': 'no-store' } });
  }
  const fetches = gateways(parsed.cid, parsed.path).map((g) => tryFetch(g));
  const firstText = new Promise<string | null>((resolve) => {
    let left = fetches.length;
    fetches.forEach((f) => f.then((t) => { if (t) resolve(t); else if (--left === 0) resolve(null); }));
  });
  const deadline = bundled ? new Promise<null>((r) => setTimeout(() => r(null), BUNDLED_DEADLINE_MS)) : null;
  const [providers, text] = await Promise.all([
    bundled ? Promise.race([providerCount(parsed.cid), new Promise<null>((r) => setTimeout(() => r(null), BUNDLED_DEADLINE_MS))]) : providerCount(parsed.cid),
    deadline ? Promise.race([firstText, deadline]) : firstText,
  ]);
  cache.set(key, { at: Date.now(), text });
  const reason = text ? undefined : providers === 0 ? 'not_hosted' : 'gateways_failed';
  if (!text && bundled) return NextResponse.json({ ok: true, text: bundled, url, reason, source: 'bundled' }, { headers: { 'cache-control': 'no-store' } });
  return NextResponse.json({ ok: !!text, text, url, reason, source: text ? 'ipfs' : undefined }, { headers: { 'cache-control': text ? 'public, max-age=3600' : 'no-store' } });
}
