'use client';

import { useState } from 'react';
import { ArrowUpRight, Check, Copy } from 'lucide-react';

const EXPLORER = 'https://robinhoodchain.blockscout.com/address/';

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Copy failed', err);
    }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 text-white/70 transition-colors hover:border-white/25 hover:text-white"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-[#00E676]" strokeWidth={1.75} /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />}
    </button>
  );
}

export function AddressRow({ name, address }: { name: string; address: string }) {
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <p className="text-sm text-white/80">{name}</p>
      <div className="flex min-w-0 items-center gap-2">
        <code className="min-w-0 break-all font-mono text-[12px] sm:text-[13px] text-white/75">{address}</code>
        <CopyButton value={address} label={`Copy ${name} address`} />
        <a
          href={`${EXPLORER}${address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-white/10 px-2.5 text-xs text-white/70 transition-colors hover:border-white/25 hover:text-white"
        >
          View on explorer
          <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} />
        </a>
      </div>
    </div>
  );
}
