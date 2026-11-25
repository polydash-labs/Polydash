'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { cn } from '@/lib/utils';

type Item = { href: string; label: string; exact?: boolean };
type Section = { heading: string; items: Item[] };

/** Inline close icon (lucide-react has no type declarations in this repo, so
 *  importing it here would add a new tsc error — the X is drawn by hand). */
function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

/**
 * Clean side menu for the header's "More" section. Slides in from the LEFT
 * (opened by the tab next to the Polypad logo) as a spacious panel — the
 * header is already crowded, so the extra pages live here where they have
 * room to breathe. Only the "More" pages go in this panel; the main pages
 * stay in the header nav.
 */
export function HeaderMoreDrawer({
  open,
  onClose,
  sections,
}: {
  open: boolean;
  onClose: () => void;
  sections: Section[];
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop — click to close. */}
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-[60] bg-black/60 transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      />
      {/* Panel — slides in from the left. */}
      <aside
        role="dialog"
        aria-label="More"
        aria-hidden={!open}
        className={cn(
          'fixed left-0 top-0 z-[70] flex h-full w-[340px] max-w-[85vw] flex-col border-r border-white/10 bg-[#0A0A0A] shadow-2xl shadow-black/60 transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <p className="text-[16px] font-bold tracking-tight text-white">More</p>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10"
          >
            <CloseIcon />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-5 py-4">
          {sections.map((section, si) => (
            <div
              key={section.heading}
              className={cn(si > 0 && 'mt-5 border-t border-white/10 pt-5')}
            >
              <p className="pb-1 text-[11px] font-medium uppercase tracking-wide text-white/40">
                {section.heading}
              </p>
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className="block rounded-lg px-3 py-2.5 text-[14px] font-medium text-white/70 transition-colors hover:bg-white/5 hover:text-white"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 px-5 py-4">
          <Link
            href="/about"
            onClick={onClose}
            className="block rounded-lg bg-polydash-green/10 px-3 py-2.5 text-[14px] font-medium text-polydash-green transition-colors hover:bg-polydash-green/20"
          >
            New to crypto? Start here
          </Link>
        </div>
      </aside>
    </>
  );
}
