'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/** Tab state synced with ?tab= in the URL (linkable; updated via history.replaceState). */
export function useUrlTab<T extends string>(keys: readonly T[], fallback: T, initial?: string | null) {
  const [tab, setTabState] = useState<T>(initial && keys.includes(initial as T) ? (initial as T) : fallback);
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get('tab') as T | null;
    if (v && keys.includes(v)) setTabState(v);
  }, [keys]);
  const setTab = (t: T) => {
    setTabState(t);
    try {
      const url = new URL(window.location.href);
      if (t === fallback) url.searchParams.delete('tab'); else url.searchParams.set('tab', t);
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    } catch (e) { console.error('tab url update failed', e); }
  };
  return [tab, setTab] as const;
}

export function TabBar<T extends string>({ tabs, value, onChange, label, className }: {
  tabs: readonly { k: T; label: string }[]; value: T; onChange: (t: T) => void; label: string; className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn('inline-flex gap-1 rounded-full bg-white/[0.05] p-1', className)}>
      {tabs.map((t) => (
        <button key={t.k} type="button" role="tab" aria-selected={value === t.k} onClick={() => onChange(t.k)}
          className={cn('h-9 rounded-full px-5 text-[13px] font-medium transition', value === t.k ? 'bg-white text-black' : 'text-white/70 hover:text-white')}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
