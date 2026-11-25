'use client';

import { ExternalLink, Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { P3_NOTE, sourcifyUrl } from '@/lib/fund/phase3';
import { cn } from '@/lib/utils';

/** Tap or hover the (i) to read a plain explanation. Works on phones. */
export function Tip({ text, label = 'More info' }: { text: string; label?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} className="inline-flex h-4 w-4 items-center justify-center rounded-full text-white/40 hover:text-white">
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 border-white/15 bg-black p-3 text-[12px] leading-relaxed text-white/80">{text}</PopoverContent>
    </Popover>
  );
}

export function P3Label({ label, tip }: { label: string; tip: string }) {
  return (
    <span className="mb-1 flex items-center gap-1.5 text-xs text-white/55">
      {label}
      <Tip text={tip} label={`About: ${label}`} />
    </span>
  );
}

/** The contract's source code is verified on Sourcify — the link opens the verified source, not just the address. */
export function ContractLink({ label, address }: { label: string; address: string }) {
  return (
    <a
      href={sourcifyUrl(address)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-1 text-[11px] text-white/70 hover:bg-white/5 hover:text-white"
    >
      Verified source code (Sourcify): {label} <ExternalLink className="h-3 w-3" />
    </a>
  );
}

/** Plain-language chain note for the mint card, with a manual add-chain fallback. */
export function ChainSwitchNote({ className }: { className?: string }) {
  return (
    <div className={cn('space-y-1 text-[13px] leading-relaxed text-white/60', className)}>
      <p>Polypad runs on Robinhood Chain. Your wallet will ask you to switch to it — that&rsquo;s free and takes one tap.</p>
      <details>
        <summary className="cursor-pointer text-[13px] font-medium text-white/80">Add Robinhood Chain manually</summary>
        <p className="mt-1">
          If your wallet cannot switch by itself, add the chain by hand in your wallet&rsquo;s network settings — chain ID{' '}
          <span className="font-mono text-white/85">4663</span>, RPC{' '}
          <span className="break-all font-mono text-white/85">https://rpc.mainnet.chain.robinhood.com</span> — then come back and connect.
        </p>
      </details>
    </div>
  );
}

export function P3Note({ className }: { className?: string }) {
  return (
    <p className={cn('text-[13px] leading-relaxed text-white/60', className)}>
      <span className="text-white/75">{P3_NOTE}</span> You could lose some or all of the ETH you put in. Only put in what you can afford to lose.
    </p>
  );
}

export function P3Badge() {
  return <span className="rounded-full border border-white/25 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/80">Phase 3</span>;
}
