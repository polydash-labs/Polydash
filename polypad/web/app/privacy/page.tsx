import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';
import { CONTACT_EMAIL, trustMetadata } from '@/lib/trust';

export const metadata: Metadata = trustMetadata({
  title: 'Privacy Policy | Polypad',
  description: 'How Polypad handles wallet addresses, public blockchain data, uploads and agent chats. Polypad never asks for your keys or holds your funds.',
  path: '/privacy',
});

const email = (
  <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#00E676] hover:underline">
    <span suppressHydrationWarning>{CONTACT_EMAIL}</span>
  </a>
);

const sections = [
  { h: 'Public blockchain data', p: 'Wallet addresses, transactions, token launches, trades and staking positions are recorded on Robinhood Chain, a public blockchain. Anyone can see them. Polypad reads this public data to show token pages, portfolios, leaderboards and health scores. We cannot change or delete on-chain data.' },
  { h: 'What we do not collect', p: 'We never ask for or store your private keys or seed phrase. Polypad does not hold your funds. We do not ask for your name, email or ID to use the site.' },
  { h: 'Wallet connection', p: 'When you connect a wallet, your public address is shared with the site so it can show your balances and prepare transactions. You sign every transaction in your own wallet. Wallet connections use WalletConnect and your wallet provider, which have their own privacy policies.' },
  { h: 'Information you choose to submit', p: "If you create a token or collection, the name, ticker, description, links and images you upload are stored and shown publicly. If you link a GitHub repository or extra wallet to a token's Build activity, the link and the signed message that proves it are stored and shown publicly." },
  { h: 'AI agent chat', p: 'Messages you send to PolyCTO, Poly Agent or PolyForge are sent to our AI provider, Swarms AI, to generate a reply. Do not include personal or sensitive information in agent chats. To prevent abuse, we keep your IP address and request counts for rate limiting for a short period.' },
  { h: 'Hosting and logs', p: 'The site is hosted on Abacus AI infrastructure. Uploaded images are stored on Amazon Web Services. Like most websites, our hosting provider may keep standard server logs (such as IP address, browser type and pages requested) for security and reliability.' },
  { h: 'Third-party data sources', p: 'To show chain data we query a Robinhood Chain RPC endpoint, the Blockscout explorer, Sourcify and public GitHub data. These requests are made by our servers or your browser and may expose your IP address to those services.' },
  { h: 'Cookies and analytics', p: 'Polypad uses only the storage needed to run the site, such as remembering your wallet connection and settings in your browser. We do not sell personal information.' },
  { h: 'Retention', p: 'We keep off-chain data only as long as needed to run the site, prevent abuse and meet legal obligations.' },
  { h: 'Your choices', p: <>You can disconnect your wallet at any time. To ask about, or request deletion of, off-chain data we hold about you, email {email}. On-chain data cannot be deleted.</> },
  { h: 'Children', p: 'Polypad is not intended for anyone under 18.' },
  { h: 'Changes', p: 'We may update this policy. The date above shows the latest version.' },
  { h: 'Contact', p: email },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="Oct 31, 2026"
      intro="Polypad (polypad.family) is a non-custodial interface for launching, trading and staking tokens on Robinhood Chain, operated by Polydash. This policy explains what information the site handles and why."
      sections={sections}
    />
  );
}
