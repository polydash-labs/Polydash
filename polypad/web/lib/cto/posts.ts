// Templated post drafts built from real data. No predictions, no return language. Isomorphic.
export interface PostInput {
  symbol: string; name: string; url: string; curvePct: number; ethRaised: number; threshold: number; holders: number;
  top10Pct: number; health: number; graduated: boolean; day: string;
  grad?: { ethAdded: number; tokensAdded: number; tokensBurned: number } | null;
  pools?: { address: string; name: string | null; open: boolean }[];
  explorerAddress?: (a: string) => string;
}
export interface PostDraft { id: 'milestone' | 'daily' | 'graduation' | 'staking'; title: string; x: string; telegram: string }

const n = (v: number, d = 2) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : d }) : 'n/a');

export function buildDrafts(p: PostInput): PostDraft[] {
  const out: PostDraft[] = [];
  const m = [90, 75, 50, 25].find((x) => p.curvePct >= x);
  if (!p.graduated) {
    const head = m ? `$${p.symbol} has reached ${m}% of its bonding curve on Polypad.` : `$${p.symbol} bonding curve is at ${n(p.curvePct, 1)}% on Polypad.`;
    out.push({
      id: 'milestone', title: 'Milestone',
      x: `${head} ${n(p.ethRaised, 4)} of ${n(p.threshold, 4)} ETH raised, ${p.holders} holders.`,
      telegram: `${head}\n\nETH raised: ${n(p.ethRaised, 4)} of ${n(p.threshold, 4)}\nHolders: ${p.holders}\n\n${p.url}`,
    });
  }
  out.push({
    id: 'daily', title: 'Daily report',
    x: `$${p.symbol} CTO report, ${p.day}: ${p.holders} holders, top-10 hold ${n(p.top10Pct, 1)}%, curve ${n(p.curvePct, 1)}%, health ${p.health}/100 (heuristic, not an audit).`,
    telegram: `$${p.symbol} CTO daily report (${p.day})\n\nHolders: ${p.holders}\nTop-10 share: ${n(p.top10Pct, 1)}%\nBonding curve: ${n(p.curvePct, 1)}%\nHealth score: ${p.health}/100 (heuristic, not an audit)\n\n${p.url}\nNot financial advice.`,
  });
  if (p.graduated) {
    const g = p.grad;
    const detail = g ? ` ${n(g.ethAdded, 4)} ETH and ${n(g.tokensAdded, 0)} $${p.symbol} were added as Uniswap V4 liquidity.` : ' Liquidity was added to Uniswap V4.';
    out.push({
      id: 'graduation', title: 'Graduation',
      x: `$${p.symbol} has graduated from its Polypad bonding curve.${detail}`,
      telegram: `$${p.symbol} has graduated from its Polypad bonding curve.${detail}${g && g.tokensBurned > 0 ? `\nTokens burned: ${n(g.tokensBurned, 0)}` : ''}\n\n${p.url}`,
    });
  }
  const pool = p.pools?.find((x) => x.open) ?? p.pools?.[0];
  if (pool) {
    const where = p.explorerAddress ? p.explorerAddress(pool.address) : pool.address;
    out.push({
      id: 'staking', title: 'Staking live',
      x: `Staking is ${pool.open ? 'live' : 'set up'} for $${p.symbol}: ${pool.name || 'staking pool'}. Rewards are token-denominated and change as total stake changes.`,
      telegram: `Staking is ${pool.open ? 'live' : 'set up'} for $${p.symbol}\n\nPool: ${pool.name || 'staking pool'}\nContract: ${where}\nRewards are token-denominated and change as total stake changes.\n\n${p.url}`,
    });
  }
  return out;
}

export const xIntent = (text: string, url?: string) => `https://x.com/intent/post?text=${encodeURIComponent(text)}${url ? `&url=${encodeURIComponent(url)}` : ''}`;
