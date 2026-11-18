import Link from 'next/link';
import { Rocket, ArrowLeftRight, Layers, ChevronDown, PieChart, Tag, TrendingUp, Flame, Award, Store } from 'lucide-react';

const STEPS = [
  {
    icon: Rocket,
    title: 'Launch',
    body: 'Create a token in a few minutes: name, ticker, logo and a creator fee from 0% to 5%. The full supply is minted to its own launch contract. No owner, no mint, no tax.',
    href: '/create',
    cta: 'Create a token',
  },
  {
    icon: ArrowLeftRight,
    title: 'Trade',
    body: 'Buy and sell on a bonding curve with a live quote at every step. At the graduation threshold, liquidity moves to Uniswap V4 and is locked permanently.',
    href: '/',
    cta: 'Explore tokens',
  },
  {
    icon: Layers,
    title: 'Stake',
    body: 'Stake tokens in on-chain reward pools created by projects and the community. Track your share, claim rewards and withdraw from the pool page.',
    href: '/stake',
    cta: 'View pools',
  },
  {
    icon: PieChart,
    title: 'Tokenized fund',
    body: 'Start a tokenized fund: people buy shares with ETH, and you manage the money under locked rules you set up front. New assets wait 2 days in public, and holders can leave at any time.',
    href: '/funds',
    cta: 'Create your tokenized fund',
  },
];

const NFT_FEATURES = [
  { icon: Tag, title: 'Fixed-price mint', body: 'Sell at one set price, with a commitment window where buyers reserve a spot before the mint opens.' },
  { icon: TrendingUp, title: 'Bonding-curve sale', body: 'The price moves with each mint, and holders can sell back to the pool until the collection graduates.' },
  { icon: Flame, title: 'Floor vault', body: 'Every collection has a floor vault. Any holder can burn an NFT against it and take their share of the vault.' },
  { icon: Award, title: 'NFT staking', body: 'Stake NFTs for loyalty bonuses that grow the longer you hold, plus set bonuses for staking matching pieces.' },
  { icon: Store, title: 'Marketplace', body: 'Buy and sell on the built-in marketplace. Every sale pays the creator royalty.' },
];

const FAQ = [
  {
    q: 'What fees do I pay?',
    a: 'Each token has a creator fee between 0% and 5%, chosen at launch and fixed for the life of the token. It is shown on the token page before you trade. Every transaction also pays a small network gas fee on Robinhood Chain.',
  },
  {
    q: 'What happens to liquidity?',
    a: 'When a launch reaches its graduation threshold, the raised ETH and the reserved 20% of supply are added as full-range liquidity to a Uniswap V4 pool. That liquidity is held by the Polypad hook contract, which has no code path to remove it, so it is locked permanently.',
  },
  {
    q: 'How does staking work?',
    a: 'Anyone can create a staking pool for a token and fund it with rewards. Rewards are paid per second to stakers in proportion to their share of the pool, so the APR is variable. Always check the token address before staking.',
  },
  {
    q: 'Is Polypad custodial? What are the risks?',
    a: 'Polypad is non-custodial: your funds stay in your wallet or in the on-chain contracts, and every action is a transaction you sign yourself. The launch contracts were reviewed by the Bevor AI team, with findings fixed, and their source is verified. Health scores and X-ray scans are automated signals, not audits. New tokens are high risk.',
  },
];

export function HowItWorksSteps({ compact = false }: { compact?: boolean }) {
  return (
    <section id="how-it-works" className="scroll-mt-24" aria-labelledby="how-it-works-title">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-polydash-green">How it works</p>
          <h2 id="how-it-works-title" className="mt-2 text-[22px] sm:text-[28px] font-semibold tracking-tight">
            Launch, trade, stake, invest. In four steps.
          </h2>
        </div>
        {compact && (
          <Link href="/about#faq" className="inline-flex min-h-10 items-center text-sm text-white/70 transition-colors hover:text-white">
            Read the FAQ
          </Link>
        )}
      </div>
      <ol className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="glass-card flex flex-col rounded-2xl p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03]">
                <s.icon className="h-[18px] w-[18px] text-polydash-green" strokeWidth={1.5} />
              </span>
              <span className="font-mono text-xs text-white/55 tabular-nums">0{i + 1}</span>
            </div>
            <h3 className="mt-4 text-base font-semibold">{s.title}</h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-white/65">{s.body}</p>
            <Link href={s.href} className="mt-4 inline-flex min-h-10 items-center text-sm font-medium text-polydash-green hover:underline">
              {s.cta}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function NftLaunchSection() {
  return (
    <section id="launch-nft" className="mt-12 scroll-mt-24" aria-labelledby="launch-nft-title">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-polydash-green">NFT collections</p>
          <h2 id="launch-nft-title" className="mt-2 text-[22px] sm:text-[28px] font-semibold tracking-tight">Launch NFT Collection</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/65">Two ways to sell, a floor vault on every collection, staking bonuses and a marketplace that pays creators.</p>
        </div>
        <Link href="/nfts" className="inline-flex h-10 items-center rounded-full bg-polydash-green px-4 text-sm font-medium text-black transition-colors hover:bg-polydash-green-light">
          Launch NFT Collection
        </Link>
      </div>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {NFT_FEATURES.map((f) => (
          <li key={f.title} className="glass-card flex flex-col rounded-2xl p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03]">
              <f.icon className="h-[18px] w-[18px] text-polydash-green" strokeWidth={1.5} />
            </span>
            <h3 className="mt-4 text-base font-semibold">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-white/65">{f.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Faq() {
  return (
    <section id="faq" className="scroll-mt-24" aria-labelledby="faq-title">
      <h2 id="faq-title" className="mb-5 text-[22px] sm:text-[28px] font-semibold tracking-tight">
        FAQ
      </h2>
      <div className="glass-card divide-y divide-white/10 rounded-2xl">
        {FAQ.map((f) => (
          <details key={f.q} className="group px-4 sm:px-5">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 text-[15px] font-medium [&::-webkit-details-marker]:hidden">
              {f.q}
              <ChevronDown className="h-4 w-4 shrink-0 text-white/55 transition-transform group-open:rotate-180" strokeWidth={1.5} />
            </summary>
            <p className="pb-4 text-sm leading-relaxed text-white/65">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
