'use client';

import { useState } from 'react';

/**
 * Newsletter subscribe card for the Explore page. Collects an email for the
 * weekly updates / announcements list (POST /api/newsletter/subscribe, stored
 * in Neon). Dark card to match the marketplace card system.
 */
export function NewsletterSubscribe() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (state === 'sending') return;
    setState('sending');
    setMessage('');
    try {
      const res = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState('error');
        setMessage(data?.error ?? 'Something went wrong. Please try again.');
        return;
      }
      setState('done');
    } catch {
      setState('error');
      setMessage('Could not reach the server. Please try again.');
    }
  }

  return (
    <div className="rounded-[20px] border border-white/10 bg-[#151a1f] p-5 text-white shadow-[0_16px_40px_rgba(0,0,0,0.4)] sm:p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-polydash-green">
        Stay in the loop
      </p>
      <h2 className="mt-2 text-[22px] font-bold leading-tight tracking-tight sm:text-[26px]">
        Get the weekly update.
      </h2>
      <p className="mt-2 max-w-[560px] text-[14px] leading-relaxed text-white/60">
        One email a week — what shipped, what&apos;s new with Polypad and the funds, and
        the announcements that matter. No spam, unsubscribe any time.
      </p>

      {state === 'done' ? (
        <p className="mt-5 rounded-2xl bg-[#00E676]/10 px-4 py-3.5 text-[14px] leading-relaxed text-white">
          <span className="font-semibold text-[#00E676]">You&apos;re in.</span> Watch your
          inbox for the next weekly update.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-2.5 sm:flex-row">
          <label htmlFor="newsletter-email" className="sr-only">
            Email address
          </label>
          <input
            id="newsletter-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            disabled={state === 'sending'}
            className="h-12 flex-1 rounded-full border border-white/15 bg-white/[0.04] px-4 text-[14px] text-white placeholder:text-white/40 outline-none transition-colors focus:border-polydash-green disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={state === 'sending'}
            className="inline-flex h-12 items-center justify-center whitespace-nowrap rounded-full bg-polydash-green px-6 text-[14px] font-semibold text-black transition-colors hover:bg-polydash-green-light disabled:opacity-60"
          >
            {state === 'sending' ? 'Subscribing…' : 'Subscribe'}
          </button>
        </form>
      )}

      {state === 'error' && message && (
        <p className="mt-3 text-[13px] leading-relaxed text-red-300">{message}</p>
      )}
      {state !== 'done' && (
        <p className="mt-3 text-[12px] leading-relaxed text-white/40">
          We only email weekly updates and announcements. Your address stays with
          Polypad — never sold, never shared.
        </p>
      )}
    </div>
  );
}
