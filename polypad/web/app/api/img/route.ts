import { lookup } from 'dns/promises';
import net from 'net';

export const dynamic = 'force-dynamic';

// Image proxy for token logos: http(s) only, public hosts only, raster images only, 2 MB cap, 6s timeout.
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 6_000;
const MAX_REDIRECTS = 2;
const CACHE_MAX_BYTES = 40 * 1024 * 1024;
const CACHE_TTL = 6 * 3600_000;
const cache = new Map<string, { body: Uint8Array; type: string; at: number }>();
let cacheBytes = 0;

function privateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
}

async function publicHost(u: URL): Promise<boolean> {
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (u.username || u.password) return false;
  if (u.port && !['80', '443', ''].includes(u.port)) return false;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  try {
    const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !privateIp(a.address));
  } catch {
    return false;
  }
}

function sniff(b: Uint8Array): string | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  return null;
}

async function readCapped(res: Response): Promise<Uint8Array | null> {
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_BYTES) return null;
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}

const fail = (status: number, msg: string) => new Response(msg, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });

function send(body: Uint8Array, type: string) {
  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function pinataFallback(u: URL): URL | null {
  // gateway.pinata.cloud/ipfs/<cid>[/path] -> <cid>.ipfs.dweb.link[/path]
  if (u.hostname !== 'gateway.pinata.cloud') return null;
  const m = /^\/ipfs\/([^/]+)(\/.*)?$/.exec(u.pathname);
  if (!m) return null;
  return new URL(`https://${m[1]}.ipfs.dweb.link${m[2] ?? ''}`);
}

async function fetchImage(start: URL): Promise<{ body: Uint8Array; type: string } | null> {
  let url = start;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    if (!(await publicHost(url))) return null;
    let res: Response;
    try {
      res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'image/png,image/jpeg,image/webp,image/gif' } });
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, url);
      continue;
    }
    if (!res.ok) return null;
    const body = await readCapped(res);
    if (!body) return null;
    const type = sniff(body);
    if (!type) return null;
    return { body, type };
  }
  return null;
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('u') ?? '';
  if (!raw || raw.length > 1024) return fail(400, 'Bad image URL');
  let url: URL;
  try { url = new URL(raw); } catch { return fail(400, 'Bad image URL'); }
  const key = url.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return send(hit.body, hit.type);

  // IPFS gateways are slow on cold fetches — retry the primary host, then a
  // fallback gateway, so a first-load doesn't fall back to initials.
  const candidates = [url, pinataFallback(url)].filter((c): c is URL => c !== null);
  for (const candidate of candidates) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const got = await fetchImage(candidate);
      if (!got) continue;
      const { body, type } = got;
      if (body.byteLength <= 1024 * 1024) {
        while (cacheBytes + body.byteLength > CACHE_MAX_BYTES && cache.size) {
          const [k, v] = cache.entries().next().value as [string, { body: Uint8Array }];
          cache.delete(k);
          cacheBytes -= v.body.byteLength;
        }
        cache.set(key, { body, type, at: Date.now() });
        cacheBytes += body.byteLength;
      }
      return send(body, type);
    }
  }
  return fail(502, 'Image unavailable');
}
