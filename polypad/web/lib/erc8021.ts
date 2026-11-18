// ERC-8021 builder-code suffix reader. Pure: computed from a transaction's input when reading, never stored.
// Suffix layout (schema 0): <codes ascii, comma-separated><codesLength 1 byte><schemaId 1 byte><marker 16 bytes>.

export const ERC8021_MARKER = '80218021802180218021802180218021';

export type Attribution = { ref: string; label: 'via Grok' | 'via agent' };

function asciiCodes(hex: string): string[] | null {
  if (!hex || hex.length % 2) return null;
  let s = '';
  for (let i = 0; i < hex.length; i += 2) {
    const c = parseInt(hex.slice(i, i + 2), 16);
    if (!(c >= 0x20 && c <= 0x7e)) return null;
    s += String.fromCharCode(c);
  }
  return s.split(',').map((x) => x.trim());
}

/** Codes before the length byte. Tries the schema-0 layout first, then a length byte directly before the marker. */
export function readCodes(input: string | undefined | null): string[] | null {
  if (!input) return null;
  const h = input.toLowerCase().replace(/^0x/, '');
  if (h.length < 34 || !h.endsWith(ERC8021_MARKER)) return null;
  const body = h.slice(0, -ERC8021_MARKER.length);
  const tryLen = (lenPos: number) => {
    if (lenPos < 0) return null;
    const len = parseInt(body.slice(lenPos, lenPos + 2), 16);
    if (!len || lenPos - len * 2 < 0) return null;
    return asciiCodes(body.slice(lenPos - len * 2, lenPos));
  };
  const schema = body.slice(-2);
  return (schema === '00' ? tryLen(body.length - 4) : null) ?? tryLen(body.length - 2);
}

/** "polypad,<ref>" -> { ref, label }. ref grok shows "via Grok", other refs "via agent". */
export function attributionFromInput(input: string | undefined | null): Attribution | null {
  const codes = readCodes(input);
  if (!codes || codes[0] !== 'polypad') return null;
  const ref = (codes[1] ?? '').toLowerCase();
  if (!/^[a-z0-9_-]{1,24}$/.test(ref)) return { ref: '', label: 'via agent' };
  return { ref, label: ref === 'grok' ? 'via Grok' : 'via agent' };
}
