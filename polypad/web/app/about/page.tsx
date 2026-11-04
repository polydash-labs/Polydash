import type { Metadata } from 'next';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { Button } from '@/components/ui/button';
import { getExplorerAddressUrl } from '@/lib/contracts/addresses';

export const metadata: Metadata = {
  title: 'About | Polypad',
  description: 'How Polypad works: token creation, commitment windows, bonding curves, and graduation to Uniswap V4 on Robinhood Chain.',
};

const steps = [
  {
    title: 'Create',
    body: 'Anyone can launch a token from the Create page: name, ticker, logo, description and links, plus a creator fee between 0% and 5% on the current factory (0% to 2% on the earlier factory). The full fixed supply is minted once to the token’s own launch contract. The token has no owner, mint, pause, blacklist or transfer tax.',
  },
  {
    title: 'Commitment window (optional)',
    body: 'The creator can open a commitment window of 24 hours, 3 days or 7 days before trading starts. During the window, users commit ETH and can withdraw it in full at any time. When the window ends, anyone can trigger the launch: the creator’s dev buy executes first, then commitments are filled in batches at curve prices.',
  },
  {
    title: 'Bonding curve',
    body: '80% of the supply is sold on a constant-product bonding curve priced in ETH. Buys and sells are quoted from that curve. The token page shows the curve as market cap against tokens sold, with the current position marked.',
  },
  {
    title: 'Graduation to Uniswap V4',
    body: 'When the ETH raised reaches the graduation threshold, the launch graduates in the same transaction. The raised ETH and the reserved 20% of supply are added as full-range liquidity to a Uniswap V4 pool at the final curve price. That liquidity is held by the Polypad hook contract, which has no function that removes it.',
  },
];

const facts = [
  { label: 'Network', value: 'Robinhood Chain (chain ID 4663)' },
  { label: 'Creator fee', value: '0% to 5% on the current factory (0% to 2% on the earlier factory), set at launch, in ETH' },
  { label: 'Curve supply', value: '80% of total supply' },
  { label: 'Liquidity reserve', value: '20% of total supply' },
  { label: 'After graduation', value: 'Uniswap V4 pool, fees enforced by the hook' },
];

const contracts = [
  { label: 'Factory (current)', address: '0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2' },
  { label: 'Launch implementation (current)', address: '0x2e0026da8f2E151f63A4313aCD1a579172D9D2Ad' },
  { label: 'Uniswap V4 hook (current)', address: '0x4d3066bBfF889023def912D2fDe36c44357fA0cC' },
  { label: 'Commit vault (current)', address: '0xF013bF17D511E2f65D0dA4Bd320948646F567Ae4' },
  { label: 'Factory (earlier)', address: '0x2C84cFCD8d283EF750E09Fbed735d67F67845dB2' },
  { label: 'Launch implementation (earlier)', address: '0xEf7684268f13BC06CB02755642CeAbEf422b8B70' },
  { label: 'Uniswap V4 hook (earlier)', address: '0x04990E6671C98e1B43034E52366Af11396d960CC' },
  { label: 'Commit vault (earlier)', address: '0x8F125c9eC7acD52B9cd39f2a7441085559d84104' },
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
              curve, and move it to a Uniswap V4 pool once enough ETH has been raised. The hook contract has no function
              that removes that liquidity. Every step runs on smart contracts; the site reads launches directly from the chain.
            </p>
          </section>

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

          <section>
            <h2 className="text-[15px] font-semibold mb-3">Risks</h2>
            <p className="text-[13px] sm:text-[14px] leading-relaxed text-white/60">
              Tokens launched on Polypad are created by their users, not by Polypad. The contracts are unaudited. An
              outside review is planned. Using these contracts can result in loss of funds.
            </p>
          </section>

          <section className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/create">Create a token</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/">Explore tokens</Link>
            </Button>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
