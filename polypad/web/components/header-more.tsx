'use client';

import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

type Item = { href: string; label: string; exact?: boolean };
type Section = { heading: string; items: Item[] };

/**
 * Click dropdown for the desktop header. Takes either a flat `items` list
 * (the old "More" menu) or grouped `sections`, each rendered under a small
 * uppercase heading. The button reads active when any link inside is active.
 */
export function HeaderMore({ items, sections, isActive, pathname, label = 'More', align = 'right' }: { items?: Item[]; sections?: Section[]; isActive: (href: string, exact?: boolean) => boolean; pathname: string | null; label?: string; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const allItems: Item[] = sections ? sections.flatMap((s) => s.items) : (items ?? []);
  const anyActive = allItems.some((i) => isActive(i.href, i.exact));

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[13px] font-medium transition-colors',
          anyActive || open ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'
        )}
      >
        {label} <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div role="menu" className={cn('absolute top-full mt-2 w-60 rounded-xl border border-white/10 bg-[#0A0A0A] p-1.5 shadow-2xl shadow-black/60', align === 'left' ? 'left-0' : 'right-0')}>
          {sections ? sections.map((section, si) => (
            <div key={section.heading} className={cn(si > 0 && 'mt-1 border-t border-white/10 pt-1')}>
              <p className="px-3 pb-0.5 pt-2 text-[11px] font-medium uppercase tracking-wide text-white/40">{section.heading}</p>
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className={cn(
                    'block whitespace-nowrap rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
                    isActive(item.href, item.exact) ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          )) : (items ?? []).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className={cn(
                'block whitespace-nowrap rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
                isActive(item.href, item.exact) ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'
              )}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
