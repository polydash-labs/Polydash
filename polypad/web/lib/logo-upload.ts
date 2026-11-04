/**
 * Logo upload policy for POST /api/upload/logo.
 *
 * Auth: the web app has no server session and no wallet-auth helper. Wallet
 * connection is client-only (wagmi). `NEXTAUTH_URL` is the public base URL,
 * not a session. This route therefore requires a browser Origin — or Referer,
 * when Origin is absent — whose host matches the app host (x-forwarded-host,
 * Host, or NEXTAUTH_URL). That blocks another website from minting upload
 * URLs in a visitor's browser. A non-browser client can still set those
 * headers; the presigned POST conditions and the rate limit bound that case.
 */

export const LOGO_CONTENT_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export const LOGO_MAX_BYTES = 5 * 1024 * 1024;
export const LOGO_POST_EXPIRES_SECONDS = 5 * 60;
export const LOGO_RATE_LIMIT = 10;
export const LOGO_RATE_WINDOW_MS = 10 * 60 * 1000;

export type LogoPostCondition =
  | ['content-length-range', number, number]
  | ['eq', '$Content-Type', string];

export type LogoPresignInput = {
  id: string;
  ext: string;
  contentType: string;
};

export type LogoPresignResult = {
  uploadUrl: string;
  fields: Record<string, string>;
  cloud_storage_path: string;
};

export type LogoUploadResult = {
  status: number;
  body: Record<string, unknown>;
};

export type LogoUploadDeps = {
  limiter: { allow: (key: string) => boolean };
  presign: (input: LogoPresignInput) => Promise<LogoPresignResult>;
  publicUrl: (cloudStoragePath: string) => Promise<string>;
  randomId: () => string;
};

/** Exact object key. folderPrefix is concatenated the same way as other public uploads. */
export function logoObjectKey(folderPrefix: string, id: string, ext: string): string {
  return `${folderPrefix}public/uploads/token-logos/${id}.${ext}`;
}

export function logoPostConditions(contentType: string): LogoPostCondition[] {
  return [
    ['content-length-range', 1, LOGO_MAX_BYTES],
    ['eq', '$Content-Type', contentType],
  ];
}

type Clock = () => number;

export function createRateLimiter(limit: number, windowMs: number, now: Clock = Date.now) {
  const hits = new Map<string, number[]>();
  return {
    /**
     * In-memory sliding window. A shared store is needed for this limit to
     * apply across instances.
     */
    allow(key: string): boolean {
      const t = now();
      const start = t - windowMs;
      const recent = (hits.get(key) ?? []).filter((ts) => ts > start);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(t);
      hits.set(key, recent);
      if (hits.size > 5000) {
        for (const [ip, stamps] of hits) {
          const kept = stamps.filter((ts) => ts > start);
          if (kept.length === 0) hits.delete(ip);
          else hits.set(ip, kept);
        }
      }
      return true;
    },
  };
}

// In-memory sliding window: 10 requests per 10 minutes per IP.
// A shared store is needed for this limit to apply across instances.
export const logoRateLimiter = createRateLimiter(LOGO_RATE_LIMIT, LOGO_RATE_WINDOW_MS);

export function clientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const real = req.headers.get('x-real-ip')?.trim();
  if (real) return real;
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}

function hostOf(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  try {
    return new URL(raw.includes('://') ? raw : `http://${raw}`).host.toLowerCase();
  } catch {
    return null;
  }
}

export function allowedAppHosts(req: Request): Set<string> {
  const hosts = new Set<string>();
  const add = (value: string | null) => {
    if (!value) return;
    for (const part of value.split(',')) {
      const host = hostOf(part);
      if (host) hosts.add(host);
    }
  };
  add(req.headers.get('x-forwarded-host'));
  add(req.headers.get('host'));
  if (process.env.NEXTAUTH_URL) add(process.env.NEXTAUTH_URL);
  return hosts;
}

/** Origin host must match the app host. Referer is used only when Origin is absent. */
export function isSameOrigin(req: Request): boolean {
  const allowed = allowedAppHosts(req);
  if (allowed.size === 0) return false;
  const origin = req.headers.get('origin');
  if (origin) {
    if (origin === 'null') return false;
    const host = hostOf(origin);
    return host !== null && allowed.has(host);
  }
  const referer = req.headers.get('referer');
  if (!referer) return false;
  const host = hostOf(referer);
  return host !== null && allowed.has(host);
}

async function defaultPresign(input: LogoPresignInput): Promise<LogoPresignResult> {
  const { generatePresignedLogoPost } = await import('./s3');
  return generatePresignedLogoPost(input);
}

async function defaultPublicUrl(cloudStoragePath: string): Promise<string> {
  const { getPublicFileUrl } = await import('./s3');
  return getPublicFileUrl(cloudStoragePath);
}

export async function handleLogoUpload(req: Request, deps: Partial<LogoUploadDeps> = {}): Promise<LogoUploadResult> {
  const limiter = deps.limiter ?? logoRateLimiter;
  const presign = deps.presign ?? defaultPresign;
  const publicUrl = deps.publicUrl ?? defaultPublicUrl;
  const randomId = deps.randomId ?? (() => crypto.randomUUID());

  try {
    if (!limiter.allow(clientIp(req))) {
      return { status: 429, body: { error: 'Too many upload requests. Try again later.' } };
    }
    if (!isSameOrigin(req)) {
      return { status: 403, body: { error: 'Upload is only available from this site.' } };
    }
    const body = await req.json().catch(() => ({}));
    const contentType = String((body as { contentType?: unknown })?.contentType ?? '');
    const ext = LOGO_CONTENT_TYPES[contentType];
    if (!ext) {
      return { status: 400, body: { error: 'Use a PNG, JPG, WEBP or GIF image.' } };
    }
    const id = randomId();
    const signed = await presign({ id, ext, contentType });
    const url = await publicUrl(signed.cloud_storage_path);
    return {
      status: 200,
      body: {
        uploadUrl: signed.uploadUrl,
        fields: signed.fields,
        cloud_storage_path: signed.cloud_storage_path,
        publicUrl: url,
      },
    };
  } catch (e) {
    console.error('logo presign failed', e);
    return { status: 500, body: { error: 'Could not prepare upload.' } };
  }
}
