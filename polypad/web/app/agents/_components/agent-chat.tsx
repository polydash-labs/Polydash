'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, Loader2 } from 'lucide-react';
import { parseIntent, type AgentId, type Intent } from '@/lib/agents/tools';
import { ErrorNote, card } from './ui';
import { cn } from '@/lib/utils';

interface Msg { id: number; role: 'user' | 'assistant'; text?: string; node?: ReactNode }

export function AgentChat({ agent, hint, resolve, onReply, tokenAddress, ctoName, title = 'Chat' }: {
  agent: AgentId;
  hint: string;
  resolve: (intent: Intent) => Promise<ReactNode> | ReactNode;
  onReply?: (text: string) => ReactNode | null;
  tokenAddress?: string;
  ctoName?: string;
  title?: string;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const idRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (msgs.length) endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [msgs]);

  const push = (m: Omit<Msg, 'id'>) => setMsgs((prev) => [...prev, { ...m, id: ++idRef.current }]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    if (text.length > 2000) { push({ role: 'assistant', node: <ErrorNote message="Messages are limited to 2000 characters." /> }); return; }
    const history = msgs.filter((m) => m.text).slice(-10).map((m) => ({ role: m.role, content: m.text as string }));
    setInput('');
    push({ role: 'user', text });
    setBusy(true);
    try {
      const intent = parseIntent(agent, text);
      if (intent) {
        push({ role: 'assistant', node: await resolve(intent) });
      } else {
        const res = await fetch(`/api/agents/${agent}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task: text, history, tokenAddress, ...(ctoName ? { ctoName } : {}) }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? 'The agent could not answer right now.');
        const reply = String(data?.reply ?? '');
        const node = onReply?.(reply) ?? null;
        push(node ? { role: 'assistant', node } : { role: 'assistant', text: reply });
      }
    } catch (e: any) {
      console.error('agent chat failed', e);
      push({ role: 'assistant', node: <ErrorNote message={e?.message ?? 'Something went wrong.'} /> });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn(card, 'p-4 sm:p-5')}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[14px] font-semibold">{title}</h3>
        <span className="text-[11px] text-white/40">{hint}</span>
      </div>
      {msgs.length > 0 && (
        <div className="mb-3 max-h-[560px] space-y-3 overflow-y-auto pr-1">
          {msgs.map((m) => (
            <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              {m.node ? <div className="w-full">{m.node}</div> : (
                <div className={cn('max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[13px]',
                  m.role === 'user' ? 'bg-polydash-green/15 text-white' : 'bg-white/[0.06] text-white/85')}>{m.text}</div>
              )}
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-[12px] text-white/45"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Working</div>}
          <div ref={endRef} />
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1}
          maxLength={2000}
          placeholder="Ask the agent"
          className="min-h-[40px] flex-1 resize-none rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-[16px] text-white placeholder:text-white/35 focus:border-polydash-green/50 focus:outline-none sm:text-[13px]"
        />
        <button type="submit" disabled={busy || !input.trim()} aria-label="Send"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-polydash-green text-black transition-opacity disabled:opacity-40">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </form>
    </div>
  );
}
