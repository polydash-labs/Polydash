// Tokens that were launched outside the Polypad factory but have a Polypad token page (server-side only).
// Never merged into allLaunches(), home lists, factory stats or agent lists.
import { getLaunchSnapshot } from '@/lib/launches-server';
import type { LaunchToken } from '@/lib/token-types';

export interface ExternalListedToken {
  address: string;
  chainId: number;
  symbol: string;
  name: string;
  creator: string;
  source: 'external';
  /** First block with token activity (before the factory deploy block). */
  createdBlock: number;
  imageUri: string;
}

export const EXTERNAL_LISTED_TOKENS: ExternalListedToken[] = [
  {
    address: '0x319525528f42167eF7fC18b77b889958080568e4',
    chainId: 4663,
    symbol: 'POLYDASH',
    name: 'Polydash',
    creator: '0x89df38Df79C0a7E96214c596ceF5773d2ac353F1',
    source: 'external',
    createdBlock: 81066606,
    imageUri: '/polydash-mark-white.png',
  },
];

/** The external record for an address (case-insensitive), or null. */
export function getExternalToken(addr: string | null | undefined): ExternalListedToken | null {
  const a = (addr ?? '').toLowerCase();
  return EXTERNAL_LISTED_TOKENS.find((t) => t.address.toLowerCase() === a) ?? null;
}

export type ListedToken =
  | { source: 'factory'; launch: LaunchToken; creator: string; tokenAddress: string }
  | { source: 'external'; record: ExternalListedToken; creator: string; tokenAddress: string };

/** Factory launch first, else the external record. null when neither knows the address (or the RPC is not ready). */
export async function getListedToken(addr: string, waitMs = 3_500): Promise<ListedToken | null> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return null;
  const ext = getExternalToken(addr);
  const launch = await getLaunchSnapshot(addr, ext ? Math.min(waitMs, 1_500) : waitMs).catch(() => null);
  if (launch) return { source: 'factory', launch, creator: launch.creator, tokenAddress: launch.tokenAddress };
  if (ext) return { source: 'external', record: ext, creator: ext.creator, tokenAddress: ext.address };
  return null;
}
