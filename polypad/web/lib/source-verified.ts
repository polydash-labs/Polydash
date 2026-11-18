// One rule for "source verified", shared by the Health Score row and the Holder Protections security check:
// verified when the token or launch contract is verified on Sourcify OR Blockscout. Cached 1 h (verification is sticky).
import { explorerV2 } from '@/lib/xray/blockscout';
import { EXPLORER_BASE_URL } from '@/lib/source-verified-shared';

export interface SourceVerified {
  verified: boolean;
  /** false = neither explorer could be reached, so the result is not known. */
  known: boolean;
  via: 'sourcify' | 'blockscout' | null;
  address: string | null;
  url: string | null;
}

const CHAIN_ID = 4663;
const TTL = 60 * 60_000;
const cache = new Map<string, { at: number; value: SourceVerified }>();

async function sourcify(a: string): Promise<boolean | null> {
  try {
    const res = await fetch(`https://sourcify.dev/server/v2/contract/${CHAIN_ID}/${a}`, { signal: AbortSignal.timeout(6_000), cache: 'no-store' });
    if (res.status === 200) return true;
    if (res.status === 404) return false;
    return null;
  } catch { return null; }
}

async function blockscout(a: string): Promise<boolean | null> {
  try {
    const r = await explorerV2(`/addresses/${a}`);
    if (!r) return false;
    return typeof r.is_verified === 'boolean' ? r.is_verified : null;
  } catch { return null; }
}

/** Checks addresses in order (token first, then launch); first verified one wins. */
export async function getSourceVerified(addresses: (string | null | undefined)[]): Promise<SourceVerified> {
  const list = [...new Set(addresses.filter(Boolean).map((a) => String(a).toLowerCase()))];
  const key = list.join(',');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  // "Not verified" is only known when both explorers answered for every address; one unreachable explorer = unknown.
  let allKnown = list.length > 0;
  let value: SourceVerified | null = null;
  for (const a of list) {
    const [s, b] = await Promise.all([sourcify(a), blockscout(a)]);
    if (s === null || b === null) allKnown = false;
    if (s) { value = { verified: true, known: true, via: 'sourcify', address: a, url: `https://repo.sourcify.dev/${CHAIN_ID}/${a}` }; break; }
    if (b) { value = { verified: true, known: true, via: 'blockscout', address: a, url: `${EXPLORER_BASE_URL}/address/${a}?tab=contract` }; break; }
  }
  value ??= { verified: false, known: allKnown, via: null, address: null, url: null };
  if (value.known) cache.set(key, { at: Date.now(), value });
  return value;
}
