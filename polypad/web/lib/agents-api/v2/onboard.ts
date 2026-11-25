/** The single "what can I do" answer: capabilities, example requests, live counts, and the signing model. */
import { ADDR, CHAIN_ID, CHAIN_NAME, LIMITS, SITE_ORIGIN, WORDING } from './config';
import { type Ctx } from './core';
import { allFunds } from './funds';
import { allLaunches } from './launches';
import { allCollections } from './nfts';

export async function whatCanIDo(ctx: Ctx) {
  const [launches, funds, cols] = await Promise.all([allLaunches(ctx).catch(() => null), allFunds(ctx).catch(() => null), allCollections(ctx).catch(() => null)]);
  const now = ctx.nowSec();
  return {
    ok: true,
    hello: 'Polypad on Robinhood Chain: launch tokens, trade them, join funds, and mint or buy NFTs, from chat. Your wallet signs everything. I never hold your keys.',
    chain: { id: CHAIN_ID, name: CHAIN_NAME },
    live: {
      tokens: launches?.length ?? null,
      tokensOnCurve: launches?.filter((l) => l.phase === 3).length ?? null,
      graduated: launches?.filter((l) => l.phase === 4).length ?? null,
      funds: funds?.length ?? null,
      fundsOpenToMint: funds?.filter((f) => f.statusName === 'raising' && f.deadline > now && f.minted < f.maxSupply && f.publicOpen).length ?? null,
      nftCollections: cols?.length ?? null,
    },
    youCanAsk: [
      { group: 'Explore', examples: ["what's trending", 'show new launches', 'is $POLYCAT risky', 'show open funds', 'show NFT collections'] },
      { group: 'Trade', examples: ['buy 0.01 ETH of POLYCAT', 'sell half my POLYCAT', 'sell all my STAKE'] },
      { group: 'Funds', examples: ['launch a fund with POLYDASH', 'invest in an open fund', 'exit my fund shares'] },
      { group: 'NFTs', examples: ['mint 2 RUGSLAYERS', 'show NFT listings under 0.01 ETH'] },
      { group: 'Create', examples: ['launch a token called Moon Cat, ticker MCAT'] },
      { group: 'Track', examples: ['what do I hold at 0x...', 'did my transaction go through 0x...'] },
    ],
    howSigningWorks: [
      '1. I prepare the action and show a plain summary: what you pay, the minimum you receive, and the fees.',
      '2. I check it against the chain before sending you a link. A transaction that would fail never gets a link.',
      '3. You open a link to polypad.family. The page rebuilds the same action, shows the same summary, and your own wallet asks you to confirm.',
      '4. Ask me for the status afterwards and I will read the result from the chain.',
    ],
    needFromYou: 'A wallet address for anything that moves funds. Browsing needs nothing. Paste an address from MetaMask, Coinbase Wallet, Trust Wallet, or Phantom.',
    guardrails: [
      'Non-custodial: no keys, ever. Never share a private key or seed phrase with me. I will refuse it.',
      `Each action is capped at ${LIMITS.maxActionWei / 10n ** 18n} ETH, and anything above ${LIMITS.confirmLargeWei / 10n ** 18n} ETH asks you to confirm before it goes ahead.`,
      `Slippage defaults to ${LIMITS.defaultSlippageBps / 100}% and cannot go above ${LIMITS.maxSlippageBps / 100}%.`,
      'I do not give price predictions. Tokens, funds, and NFTs can lose all their value.',
      WORDING.notAudited,
    ],
    links: { site: SITE_ORIGIN, docs: 'https://polydash.gitbook.io/polydash-docs/', agentApi: `${SITE_ORIGIN}/api/agents/v2` },
    factories: { launch: ADDR.launchFactories[0].factory, funds: ADDR.fundFactories[0].factory },
  };
}
