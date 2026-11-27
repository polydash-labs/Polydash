/** Shared card system for the agent pages (/agents/wallets, /agents/wallets/[address],
 * /agents/scores). Theme: Visacli's real logged-in Home (app.visacli.sh) — huge title,
 * a "Needs you" action card, big stat tiles, one big idea per card, floating proof
 * chips — translated to Polypad's dark theme + green accent. The light background is
 * Visacli's brand, not the pattern; Polypad stays dark.
 *
 * One system, used by all three pages — do not paste these styles per page.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** The card itself: large radius, dark fill, generous padding. */
export function AgentCard({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <section aria-label={label} className={cn('relative rounded-[20px] border border-white/10 bg-[#141414] p-6 sm:p-8', className)}>
      {children}
    </section>
  );
}

export function AgentCardTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-[20px] font-bold tracking-tight sm:text-[22px]">{children}</h2>;
}

export function AgentCardSub({ children }: { children: ReactNode }) {
  return <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-white/60">{children}</p>;
}

/** Floating proof chip (Visacli pattern): a white card that floats over the top
 * edge of its card, with one big green number and one small grey caption. */
export function ProofChip({ big, small }: { big: ReactNode; small: ReactNode }) {
  return (
    <div className="absolute -top-4 right-7 rounded-[14px] bg-white px-4 py-2.5 text-left shadow-[0_10px_30px_rgba(0,0,0,0.55)] max-sm:static max-sm:mb-4 max-sm:inline-block">
      <div className="text-[19px] font-extrabold leading-tight tracking-tight text-[#15803d]">{big}</div>
      <div className="text-[12.5px] leading-snug text-[#6b7280]">{small}</div>
    </div>
  );
}

/** One stat tile: label, big value, small note. */
export function AgentStat({
  label,
  value,
  note,
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="rounded-[14px] border border-white/5 bg-[#1a1a1a] p-4 sm:p-[18px]">
      <div className="text-[13px] text-white/60">{label}</div>
      <div className="mt-1.5 text-[24px] font-bold leading-tight tracking-tight sm:text-[26px]">{value}</div>
      {note ? <div className="mt-1 text-[12.5px] text-white/40">{note}</div> : null}
    </div>
  );
}

/** The page hero: huge title + one plain lede sentence. */
export function PageHero({
  title,
  lede,
  crumb,
}: {
  title: ReactNode;
  lede?: ReactNode;
  crumb?: ReactNode;
}) {
  return (
    <div>
      {crumb ? <p className="text-[14px] font-semibold text-polydash-green">{crumb}</p> : null}
      <h1 className="mt-3 text-[36px] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[52px]">{title}</h1>
      {lede ? <p className="mt-3 max-w-2xl text-[17px] leading-relaxed text-white/60 sm:text-[18px]">{lede}</p> : null}
    </div>
  );
}

/** Numbered step cards (1 / 2 / 3, big green numerals). */
export function StepsRow({ steps }: { steps: { title: string; text: ReactNode }[] }) {
  return (
    <div className="grid gap-5 sm:grid-cols-3">
      {steps.map((s, i) => (
        <div key={s.title} className="rounded-[20px] border border-white/10 bg-[#141414] p-6 sm:p-7">
          <div className="text-[46px] font-extrabold leading-none tracking-tight text-polydash-green">{i + 1}</div>
          <h3 className="mt-3 text-[18px] font-semibold tracking-tight">{s.title}</h3>
          <p className="mt-1.5 text-[14.5px] leading-relaxed text-white/60">{s.text}</p>
        </div>
      ))}
    </div>
  );
}

/** "Needs you" — the real Visacli Home pattern: one prominent card surfacing the
 * single thing that needs the owner's attention, with its action. Render only
 * when there is actually something that needs the owner. */
export function NeedsYou({
  title,
  text,
  children,
}: {
  title: ReactNode;
  text?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section aria-label="Needs you" className="rounded-[20px] border border-polydash-green/30 bg-polydash-green/[0.06] p-6 sm:p-8">
      <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-polydash-green">Needs you</p>
      <h2 className="mt-2 text-[20px] font-bold tracking-tight sm:text-[22px]">{title}</h2>
      {text ? <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-white/60">{text}</p> : null}
      {children ? <div className="mt-4 flex flex-wrap items-center gap-3">{children}</div> : null}
    </section>
  );
}

/** Dashed empty-state card (connect prompts, "nothing here yet"). */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[14px] border border-dashed border-white/20 bg-[#1a1a1a] p-6 text-center text-[15px] leading-relaxed text-white/60 sm:p-7">
      {children}
    </div>
  );
}

/** Two-column split: "For you — the owner" vs "For your agent". */
export function OwnerAgentSplit({
  ownerItems,
  agentItems,
}: {
  ownerItems: { title: string; note: string; ok: boolean }[];
  agentItems: { title: string; note: string; ok: boolean }[];
}) {
  const List = ({ items }: { items: { title: string; note: string; ok: boolean }[] }) => (
    <ul className="mt-4">
      {items.map((it) => (
        <li key={it.title} className="flex gap-2.5 border-t border-white/5 py-2.5 text-[15px] leading-snug text-white/80 first:border-t-0">
          <span className={cn('flex-none font-extrabold', it.ok ? 'text-polydash-green' : 'text-red-400')}>{it.ok ? '✓' : '×'}</span>
          <span>
            {it.title}
            <small className="mt-0.5 block text-[13px] leading-relaxed text-white/50">{it.note}</small>
          </span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <AgentCard label="For you — the owner">
        <AgentCardTitle>For you — the owner</AgentCardTitle>
        <AgentCardSub>You own it. The agent only gets a session key.</AgentCardSub>
        <List items={ownerItems} />
      </AgentCard>
      <AgentCard label="For your agent">
        <AgentCardTitle>For your agent</AgentCardTitle>
        <AgentCardSub>It works inside the limits you set. Nothing more.</AgentCardSub>
        <List items={agentItems} />
      </AgentCard>
    </div>
  );
}
