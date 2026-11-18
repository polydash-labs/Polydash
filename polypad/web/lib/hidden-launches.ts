// Launches hidden from the home lists, leaderboard, search and sitemap (frontend only; contracts untouched).
// Each entry may be a launch OR token address; matching is case-insensitive. Direct /token pages stay reachable.
// Note: 0x25D1…50A8 is the LAUNCH contract of the real POLYCAT token 0xf6E8…1A79, so it must not be listed here.
const HIDDEN_LAUNCHES: string[] = [];

const hidden = new Set(HIDDEN_LAUNCHES.map((a) => a.toLowerCase()));

export function isHiddenLaunch(t: { launchAddress?: string | null; tokenAddress?: string | null } | null | undefined): boolean {
  if (!t || hidden.size === 0) return false;
  return hidden.has((t.launchAddress ?? '').toLowerCase()) || hidden.has((t.tokenAddress ?? '').toLowerCase());
}
