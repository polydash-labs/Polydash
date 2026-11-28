// Shared design primitives extracted from the Partnerships page
// (app/build/partnerships/_components/partnerships-content.tsx).
// Every primary page redesign imports from here so the whole site shares
// one visual system. Do NOT edit the Partnerships page itself to use this
// file — it keeps its own local copies; this file only mirrors them.
import type { ReactNode } from 'react';
import { ArrowDown } from 'lucide-react';

export const SECTION = 'mx-auto max-w-6xl px-4 sm:px-6 py-14 sm:py-20';
export const KICKER = 'text-[12px] font-semibold uppercase tracking-[0.18em] text-emerald-400';
export const H2 = 'mt-3 text-3xl sm:text-4xl font-bold tracking-tight text-white';
export const SUB = 'mt-3 max-w-2xl text-[15px] leading-relaxed text-white/60';
export const HERO_GLOW =
  'pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(16,185,129,0.28),transparent_55%),radial-gradient(ellipse_at_bottom_left,rgba(0,230,118,0.12),transparent_50%)]';
export const EMERALD_CARD =
  'rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/15 via-emerald-500/[0.05] to-transparent p-5';
export const EMERALD_CARD_STRONG =
  'rounded-2xl border border-emerald-500/30 bg-gradient-to-b from-emerald-500/20 to-emerald-500/[0.04] p-5';
export const PLAIN_CARD =
  'rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-transparent p-5';
export const DARK_CARD = 'rounded-2xl border border-white/10 bg-black/50 p-5';
export const CTA_PRIMARY =
  'inline-flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-[15px] font-semibold text-black hover:bg-emerald-400';
export const CTA_OUTLINE =
  'inline-flex items-center gap-2 rounded-full border border-emerald-500/50 bg-emerald-500/10 px-6 py-3 text-[15px] font-semibold text-emerald-300 hover:bg-emerald-500/20';
export const STAT_TILE =
  'rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/15 to-transparent p-4';
export const EMERALD_PILL =
  'rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300';

export function SectionHead({
  kicker,
  title,
  sub,
}: {
  kicker: string;
  title: string;
  sub?: string;
}) {
  return (
    <>
      <p className={KICKER}>{kicker}</p>
      <h2 className={H2}>{title}</h2>
      {sub ? <p className={SUB}>{sub}</p> : null}
    </>
  );
}

export function StatTiles({
  items,
}: {
  items: { value: string; label: string; note?: string }[];
}) {
  return (
    <div className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((n) => (
        <div key={n.label} className={STAT_TILE}>
          <p className="text-2xl sm:text-3xl font-bold text-emerald-300">{n.value}</p>
          <p className="mt-1 text-[13px] font-medium text-white">{n.label}</p>
          {n.note ? <p className="mt-0.5 text-[12px] leading-snug text-white/50">{n.note}</p> : null}
        </div>
      ))}
    </div>
  );
}

export type FlowLayer = {
  title: string;
  body?: string;
  pills?: string[];
  icon?: ReactNode;
  emerald?: boolean;
};

/** Vertical stacked-layers flow diagram, like the Partnerships architecture diagram:
 *  layer → ArrowDown → layer → ArrowDown → layer. */
export function FlowDiagram({ layers }: { layers: FlowLayer[] }) {
  return (
    <div className="mx-auto mt-10 max-w-2xl">
      {layers.map((layer, i) => (
        <div key={layer.title}>
          {i > 0 && <ArrowDown className="mx-auto my-2 h-5 w-5 text-emerald-400" />}
          <div
            className={
              layer.emerald
                ? 'rounded-2xl border border-emerald-500/30 bg-gradient-to-b from-emerald-500/20 to-transparent p-5 text-center'
                : 'rounded-2xl border border-white/15 bg-white/[0.04] p-5 text-center'
            }
          >
            {layer.icon}
            <p className="mt-2 text-[16px] font-semibold">{layer.title}</p>
            {layer.body ? <p className="mt-1 text-[13px] text-white/55">{layer.body}</p> : null}
            {layer.pills ? (
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {layer.pills.map((p) => (
                  <span
                    key={p}
                    className="rounded-full border border-emerald-500/30 bg-black/40 px-3 py-1 text-[12px] font-medium text-emerald-200"
                  >
                    {p}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function StepTimeline({ steps }: { steps: { title: string; body: string }[] }) {
  return (
    <div className="mt-10 grid gap-4 md:grid-cols-5">
      {steps.map((s, i) => (
        <div key={s.title} className="relative rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-[15px] font-bold text-black">
            {i + 1}
          </span>
          <h3 className="mt-3 text-[16px] font-semibold">{s.title}</h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">{s.body}</p>
        </div>
      ))}
    </div>
  );
}
