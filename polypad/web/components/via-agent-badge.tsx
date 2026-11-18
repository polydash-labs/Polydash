'use client';

import { useEffect, useState } from 'react';

type Label = 'via Grok' | 'via agent' | null;

// Batches hashes from every badge on the page into one /api/attribution call.
const known = new Map<string, Label>();
const waiting = new Map<string, ((l: Label) => void)[]>();
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
  timer = null;
  const batch = [...waiting.keys()].slice(0, 50);
  const subs = batch.map((h) => [h, waiting.get(h) ?? []] as const);
  batch.forEach((h) => waiting.delete(h));
  if (waiting.size) timer = setTimeout(flush, 30);
  let results: Record<string, { label?: Label } | null> = {};
  try {
    const res = await fetch(`/api/attribution?hashes=${batch.join(',')}`);
    if (res.ok) results = (await res.json())?.results ?? {};
  } catch (e) {
    console.error('attribution lookup failed', e);
  }
  for (const [h, cbs] of subs) {
    const label = results[h]?.label ?? null;
    if (h in results) known.set(h, label);
    cbs.forEach((cb) => cb(label));
  }
}

function lookup(hash: string, cb: (l: Label) => void) {
  const h = hash.toLowerCase();
  if (known.has(h)) { cb(known.get(h) ?? null); return; }
  waiting.set(h, [...(waiting.get(h) ?? []), cb]);
  if (!timer) timer = setTimeout(flush, 40);
}

/** Small "via Grok" / "via agent" label when the transaction input carries the polypad ERC-8021 code. */
export function ViaAgentBadge({ hash, className = '' }: { hash?: string | null; className?: string }) {
  const [label, setLabel] = useState<Label>(null);
  useEffect(() => {
    if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return;
    let live = true;
    lookup(hash, (l) => { if (live) setLabel(l); });
    return () => { live = false; };
  }, [hash]);
  if (!label) return null;
  return (
    <span className={`ml-1.5 inline-flex items-center rounded-full border border-white/20 px-1.5 py-px text-[10px] font-normal text-white/70 ${className}`}>{label}</span>
  );
}
