// Pure text/URL sanitising used for on-chain token metadata (shown on cards and token pages) and agent API input.

const cp = (...codes: number[]) => String.fromCodePoint(...codes);
// Bidi overrides/isolates, zero-width characters and the BOM: invisible and used to spoof text.
const INVISIBLE = new RegExp(`[${cp(0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff)}]`, 'g');
// ASCII control characters except tab and newline.
const CONTROL = new RegExp(`[${cp(0)}-${cp(8)}${cp(11)}-${cp(31)}${cp(127)}]`, 'g');

/** Strip HTML tags, control and invisible characters, collapse blank lines, trim and cap the length. */
export function cleanText(input: unknown, max = 1000): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/<[^>]*>/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL, '')
    .replace(INVISIBLE, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

/** Single-line variant for names and symbols. */
export function cleanLine(input: unknown, max = 64): string {
  return cleanText(input, max * 2).replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Only http(s) URLs survive (no javascript:, data:, etc.). Returns the normalised URL or null. */
export function safeHttpUrl(input: unknown, max = 512): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!s || s.length > max) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Image URL as shown in the browser: ipfs:// goes through a public gateway, remote http(s) through the size-limited proxy. */
export function proxiedImage(uri: string | null | undefined): string {
  const s = (uri ?? '').trim();
  if (!s) return '';
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  const url = s.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${s.slice(7).replace(/^ipfs\//, '')}` : safeHttpUrl(s, 1024);
  if (!url) return '';
  return `/api/img?u=${encodeURIComponent(url)}`;
}
