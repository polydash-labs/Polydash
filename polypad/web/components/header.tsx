'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Menu, PanelLeft, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { HeaderMore } from './header-more';
import { HeaderMoreDrawer } from './header-more-drawer';
import { EmailSignInButton } from '@/components/privy/privy-auth';

// Desktop: 5 plain links inline + Funds, Agents, Agent payments and More dropdowns.
// Every link that used to sit in the flat "More" list still has a nav entry,
// now grouped: fund pages under Funds, agent pages under Agents.
type NavLink = { href: string; label: string; exact?: boolean };
type NavSection = { heading: string; items: NavLink[] };

const primaryLinks: NavLink[] = [
  { href: '/', label: 'Explore' },
  { href: '/create', label: 'Create a token' },
  { href: '/terminal', label: 'Terminal' },
  { href: '/stake', label: 'Stake' },
  { href: '/nfts', label: 'NFTs' },
];

const fundsItems: NavLink[] = [
  { href: '/funds', label: 'Browse funds', exact: true },
  { href: '/funds/create', label: 'Create a fund' },
];

const agentsSections: NavSection[] = [
  {
    heading: 'Your agents',
    items: [
      { href: '/agents', label: 'Agents overview', exact: true },
      { href: '/agents/accounts', label: 'Agent Accounts' },
      { href: '/agents/wallets', label: 'Agent Wallets' },
      { href: '/agents/create', label: 'Create an agent' },
      { href: '/agents/launch', label: 'Launch an agent' },
    ],
  },
  {
    heading: 'Credit score',
    items: [{ href: '/agents/scores', label: 'Credit Scores' }],
  },
];

const marketplaceItems: NavLink[] = [
  { href: '/business', label: 'For business' },
  { href: '/inference', label: 'AI inference' },
  { href: '/agents/security', label: 'Security for agents' },
];

const paymentsItems: NavLink[] = [
  { href: '/x402', label: 'Pay-per-call' },
  { href: '/agents/credits', label: 'Poly credits' },
  { href: '/agents/usage', label: 'Usage' },
  { href: '/agents/receipts', label: 'Receipts' },
];

const moreSections: NavSection[] = [
  {
    heading: 'Build',
    items: [
      { href: '/build', label: 'Build' },
      { href: '/docs', label: 'Docs' },
      { href: '/contracts', label: 'Contracts' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/status', label: 'Status' },
      { href: '/changelog', label: 'Changelog' },
    ],
  },
  {
    heading: 'Your activity',
    items: [
      { href: '/portfolio', label: 'Portfolio' },
      { href: '/leaderboard', label: 'Leaderboard' },
      { href: '/buybacks', label: 'Buybacks' },
      { href: '/rewards-pool', label: 'Rewards Pool' },
      { href: '/slice', label: 'Airdrop slice' },
    ],
  },
  {
    heading: 'About',
    items: [{ href: '/about', label: 'About' }],
  },
];

function MobileNavLink({ item, isActive, onNavigate }: { item: NavLink; isActive: (href: string, exact?: boolean) => boolean; onNavigate: () => void }) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        'block rounded-lg px-3 py-2 text-[14px] font-medium transition-colors',
        isActive(item.href, item.exact) ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'
      )}
    >
      {item.label}
    </Link>
  );
}

function MobileNavGroup({ heading, items, sections, isActive, onNavigate }: { heading: string; items?: NavLink[]; sections?: NavSection[]; isActive: (href: string, exact?: boolean) => boolean; onNavigate: () => void }) {
  return (
    <div className="mt-2 border-t border-white/10 pt-3">
      <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-white/40">{heading}</p>
      {items?.map((item) => (
        <MobileNavLink key={item.href} item={item} isActive={isActive} onNavigate={onNavigate} />
      ))}
      {sections?.map((section) => (
        <div key={section.heading} className="mt-1">
          <p className="px-3 pb-0.5 pt-1 text-[11px] font-medium text-white/40">{section.heading}</p>
          {section.items.map((item) => (
            <MobileNavLink key={item.href} item={item} isActive={isActive} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Header() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : (pathname === href || (href !== '/' && !!pathname?.startsWith(href)));

  // Close on navigation; lock page scroll and support Escape while the menu is open.
  useEffect(() => { setMobileOpen(false); setMoreOpen(false); }, [pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    // Lock the root scroller (not <body>) so the sticky header keeps working.
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileOpen(false); };
    const onResize = () => { if (window.innerWidth >= 1280) setMobileOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      root.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [mobileOpen]);

  return (
    <>
    <header className={cn('sticky top-0 z-50 h-14 w-full border-b border-white/10 backdrop-blur-xl', mobileOpen ? 'bg-[#0A0A0A]' : 'bg-[#0A0A0A]/70')}>
      <div className="mx-auto flex h-full max-w-container items-center justify-between gap-4 px-5 sm:px-6 2xl:max-w-[1600px]">
        <div className="flex min-w-0 items-center gap-6">
          {/* Side tab: opens the "More" panel (left drawer). Only the More
              pages live there; the main pages stay in the header nav (desktop)
              or the hamburger menu (mobile). Visible at every width so the
              tab is always next to the logo. */}
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            aria-label="Open more menu"
            onClick={() => setMoreOpen(true)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10"
          >
            <PanelLeft className="h-[18px] w-[18px]" />
          </button>
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <Image src="/polydash-mark-white.png" alt="Polypad logo" width={26} height={26} className="h-[26px] w-[26px]" priority />
            <span className="text-[18px] font-bold tracking-tight text-white">Polypad</span>
          </Link>
          <nav className="hidden items-center gap-1 xl:flex">
            {primaryLinks.slice(0, 2).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'whitespace-nowrap rounded-full px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                  isActive(item.href, item.exact) ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'
                )}
              >
                {item.label}
              </Link>
            ))}
            <HeaderMore items={fundsItems} isActive={isActive} pathname={pathname} label="Funds" align="left" />
            {primaryLinks.slice(2).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'whitespace-nowrap rounded-full px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                  isActive(item.href, item.exact) ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'
                )}
              >
                {item.label}
              </Link>
            ))}
            <HeaderMore sections={agentsSections} isActive={isActive} pathname={pathname} label="Agents" align="left" />
            <HeaderMore items={marketplaceItems} isActive={isActive} pathname={pathname} label="Marketplace" align="left" />
            <HeaderMore items={paymentsItems} isActive={isActive} pathname={pathname} label="Agent payments" align="left" />
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Link href="/about" className="hidden min-h-11 items-center whitespace-nowrap rounded-full px-2 text-[13px] font-medium text-white/60 transition-colors hover:text-white md:inline-flex">
            New to crypto?
          </Link>
          <EmailSignInButton />
          <WalletButton />
          <button
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(!mobileOpen)}
            className="-mr-1.5 flex h-11 w-11 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10 xl:hidden"
          >
            {mobileOpen ? <X className="h-[18px] w-[18px]" /> : <Menu className="h-[18px] w-[18px]" />}
          </button>
        </div>
      </div>
    </header>

      {/* Rendered outside <header>: its backdrop-filter would otherwise become the containing block for these fixed elements. */}
      {mobileOpen && (
        <button
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-x-0 bottom-0 top-14 z-40 bg-black/70 xl:hidden"
        />
      )}
      {mobileOpen && (
        <nav className="fixed inset-x-0 top-14 z-50 max-h-[calc(100dvh-3.5rem)] space-y-0.5 overflow-y-auto border-b border-white/10 bg-[#0A0A0A] px-4 py-3 shadow-2xl shadow-black/60 xl:hidden">
          <Link
            href="/about"
            onClick={() => setMobileOpen(false)}
            className="block rounded-lg bg-polydash-green/10 px-3 py-2 text-[14px] font-medium text-polydash-green transition-colors hover:bg-polydash-green/20"
          >
            New to crypto? Start here
          </Link>
          {primaryLinks.map((item) => (
            <MobileNavLink key={item.href} item={item} isActive={isActive} onNavigate={() => setMobileOpen(false)} />
          ))}
          <MobileNavGroup heading="Funds" items={fundsItems} isActive={isActive} onNavigate={() => setMobileOpen(false)} />
          <MobileNavGroup heading="Agents" sections={agentsSections} isActive={isActive} onNavigate={() => setMobileOpen(false)} />
          <MobileNavGroup heading="Marketplace" items={marketplaceItems} isActive={isActive} onNavigate={() => setMobileOpen(false)} />
          <MobileNavGroup heading="Agent payments" items={paymentsItems} isActive={isActive} onNavigate={() => setMobileOpen(false)} />
        </nav>
      )}

      {/* Side menu for "More" — clean slide-in panel from the left, opened by
          the tab next to the logo. Only the More pages live here. */}
      <HeaderMoreDrawer open={moreOpen} onClose={() => setMoreOpen(false)} sections={moreSections} />
    </>
  );
}

const pill = 'inline-flex h-11 shrink-0 items-center whitespace-nowrap gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors sm:px-3.5 sm:text-[13px]';

function WalletButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openConnectModal, openAccountModal, openChainModal }) => {
        if (!mounted) return <div className="h-11 w-[76px]" aria-hidden />;
        if (!account || !chain) {
          return (
            <button onClick={openConnectModal} className={cn(pill, 'bg-polydash-green text-black hover:bg-polydash-green-light')}>
              <span className="sm:hidden">Connect</span>
              <span className="hidden sm:inline">Connect wallet</span>
            </button>
          );
        }
        if (chain.unsupported) {
          return (
            <span className="flex items-center gap-2">
              <span className="hidden max-w-[230px] text-[11px] leading-tight text-white/60 xl:block">
                Polypad runs on Robinhood Chain. Your wallet will ask you to switch to it — that&apos;s free and takes one tap.
              </span>
              <button
                onClick={openChainModal}
                title="Polypad runs on Robinhood Chain. Your wallet will ask you to switch to it — that's free and takes one tap."
                className={cn(pill, 'border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20')}
              >
                Wrong network
              </button>
              <details className="relative">
                <summary
                  title="How to add Robinhood Chain manually"
                  className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full text-[13px] font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white [&::-webkit-details-marker]:hidden"
                >
                  ?
                </summary>
                <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-white/10 bg-[#0A0A0A] p-4 text-[12px] leading-relaxed text-white/70 shadow-2xl shadow-black/60">
                  <p className="font-semibold text-white">How to add Robinhood Chain manually</p>
                  <p className="mt-1">In your wallet, add a network with these details, then switch to it:</p>
                  <p className="mt-2 font-mono text-[11px] leading-relaxed text-white/80">
                    Network name: Robinhood Chain<br />
                    Chain ID: 4663<br />
                    RPC URL: https://rpc.mainnet.chain.robinhood.com<br />
                    Currency: ETH<br />
                    Explorer: https://robinhoodchain.blockscout.com
                  </p>
                </div>
              </details>
            </span>
          );
        }
        return (
          <button onClick={openAccountModal} className={cn(pill, 'border border-white/15 bg-white/[0.04] font-mono text-white hover:bg-white/10')}>
            <span className="h-1.5 w-1.5 rounded-full bg-polydash-green" />
            {account.displayName}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
