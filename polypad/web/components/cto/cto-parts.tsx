'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { xIntent, type PostDraft } from '@/lib/cto/posts';
import { SOCIAL_LABELS, type Faq, type Socials } from '@/lib/cto/profile';
import { ErrorNote, Loading, Panel } from '@/app/agents/_components/ui';

export const CTO_FOOTER = 'Not financial advice. Security scans are not audits.';

export interface CtoProfileView { tone: string; socials: Partial<Socials>; faqs: Faq[]; plan: string; updatedAt?: string }

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Copied');
    return true;
  } catch (e) {
    console.error('clipboard failed', e);
    toast.error('Could not copy. Select the text and copy it manually.');
    return false;
  }
}

function DraftRow({ d, url }: { d: PostDraft; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <li className="rounded-xl bg-white/[0.03] p-3">
      <div className="text-[12px] font-medium text-white/50">{d.title}</div>
      <p className="mt-1 whitespace-pre-wrap break-words text-[13px] text-white/85">{d.x}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <a href={xIntent(d.x, url)} target="_blank" rel="noopener noreferrer"
          className="inline-flex h-8 items-center gap-1 rounded-full bg-polydash-green px-3 text-[12px] font-medium text-black hover:bg-polydash-green-light">
          Post on X <ArrowUpRight className="h-3 w-3" />
        </a>
        <button type="button" onClick={async () => { if (await copyText(d.telegram)) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }}
          className="inline-flex h-8 items-center gap-1 rounded-full border border-white/15 px-3 text-[12px] text-white/80 hover:border-white/30 hover:text-white">
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} Copy for Telegram
        </button>
      </div>
    </li>
  );
}

export function OnlyCreatorNote({ launch }: { launch: string }) {
  return (
    <p className="rounded-xl bg-white/[0.04] px-3.5 py-3 text-[13px] text-white/70">
      Only the token creator can generate posts.{' '}
      <Link href={`/token/${launch.toLowerCase()}/cto/manage`} className="text-polydash-green hover:underline">Open the CTO Manage page</Link> to sign in.
    </p>
  );
}

/** Creator-only drafts: fetched from the session-gated route. 401/403 shows the creator-only note. */
export function PostDrafts({ launch, wallet, title = 'Post drafts' }: { launch: string; wallet?: string; title?: string }) {
  const [state, setState] = useState<{ drafts: PostDraft[]; url: string } | 'denied' | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setState(null); setError('');
    fetch(`/api/cto/${launch.toLowerCase()}/drafts${wallet ? `?address=${wallet}` : ''}`, { cache: 'no-store' })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (r.status === 401 || r.status === 403) return 'denied' as const;
        if (!r.ok) throw new Error(d?.error ?? 'Could not build post drafts.');
        return { drafts: d.drafts as PostDraft[], url: d.url as string };
      })
      .then((s) => { if (live) setState(s); })
      .catch((e) => { console.error('cto drafts failed', e); if (live) setError(e?.message ?? 'Could not build post drafts.'); });
    return () => { live = false; };
  }, [launch, wallet]);
  return (
    <Panel title={title} note="Built from on-chain data. Review before posting.">
      {error ? <ErrorNote message={error} /> : state === 'denied' ? <OnlyCreatorNote launch={launch} /> : !state ? <Loading label="Reading on-chain data" /> : (
        <ul className="space-y-2">{state.drafts.map((d) => <DraftRow key={d.id} d={d} url={state.url} />)}</ul>
      )}
    </Panel>
  );
}

export function OfficialInfo({ profile, symbol }: { profile: CtoProfileView | null; symbol: string }) {
  const socials = profile ? (Object.keys(SOCIAL_LABELS) as (keyof Socials)[]).filter((k) => profile.socials?.[k]) : [];
  const empty = !profile || (!socials.length && !profile.faqs?.length && !profile.plan);
  return (
    <Panel title="Official info" note="Provided by the creator">
      {empty ? <p className="text-[13px] text-white/50">The creator of ${symbol} has not added official info yet.</p> : (
        <div className="space-y-4">
          {socials.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {socials.map((k) => (
                <a key={k} href={profile!.socials[k]} target="_blank" rel="noopener noreferrer nofollow"
                  className="inline-flex items-center gap-0.5 rounded-full border border-white/15 px-2.5 py-1 text-[12px] text-white/75 hover:border-white/30 hover:text-white">
                  {SOCIAL_LABELS[k]} <ArrowUpRight className="h-3 w-3" />
                </a>
              ))}
            </div>
          )}
          {profile!.plan && (
            <div>
              <div className="text-[12px] font-medium text-white/50">Plan</div>
              <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-white/80">{profile!.plan}</p>
            </div>
          )}
          {profile!.faqs?.length > 0 && (
            <div>
              <div className="text-[12px] font-medium text-white/50">FAQ</div>
              <dl className="mt-1 space-y-2">
                {profile!.faqs.map((f, i) => (
                  <div key={i} className="rounded-xl bg-white/[0.03] p-3">
                    <dt className="break-words text-[13px] font-medium">{f.q}</dt>
                    <dd className="mt-1 whitespace-pre-wrap break-words text-[13px] text-white/65">{f.a}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
