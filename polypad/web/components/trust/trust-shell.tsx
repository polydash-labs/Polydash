import type { ReactNode } from 'react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';

export function TrustShell({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <article className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-16">
          <h1 className="text-[28px] sm:text-[40px] font-semibold tracking-tight leading-tight">{title}</h1>
          {intro ? <p className="mt-4 text-sm sm:text-[15px] leading-relaxed text-white/75">{intro}</p> : null}
          <div className="mt-10 space-y-10">{children}</div>
        </article>
      </main>
      <Footer />
    </div>
  );
}

export function TrustSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-3 text-sm sm:text-[15px] leading-relaxed text-white/65">{children}</div>
    </section>
  );
}

export function TrustCard({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl bg-[#121212] px-4 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset] ring-1 ring-white/[0.06] divide-y divide-white/[0.06] sm:px-5">{children}</div>;
}

export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#00E676] hover:underline break-all">
      {children}
    </a>
  );
}

export function EmailLink({ email, subject }: { email: string; subject?: string }) {
  const href = subject ? `mailto:${email}?subject=${encodeURIComponent(subject)}` : `mailto:${email}`;
  return (
    <a href={href} className="text-[#00E676] hover:underline">
      <span suppressHydrationWarning>{email}</span>
    </a>
  );
}
