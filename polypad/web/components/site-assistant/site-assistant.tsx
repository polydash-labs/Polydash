'use client';

import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Msg {
  id: number;
  role: 'user' | 'assistant';
  text: string;
}

const SUGGESTIONS = [
  'What is Polypad?',
  'How do I launch a token?',
  'What is the Polyfund?',
  'Where is the API?',
];

const GREETING =
  "Hi, I'm Poly Agent — Polypad's on-site assistant. Ask me anything about Polypad, or where to find something.";

/** Render [label](/path) markdown links as real links; everything else as plain text. */
function renderText(text: string) {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, i) => {
    const m = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (!m) return <span key={i}>{part}</span>;
    const [, label, href] = m;
    const external = href.startsWith('http');
    return (
      <a
        key={i}
        href={href}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        className="font-medium text-[#00E676] underline decoration-[#00E676]/50 underline-offset-2 hover:decoration-[#00E676]"
      >
        {label}
      </a>
    );
  });
}

export function SiteAssistant() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const idRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && msgs.length) endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [msgs, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open ]);

  const send = async (rawText?: string) => {
    const text = (rawText ?? input).trim();
    if (!text || busy) return;
    if (text.length > 2000) return;
    const history = msgs
      .filter((m) => m.text)
      .slice(-9)
      .map((m) => ({ role: m.role, content: m.text }));
    setInput('');
    const userMsg: Msg = { id: ++idRef.current, role: 'user', text };
    setMsgs((prev) => [...prev, userMsg]);
    setBusy(true);
    try {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...history, { role: 'user', content: text }] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error ?? 'Poly Agent could not answer right now.'));
      const reply = String(data?.reply ?? '').trim();
      if (!reply) throw new Error('Poly Agent returned no reply.');
      setMsgs((prev) => [...prev, { id: ++idRef.current, role: 'assistant', text: reply }]);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Something went wrong.';
      setMsgs((prev) => [...prev, { id: ++idRef.current, role: 'assistant', text: message }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Floating button — bottom-right, bright green gradient, "Poly Agent" in words. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Close Poly Agent chat' : 'Open Poly Agent chat'}
        className="fixed bottom-4 right-4 z-50 flex h-12 items-center gap-2 rounded-full bg-[linear-gradient(135deg,#00E676_0%,#5CFFA8_55%,#A8FFCF_100%)] px-4 text-[15px] font-bold text-black shadow-lg shadow-[#00E676]/30 transition-transform hover:scale-[1.03] active:scale-[0.98]"
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
        Poly Agent
      </button>

      {/* Chat panel — black gradient background, readable green text. */}
      {open && (
        <div
          role="dialog"
          aria-label="Poly Agent chat"
          className="fixed bottom-[76px] left-4 right-4 z-50 flex h-[min(68dvh,560px)] flex-col overflow-hidden rounded-3xl border border-[#00E676]/25 bg-[linear-gradient(180deg,#0A0F0C_0%,#050807_55%,#000000_100%)] shadow-2xl shadow-black/60 sm:left-auto sm:right-4 sm:w-[380px]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-[#00E676]/15 px-4 py-3">
            <div>
              <div className="text-[15px] font-bold leading-tight text-[#00E676]">Poly Agent</div>
              <div className="text-[11px] leading-tight text-[#7CE8A8]/80">
                Polypad&apos;s on-site assistant
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#8FF5B6] transition-colors hover:bg-white/5"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            <div className="flex justify-start">
              <div className="max-w-[90%] whitespace-pre-wrap break-words rounded-2xl bg-white/[0.04] px-3.5 py-2 text-[13px] leading-relaxed text-[#C9FFE0]">
                {GREETING}
              </div>
            </div>
            {msgs.map((m) => (
              <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed',
                    m.role === 'user'
                      ? 'bg-[#00E676]/20 text-[#D9FFE9]'
                      : 'bg-white/[0.04] text-[#C9FFE0]',
                  )}
                >
                  {renderText(m.text)}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-[12px] text-[#7CE8A8]/70">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#00E676]" />
                Poly Agent is thinking…
              </div>
            )}
            <div ref={endRef} />
          </div>

          {msgs.length === 0 && !busy && (
            <div className="flex flex-wrap gap-2 px-4 pb-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-full border border-[#00E676]/40 px-3 py-1.5 text-[12px] text-[#8FF5B6] transition-colors hover:bg-[#00E676]/10"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="flex items-end gap-2 border-t border-[#00E676]/15 px-3 py-3"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder="Ask Poly Agent…"
              aria-label="Message Poly Agent"
              className="min-h-[40px] flex-1 resize-none rounded-2xl border border-white/10 bg-black/60 px-3.5 py-2.5 text-[16px] text-[#E6FFF0] placeholder:text-[#5C7A68] focus:border-[#00E676]/60 focus:outline-none sm:text-[13px]"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-label="Send"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#00E676_0%,#5CFFA8_55%,#A8FFCF_100%)] text-black transition-opacity disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
