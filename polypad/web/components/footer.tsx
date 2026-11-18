import Image from 'next/image';
import Link from 'next/link';

type FooterLink = { label: string; href: string; external?: boolean };

const columns: { title: string; links: FooterLink[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'Explore', href: '/' },
      { label: 'Create', href: '/create' },
      { label: 'Funds', href: '/funds' },
      { label: 'Stake', href: '/stake' },
      { label: 'NFTs', href: '/nfts' },
    ],
  },
  {
    title: 'More',
    links: [
      { label: 'Docs', href: '/docs' },
      { label: 'Portfolio', href: '/portfolio' },
      { label: 'Leaderboard', href: '/leaderboard' },
      { label: 'Buybacks', href: '/buybacks' },
      { label: 'POLYDASH Rewards Pool', href: '/rewards-pool' },
      { label: 'Airdrop slice', href: '/slice' },
      { label: 'About', href: '/about' },
      { label: 'How it works', href: '/about#how-it-works' },
      { label: 'FAQ', href: '/about#faq' },
      { label: 'Contracts', href: '/contracts' },
      { label: 'Agents', href: '/agents' },
      { label: 'Brand kit', href: '/brand' },
      { label: 'Contact', href: '/contact' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Terms', href: '/terms' },
      { label: 'Privacy', href: '/privacy' },
      { label: 'Risk disclosure', href: '/risk' },
    ],
  },
];

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-white/10 bg-[#0A0A0A] text-white">
      <div className="mx-auto max-w-container px-5 py-12 sm:px-8 sm:py-16">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
          <div className="col-span-2 sm:col-span-3 lg:col-span-1">
            <Link href="/" className="inline-flex items-center gap-2">
              <Image src="/polydash-mark-white.png" alt="Polypad logo" width={26} height={26} className="h-[26px] w-[26px]" />
              <span className="text-lg font-semibold tracking-tight">Polypad</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/65">
              Launch, trade and stake tokens, and create tokenized funds, on Robinhood Chain. Fair bonding curves, locked liquidity, non-custodial.
            </p>
            <a
              href="https://x.com/Polydash_"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 px-3 text-sm text-white/80 transition-colors hover:border-white/25 hover:text-white"
              aria-label="Polypad on X (@Polydash_)"
            >
              <XIcon className="h-3.5 w-3.5" />
              @Polydash_
            </a>
          </div>
          {columns.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-white/55">{col.title}</h2>
              <ul className="space-y-1">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="inline-flex min-h-9 items-center text-sm text-white/70 transition-colors hover:text-white">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-12 flex flex-col gap-2 border-t border-white/10 pt-6 text-xs text-white/55 sm:flex-row sm:items-center sm:justify-between sm:text-[13px]">
          <p>© 2026 Polypad</p>
          <p>Not financial advice. Scans are not audits.</p>
        </div>
      </div>
    </footer>
  );
}
