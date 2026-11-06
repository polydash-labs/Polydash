'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/', label: 'Explore' },
  { href: '/create', label: 'Create' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/about', label: 'About' },
  { href: '/docs', label: 'Docs' },
];

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
    const onResize = () => { if (window.innerWidth >= 768) setMobileOpen(false); };
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
      <div className="mx-auto flex h-full max-w-container items-center justify-between px-5 sm:px-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <Image src="/polydash-mark-white.png" alt="Polypad logo" width={26} height={26} className="h-[26px] w-[26px]" priority />
            <span className="text-[18px] font-bold tracking-tight text-white">Polypad</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors',
                  isActive(item.href) ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <WalletButton />
          <button
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(!mobileOpen)}
            className="-mr-1.5 flex h-8 w-8 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10 md:hidden"
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
          className="fixed inset-x-0 bottom-0 top-14 z-40 bg-black/70 md:hidden"
        />
      )}
      {mobileOpen && (
        <nav className="fixed inset-x-0 top-14 z-50 space-y-0.5 border-b border-white/10 bg-[#0A0A0A] px-4 py-3 shadow-2xl shadow-black/60 md:hidden">
          {navItems.map((item) => (
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
          ))}
        </nav>
      )}
    </>
  );
}

const pill = 'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors sm:px-3.5 sm:text-[13px]';

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
