import type { Metadata } from 'next';
import GlossaryBox from '@/components/glossary-box';
import { LegalPage } from '@/components/legal-page';
import { trustMetadata } from '@/lib/trust';

export const metadata: Metadata = trustMetadata({
  title: 'Risk Disclosure | Polypad',
  description: 'Risks of launching, trading, committing and staking on Polypad: new tokens, bonding curves, smart contracts, staking pools, AI agents and more. Not financial advice.',
  path: '/risk',
});

const sections = [
  { h: 'New tokens are high risk', p: 'Tokens on Polypad are created by their users, not by Polydash. Most newly launched tokens lose most or all of their value. Only use funds you can afford to lose.' },
  { h: 'Volatility', p: 'Prices can move sharply in either direction within minutes. Displayed prices, market caps and charts may be delayed.' },
  { h: 'Bonding curve', p: "Before graduation, a token's price is set by a bonding curve. Each buy raises the price and each sell lowers it, so the price you get depends on the size of your trade and on trades just before yours. A token may never reach graduation." },
  { h: 'Smart contract risk', p: 'Polydash and Polypad contracts: Security-scanned with Bevor. Not a formal audit. Their source code is published and verified on Sourcify, and automated security reviews were run, but bugs, exploits or unexpected chain behaviour can still lead to loss of funds. Third-party contracts you interact with carry their own risks.' },
  { h: 'Staking pools', p: <>Anyone can create a staking pool. <a href="/stake" className="text-[#00E676] hover:underline">Current APR (variable)</a> depends on the reward rate, the amount staked and token prices. Rewards can end early or be worth less than expected. Check the token and pool address before staking.</> },
  { h: 'Scans are not audits', p: 'Health scores, X-ray scans, Build activity, holder data and agent replies are generated automatically from public data. They can be delayed, incomplete or wrong. A good result does not mean a token is free of risk.' },
  { h: 'AI agents', p: 'PolyCTO, Poly Agent and PolyForge can make mistakes. Their replies are information, not advice. Verify anything important yourself.' },
  { h: 'Your keys, your responsibility', p: 'Polypad is non-custodial. You alone control your wallet. Blockchain transactions are final. If you sign a malicious transaction, send funds to the wrong address or lose your keys, nobody can recover them, including Polydash.' },
  { h: 'Network and service risk', p: 'Robinhood Chain, RPC providers, explorers or other services may be slow or unavailable, which can delay or block transactions.' },
  { h: 'Regulatory risk', p: 'Rules on digital assets differ by country and can change. You are responsible for following the laws that apply to you.' },
  { h: 'No guarantees', p: 'Polypad is provided as is. Nothing on the site is a promise of returns, liquidity or future value. Not financial advice.' },
];

export default function RiskPage() {
  return (
    <LegalPage
      title="Risk Disclosure"
      updated="Oct 31, 2026"
      intro={
        <>
          Using Polypad involves significant risk. Read this page before you launch, trade, commit or stake. Not financial advice.
          <span className="mt-4 block">
            <GlossaryBox />
          </span>
        </>
      }
      sections={sections}
    />
  );
}
