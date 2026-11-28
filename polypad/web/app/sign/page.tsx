import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { SignFlow } from './_components/sign-flow';

export const metadata: Metadata = {
  title: 'Sign with your wallet',
  description: 'Review an action prepared by a chat agent and sign it in your own wallet on Robinhood Chain.',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function SignPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <Suspense fallback={<p className="mx-auto max-w-lg px-4 py-12 text-[14px] text-white/60">Loading…</p>}>
          <SignFlow />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
