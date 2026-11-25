'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error('copy failed', e);
    }
  };
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black/40">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-1.5">
        <span className="text-[11px] uppercase tracking-wider text-white/55">{label ?? 'Code'}</span>
        <button type="button" onClick={copy} aria-label="Copy code" className="inline-flex h-10 items-center gap-1 rounded-md px-2 text-[12px] text-white/60 transition-colors hover:text-white sm:h-7">
          {copied ? <Check className="h-3.5 w-3.5 text-polydash-green" strokeWidth={1.75} /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[12px] leading-relaxed text-white/80 sm:p-4"><code>{code}</code></pre>
    </div>
  );
}
