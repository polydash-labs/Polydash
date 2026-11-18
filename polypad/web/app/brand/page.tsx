import type { Metadata } from 'next';
import Image from 'next/image';
import { Download } from 'lucide-react';
import { TrustShell, TrustSection, TrustCard, ExtLink, EmailLink } from '@/components/trust/trust-shell';
import { AddressRow, CopyButton } from '@/components/trust/copy-address';
import { CONTACT_EMAIL, POLYDASH_TOKEN, trustMetadata } from '@/lib/trust';

export const metadata: Metadata = trustMetadata({
  title: 'Brand kit | Polypad',
  description: 'Polydash and Polypad logos, colors, typography, boilerplate and usage guidelines for press, trackers and builders.',
  path: '/brand',
});

const logos: { label: string; file: string; preview?: string; bg: string }[] = [
  { label: 'Polydash mark, white, PNG 512 px (for dark backgrounds)', file: '/brand/polydash-mark-white.png', preview: '/brand/polydash-mark-white.png', bg: 'bg-[#0A0A0A]' },
  { label: 'Polydash mark, dark, PNG 512 px (for light backgrounds)', file: '/brand/polydash-mark-dark.png', preview: '/brand/polydash-mark-dark.png', bg: 'bg-white' },
  { label: 'Polydash mark, green, PNG 512 px', file: '/brand/polydash-mark-green.png', preview: '/brand/polydash-mark-green.png', bg: 'bg-[#0A0A0A]' },
  { label: 'Polydash logo, PNG 256 px', file: '/brand/polydash_logo_256.png', preview: '/brand/polydash_logo_256.png', bg: 'bg-[#1A1A1A]' },
  { label: 'Banner, PNG 1360 x 430', file: '/brand/polydash_banner_1360x430.png', preview: '/brand/polydash_banner_1360x430.png', bg: 'bg-[#1A1A1A]' },
  { label: 'Full kit, ZIP', file: '/brand/polypad-brand-kit.zip', bg: 'bg-[#1A1A1A]' },
];

const colors = [
  { name: 'Polypad Green (primary/accent)', hex: '#00E676' },
  { name: 'Background', hex: '#0A0A0A' },
  { name: 'Card', hex: '#121212' },
  { name: 'Muted surface', hex: '#1A1A1A' },
  { name: 'Border', hex: '#262626' },
  { name: 'Muted text', hex: '#8C8C8C' },
  { name: 'Text', hex: '#FFFFFF' },
];

const links = [
  { label: 'Website', href: 'https://polypad.family' },
  { label: 'Company', href: 'https://dasheco.xyz' },
  { label: 'X', href: 'https://x.com/Polydash_' },
  { label: 'Telegram', href: 'https://t.me/polydashofficial' },
  { label: 'GitHub', href: 'https://github.com/PolydashDev/Polydash' },
];

const donts = [
  'Imply a partnership, endorsement or investment that does not exist.',
  'Stretch, recolor, rotate, crop or add effects to the logo.',
  'Use the logo for your own token, product or account name.',
  'Make price, return or performance claims on our behalf.',
  'Use old or unofficial names for the project.',
];

export default function BrandPage() {
  return (
    <TrustShell title="Brand kit" intro="Assets and guidelines for press, trackers and builders writing about Polydash and Polypad.">
      <TrustSection title="Names">
        <ul className="space-y-1.5">
          <li><span className="text-white/85">Polydash</span>: the company.</li>
          <li><span className="text-white/85">Polypad</span>: the launchpad at polypad.family.</li>
          <li>
            <span className="text-white/85">$POLYDASH</span>: the token ticker only. Write &quot;Polydash&quot;, not &quot;POLYDASH&quot; or
            &quot;polydash&quot;, when you mean the company.
          </li>
        </ul>
      </TrustSection>

      <TrustSection title="Boilerplate">
        <div className="space-y-3">
          <p><span className="text-white/85">Short:</span> Polypad is a non-custodial token launchpad on Robinhood Chain, built by Polydash.</p>
          <p>
            <span className="text-white/85">Long:</span> Polypad lets anyone launch a token on a bonding curve, trade it, and move it to a Uniswap V4
            pool with locked liquidity once it graduates. It also supports NFT collections, staking pools and AI agents that help review tokens.
            Polypad is built by Polydash.
          </p>
        </div>
      </TrustSection>

      <TrustSection title="Logos">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
          {logos.map((l) => (
            <div key={l.file} className="overflow-hidden rounded-2xl bg-[#121212] ring-1 ring-white/[0.06]">
              <div className={`relative flex aspect-[16/7] items-center justify-center ${l.bg}`}>
                {l.preview ? (
                  <Image src={l.preview} alt={l.label} fill sizes="(max-width: 640px) 100vw, 360px" className="object-contain p-6" />
                ) : (
                  <Download className="h-8 w-8 text-white/55" strokeWidth={1.5} aria-hidden="true" />
                )}
              </div>
              <div className="flex items-center justify-between gap-3 p-3">
                <p className="text-[13px] leading-snug text-white/75">{l.label}</p>
                <a
                  href={l.file}
                  download
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[#00E676]/40 px-3 text-xs font-medium text-[#00E676] transition-colors hover:border-[#00E676] hover:bg-[#00E676]/10"
                >
                  <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Download
                </a>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4">Please leave clear space around the mark equal to at least a quarter of its width.</p>
      </TrustSection>

      <TrustSection title="Colors">
        <TrustCard>
          {colors.map((c) => (
            <div key={c.name} className="flex items-center justify-between gap-3 py-3">
              <div className="flex items-center gap-3">
                <span className="h-6 w-6 shrink-0 rounded-md ring-1 ring-white/15" style={{ backgroundColor: c.hex }} aria-hidden="true" />
                <p className="text-sm text-white/80">{c.name}</p>
              </div>
              <div className="flex items-center gap-2">
                <code className="font-mono text-[13px] text-white/75">{c.hex}</code>
                <CopyButton value={c.hex} label={`Copy ${c.name} color`} />
              </div>
            </div>
          ))}
        </TrustCard>
      </TrustSection>

      <TrustSection title="Typography">
        <p>
          <span className="text-white/85">Inter</span> for headings and body. <span className="font-mono text-white/85">JetBrains Mono</span> for
          addresses, numbers and code.
        </p>
      </TrustSection>

      <TrustSection title="Token">
        <TrustCard>
          <AddressRow name="$POLYDASH on Robinhood Chain (chain ID 4663)" address={POLYDASH_TOKEN} />
        </TrustCard>
      </TrustSection>

      <TrustSection title="Official links">
        <TrustCard>
          {links.map((l) => (
            <div key={l.label} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-white/80">{l.label}</p>
              <p className="text-sm"><ExtLink href={l.href}>{l.href}</ExtLink></p>
            </div>
          ))}
          <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-white/80">Email</p>
            <p className="text-sm"><EmailLink email={CONTACT_EMAIL} /></p>
          </div>
        </TrustCard>
      </TrustSection>

      <TrustSection title="Please don't">
        <ul className="list-disc space-y-1.5 pl-5 marker:text-white/40">
          {donts.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      </TrustSection>
    </TrustShell>
  );
}
