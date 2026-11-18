'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { proxiedImage } from '@/lib/sanitize';

const COLORS = [
  ['#00E676', '#000000'],
  ['#1F1F1F', '#00E676'],
  ['#FF6363', '#FFFFFF'],
  ['#60B5FF', '#0A0E1A'],
  ['#FF9149', '#0A0E1A'],
  ['#80D8C3', '#0A0E1A'],
  ['#FF90BB', '#0A0E1A'],
  ['#A19AD3', '#0A0E1A'],
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < (s?.length ?? 0); i++) {
    h = ((h << 5) - h + (s?.charCodeAt(i) ?? 0)) | 0;
  }
  return Math.abs(h);
}

export function TokenAvatar({
  name,
  symbol,
  imageUri,
  size = 'md',
  className,
}: {
  name?: string | null;
  symbol?: string | null;
  imageUri?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const sizeClass = size === 'sm' ? 'h-8 w-8 text-xs' : size === 'lg' ? 'h-14 w-14 text-lg' : 'h-10 w-10 text-sm';
  const initials = (symbol ?? name ?? '??')?.slice(0, 2)?.toUpperCase() ?? '??';
  const colorIdx = hashStr(symbol ?? name ?? '') % COLORS.length;
  const [bg, fg] = COLORS[colorIdx] ?? ['#00E676', '#000000'];
  const [failed, setFailed] = useState<string | null>(null);
  const src = proxiedImage(imageUri);

  if (src && failed !== src) {
    return (
      <div className={cn('relative rounded-full overflow-hidden flex-shrink-0', sizeClass, className)}>
        <img src={src} alt={name ?? 'Token'} className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(src)} />
      </div>
    );
  }

  return (
    <div
      className={cn('rounded-full flex items-center justify-center font-bold flex-shrink-0', sizeClass, className)}
      style={{ backgroundColor: bg, color: fg }}
    >
      {initials}
    </div>
  );
}
