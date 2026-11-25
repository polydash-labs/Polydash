// Creator session cookie: HMAC-SHA256 over address|launch|expiry. Server only.
import crypto from 'crypto';

export const SESSION_TTL = 24 * 60 * 60;
export const cookieName = (launch: string) => `cto_${launch.toLowerCase()}`;
export const loginMessage = (launch: string, nonce: string) => `Polypad Token CTO: verify creator of ${launch.toLowerCase()}. Nonce: ${nonce}`;

function secret() {
  const s = process.env.CTO_SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('Session secret is not configured.');
  return s;
}

const mac = (payload: string) => crypto.createHmac('sha256', secret()).update(payload).digest('hex');

export function signSession(address: string, launch: string) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const payload = `${address.toLowerCase()}|${launch.toLowerCase()}|${exp}`;
  return `${payload}|${mac(payload)}`;
}

/** Returns the signed-in address for this launch, or null. */
export function readSession(value: string | undefined, launch: string): string | null {
  if (!value) return null;
  const parts = value.split('|');
  if (parts.length !== 4) return null;
  const [addr, l, exp, sig] = parts;
  if (l !== launch.toLowerCase() || !/^0x[0-9a-f]{40}$/.test(addr)) return null;
  if (!(Number(exp) > Math.floor(Date.now() / 1000))) return null;
  const expected = mac(`${addr}|${l}|${exp}`);
  const a = Buffer.from(sig, 'hex'), b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return addr;
}

export const cookieOptions = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge: SESSION_TTL };
