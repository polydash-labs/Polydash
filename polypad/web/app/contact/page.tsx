import type { Metadata } from 'next';
import Link from 'next/link';
import { TrustShell, TrustSection, TrustCard, ExtLink, EmailLink } from '@/components/trust/trust-shell';
import { CONTACT_EMAIL, trustMetadata } from '@/lib/trust';

export const metadata: Metadata = trustMetadata({
  title: 'Contact | Polypad',
  description: 'Official contact channels for Polydash and Polypad: email, X, Telegram and GitHub, plus how to send a security report.',
  path: '/contact',
});

const channels = [
  { label: 'X', text: '@Polydash_', href: 'https://x.com/Polydash_' },
  { label: 'Telegram', text: 't.me/polydashofficial', href: 'https://t.me/polydashofficial' },
  { label: 'GitHub', text: 'PolydashDev/Polydash', href: 'https://github.com/PolydashDev/Polydash' },
];

export default function ContactPage() {
  return (
    <TrustShell title="Contact">
      <TrustCard>
        <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-white/80">General and press</p>
          <p className="text-sm"><EmailLink email={CONTACT_EMAIL} /></p>
        </div>
        {channels.map((c) => (
          <div key={c.label} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-white/80">{c.label}</p>
            <p className="text-sm"><ExtLink href={c.href}>{c.text}</ExtLink></p>
          </div>
        ))}
      </TrustCard>

      <TrustSection title="Security reports">
        <p>
          Email <EmailLink email={CONTACT_EMAIL} subject="Security report" /> with the subject &quot;Security report&quot;. Please do not share
          details publicly until we have responded. See <Link href="/contracts" className="text-[#00E676] hover:underline">Contracts</Link> for details.
        </p>
      </TrustSection>

      <TrustSection title="Stay safe">
        <p>
          Polydash team members will never DM you first, ask for your seed phrase or ask you to send funds. Official links are only the ones listed
          on this page.
        </p>
      </TrustSection>
    </TrustShell>
  );
}
