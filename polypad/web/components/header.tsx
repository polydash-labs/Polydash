'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { HeaderMore } from './header-more';

// 5 primary links inline; everything with `more` sits in the "More" menu (desktop) / "More" group (mobile).
const navItems = [
  { href: '/', label: 'Explore' },
  { href: '/create', label: 'Create' },
  { href: '/funds', label: 'Create Fund' },
  { href: '/terminal', label: 'Terminal' },
  { href: '/stake', label: 'Stake' },
  { href: '/nfts', label: 'NFTs' },
  { href: '/portfolio', label: 'Portfolio', more: true },
  { href: '/leaderboard', label: 'Leaderboard', more: true },
  { href: '/buybacks', label: 'Buybacks', more: true },
  { href: '/rewards-pool', label: 'Rewards Pool', more: true },
  { href: '/slice', label: 'Airdrop slice', more: true },
  { href: '/about', label: 'About', more: true },
  { href: '/docs', label: 'Docs', more: true },
  { href: '/contracts', label: 'Contracts', more: true },
  { href: '/agents', label: 'Agents', more: true },
  { href: '/agents/accounts', label: 'Agent Accounts', more: true },
  { href: '/build', label: 'Build', more: true },
  { href: '/agents/scores', label: 'Agent Credit Scores', more: true },
  { href: '/x402', label: 'Pay-per-call', more: true },
];
const primaryItems = navItems.filter((i) => !i.more);
const moreItems = navItems.filter((i) => i.more);
// "Create" opens a small menu so a tokenized fund can be created from the main navigation.
const createItems = [
  { href: '/create', label: 'Create a token' },
  { href: '/funds/create', label: 'Create your tokenized fund' },
];
const mobileItems = [...primaryItems.flatMap((i) => (i.href === '/create' ? createItems : [i])), ...moreItems];
const mobilePrimaryCount = primaryItems.length + createItems.length - 1;

export function Header() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isActive = (href: string) => pathname === href || (href !== '/' && !!pathname?.startsWith(href));

  // Close on navigation; lock page scroll and support Escape while the menu is open.
  useEffect(() => { setMobileOpen(false); }, [pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    // Lock the root scroller (not <body>) so the sticky header keeps working.
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileOpen(false); };
    const onResize = () => { if (window.innerWidth >= 1024) setMobileOpen(false); };
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
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <Image src="/polydash-mark-white.png" alt="Polypad logo" width={26} height={26} className="h-[26px] w-[26px]" priority />
            <span className="text-[18px] font-bold tracking-tight text-white">Polypad</span>
          </Link>
          <nav className="hidden items-center gap-1 lg:flex">
            {primaryItems.map((item) => item.href === '/create' ? (
              <HeaderMore key="create" label="Create" align="left" items={createItems} isActive={(h) => pathname === h} pathname={pathname} />
            ) : (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors',
                  isActive(item.href) ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'
                )}
              >
                {item.label}
              </Link>
            ))}
            <HeaderMore items={moreItems} isActive={isActive} pathname={pathname} />
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <WalletButton />
          <button
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(!mobileOpen)}
            className="-mr-1.5 flex h-8 w-8 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10 lg:hidden"
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
          className="fixed inset-x-0 bottom-0 top-14 z-40 bg-black/70 lg:hidden"
        />
      )}
      {mobileOpen && (
        <nav className="fixed inset-x-0 top-14 z-50 max-h-[calc(100dvh-3.5rem)] space-y-0.5 overflow-y-auto border-b border-white/10 bg-[#0A0A0A] px-4 py-3 shadow-2xl shadow-black/60 lg:hidden">
          {mobileItems.map((item, i) => (
            <div key={item.href}>
            {i === mobilePrimaryCount && <p className="mt-2 border-t border-white/10 px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-white/40">More</p>}
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                'block rounded-lg px-3 py-2 text-[14px] font-medium transition-colors',
                isActive(item.href) ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'
              )}
            >
              {item.label}
            </Link>
            </div>
          ))}
        </nav>
      )}
    </>
  );
}

const pill = 'inline-flex h-8 shrink-0 items-center whitespace-nowrap gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors sm:px-3.5 sm:text-[13px]';

function WalletButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openConnectModal, openAccountModal, openChainModal }) => {
        if (!mounted) return <div className="h-8 w-[76px]" aria-hidden />;
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
            <button onClick={openChainModal} className={cn(pill, 'border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20')}>
              Wrong network
            </button>
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
