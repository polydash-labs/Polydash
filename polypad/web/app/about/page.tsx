import type { Metadata } from 'next';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { Button } from '@/components/ui/button';
import { HowItWorksSteps, Faq } from '@/components/how-it-works';
import { getExplorerAddressUrl } from '@/lib/contracts/addresses';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'About | Polypad',
  description: 'How Polypad works: token creation, commitment windows, bonding curves, graduation to Uniswap V4, and NFT collections on Robinhood Chain.',
  path: '/about',
});

const steps = [
  {
    title: 'Create',
    body: 'Anyone can launch a token from the Create page: name, ticker, logo, description and links, plus a creator fee between 0% and 5%. The fee is chosen before launch and stays the same after graduation. The full fixed supply is minted once to the token’s own launch contract. The token has no owner, mint, pause, blacklist or transfer tax.',
  },
  {
    title: 'Commitment window (optional)',
    body: 'The creator can open a commitment window of 24 hours, 3 days or 7 days before trading starts. During the window, users commit ETH and can withdraw it in full at any time. When the window ends, anyone can trigger the launch: the creator’s dev buy executes first, then commitments are filled in batches at curve prices.',
  },
  {
    title: 'Bonding curve',
    body: '80% of the supply is sold on a constant-product bonding curve priced in ETH. The price rises as tokens are bought and falls as they are sold, so there is always a quote to buy or sell. The token page charts market cap over time from on-chain trades and shows progress toward graduation.',
  },
  {
    title: 'Graduation to Uniswap V4',
    body: 'When the ETH raised reaches the graduation threshold, the launch graduates automatically in the same transaction. The raised ETH and the reserved 20% of supply are added as full-range liquidity to a Uniswap V4 pool at the final curve price. That liquidity is held by the Polypad hook contract, which has no code path to remove it, so it is locked permanently.',
  },
];

const nftItems = [
  {
    title: 'Commitment-window collections',
    body: 'Fixed mint price. During a 24-hour, 3-day or 7-day window, buyers commit ETH. If more NFTs are committed than the supply, everyone receives the same share and the rest of their ETH is refunded when they claim. Leftover supply can be minted afterwards at the same price.',
  },
  {
    title: 'Bonding-curve collections',
    body: 'The price of each NFT rises by a fixed step for every NFT held and falls when one is sold back. Holders can sell back to the pool at the curve price until every NFT is in circulation. At that point the collection graduates: the creator’s chosen share of the pool (20% to 80%) becomes a floor vault and the rest goes to the creator.',
  },
  {
    title: 'Floor vault',
    body: 'Every collection keeps part of the ETH paid for its NFTs in the collection contract. Any holder can burn an NFT at any time to receive their share. Nobody, including the creator, can withdraw it otherwise.',
  },
  {
    title: 'Marketplace and royalties',
    body: 'Holders can list NFTs at a fixed price and buyers can make offers on a specific NFT or on any NFT in a collection. The creator royalty (0% to 10%, ERC-2981) is paid on every sale through the Polypad marketplace.',
  },
  {
    title: 'Token rewards',
    body: 'A creator can deposit an ERC-20 token amount for each NFT in a collection. Each holder claims the reward for the NFTs they hold, once per NFT, before the deadline the creator set.',
  },
];

const facts = [
  { label: 'Network', value: 'Robinhood Chain (chain ID 4663)' },
  { label: 'Creator fee', value: '0% to 5%, set at launch and fixed for the life of the token, in ETH' },
  { label: 'Curve supply', value: '80% of total supply' },
  { label: 'Liquidity reserve', value: '20% of total supply' },
  { label: 'After graduation', value: 'Uniswap V4 pool, fees enforced by the hook' },
  { label: 'NFT royalty', value: '0% to 10%, paid on Polypad marketplace sales' },
  { label: 'Security', value: 'Security-scanned with Bevor. Not a formal audit. Source verified on Sourcify; automated security reviews run with findings fixed.' },
];

const contracts = [
  { label: 'Factory', address: '0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2' },
  { label: 'Launch implementation', address: '0x2e0026da8f2E151f63A4313aCD1a579172D9D2Ad' },
  { label: 'Uniswap V4 hook', address: '0x4d3066bBfF889023def912D2fDe36c44357fA0cC' },
  { label: 'Commit vault', address: '0xF013bF17D511E2f65D0dA4Bd320948646F567Ae4' },
  { label: 'NFT factory', address: '0x297c232F2EBCbB4e3Cd0b97167a971fF795EDdDd' },
  { label: 'NFT bonding-curve factory', address: '0x8bdb1d8Db9aeC18bB464F719d5Bd97cFf8F1Ee94' },
  { label: 'NFT marketplace', address: '0x4Ff1d0E3Aa767C05b2D9983e14dDbC243CB0120A' },
  { label: 'NFT token rewards', address: '0xCD96D8e10a82b41A08342c03a176c20336bD0b38' },
  { label: 'Earlier factory (fee up to 2%, launches still listed)', address: '0x2C84cFCD8d283EF750E09Fbed735d67F67845dB2' },
  { label: 'Earlier Uniswap V4 hook', address: '0x04990E6671C98e1B43034E52366Af11396d960CC' },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-5 sm:px-8 py-10 sm:py-16 space-y-12 sm:space-y-16">
          <section>
            <h1 className="text-[28px] sm:text-[40px] font-semibold tracking-tight leading-tight">About Polypad</h1>
            <p className="mt-4 text-[15px] leading-relaxed text-white/60">
              Polypad is a token launchpad on Robinhood Chain. It lets anyone create an ERC-20 token, sell it on a bonding
              curve, and move it to a Uniswap V4 pool with permanently locked liquidity once enough ETH has been raised.
              Creators can also launch NFT collections with a floor vault, a marketplace and token rewards for holders.
              Every step runs on smart contracts; the site reads launches directly from the chain.
            </p>
          </section>

          <HowItWorksSteps />

          <section>
            <h2 className="text-[15px] font-semibold mb-5">How a launch works</h2>
            <ol className="space-y-3">
              {steps.map((s, i) => (
                <li key={s.title} className="glass-card rounded-2xl p-4 sm:p-5 flex gap-4">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-polydash-green/15 font-mono text-[12px] font-semibold text-polydash-green">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[14px] font-semibold">{s.title}</h3>
                    <p className="mt-1.5 text-[13px] sm:text-[14px] leading-relaxed text-white/60">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <h2 className="text-[15px] font-semibold mb-2">NFT collections</h2>
            <p className="mb-5 text-[13px] sm:text-[14px] leading-relaxed text-white/60">
              Creators can launch PFP collections with one image and metadata file per NFT, sold in one of two ways.
            </p>
            <div className="space-y-3">
              {nftItems.map((s) => (
                <div key={s.title} className="glass-card rounded-2xl p-4 sm:p-5">
                  <h3 className="text-[14px] font-semibold">{s.title}</h3>
                  <p className="mt-1.5 text-[13px] sm:text-[14px] leading-relaxed text-white/60">{s.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-[15px] font-semibold mb-5">Key parameters</h2>
            <dl className="glass-card rounded-2xl divide-y divide-white/10">
              {facts.map((f) => (
                <div key={f.label} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <dt className="text-[13px] text-white/50">{f.label}</dt>
                  <dd className="text-[13px] sm:text-[14px] font-medium text-white">{f.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section>
            <h2 className="text-[15px] font-semibold mb-5">Contracts</h2>
            <div className="glass-card rounded-2xl divide-y divide-white/10">
              {contracts.map((c) => (
                <a
                  key={c.address}
                  href={getExplorerAddressUrl(c.address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5 transition-colors hover:bg-white/[0.03]"
                >
                  <div className="min-w-0">
                    <div className="text-[13px] text-white/50">{c.label}</div>
                    <div className="font-mono text-[12px] sm:text-[13px] text-white break-all">{c.address}</div>
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-white/40" />
                </a>
              ))}
            </div>
          </section>

          <Faq />

          <section id="risks" className="scroll-mt-24">
            <h2 className="text-[15px] font-semibold mb-3">Risks</h2>
            <p className="text-[13px] sm:text-[14px] leading-relaxed text-white/60">
              Tokens launched on Polypad are created by their users, not by Polypad. Prices on a bonding curve can move
              quickly and most new tokens lose value. Security-scanned with Bevor. Not a formal audit. Source verified on Sourcify; automated security reviews run with findings fixed.
              Only commit or trade what you can afford to lose.
            </p>
          </section>

          <section className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/create">Create a token</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/">Explore tokens</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/docs">Docs</Link>
            </Button>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
