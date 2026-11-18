'use client';

import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

type Item = { href: string; label: string };

/** "More" menu holding the secondary nav links on desktop. */
export function HeaderMore({ items, isActive, pathname, label = 'More', align = 'right' }: { items: Item[]; isActive: (href: string) => boolean; pathname: string | null; label?: string; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const anyActive = items.some((i) => isActive(i.href));

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
          'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors',
          anyActive || open ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'
        )}
      >
        {label} <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div role="menu" className={cn('absolute top-full mt-2 w-56 rounded-xl border border-white/10 bg-[#0A0A0A] p-1.5 shadow-2xl shadow-black/60', align === 'left' ? 'left-0' : 'right-0')}>
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className={cn(
                'block whitespace-nowrap rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
                isActive(item.href) ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'
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
