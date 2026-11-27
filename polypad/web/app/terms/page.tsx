import type { Metadata } from 'next';
import GlossaryBox from '@/components/glossary-box';
import { LegalPage } from '@/components/legal-page';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Terms | Polypad',
  description: 'Terms of use for the Polypad interface on Robinhood Chain.',
  path: '/terms',
});

const sections = [
  { h: 'The interface', p: 'Polypad is a website that helps you interact with public smart contracts on Robinhood Chain. Polypad does not hold your funds, cannot reverse transactions and cannot access your wallet. Every action is a transaction you review and sign in your own wallet.' },
  { h: 'User-created tokens and pools', p: 'Tokens, NFT collections and staking pools listed on Polypad are created by users, not by Polypad. A listing is not an endorsement. Always check the contract address before you trade or stake.' },
  { h: 'No advice', p: <>Nothing on this site is financial, investment, legal or tax advice. <a href="/risk" className="text-[#00E676] hover:underline">Health scores, X-ray scans</a> and other signals are automated and can be wrong or incomplete. They are not audits.</> },
  { h: 'Your responsibility', p: 'You are responsible for your wallet, your keys and the transactions you sign, and for complying with the laws that apply to you. Do not use Polypad where it is not permitted.' },
  { h: 'No warranty', p: 'The interface and the contracts are provided as is, without warranties of any kind. To the extent permitted by law, Polypad is not liable for losses arising from your use of the interface or the contracts.' },
  { h: 'Changes', p: 'These terms may be updated from time to time. Continued use of the site after an update means you accept the updated terms.' },
];

export default function TermsPage() {
  return <LegalPage title="Terms of use" updated="October 29, 2026" intro={<GlossaryBox />} sections={sections} />;
}
