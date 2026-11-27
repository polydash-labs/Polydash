import type { ReactNode } from 'react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';

export function LegalPage({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  updated: string;
  intro?: ReactNode;
  sections: { h: string; p: ReactNode }[];
}) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <article className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-16">
          <h1 className="text-[28px] sm:text-[40px] font-semibold tracking-tight leading-tight">{title}</h1>
          <p className="mt-3 text-sm text-white/60">Last updated {updated}</p>
          {intro ? <div className="mt-6 text-sm sm:text-[15px] leading-relaxed text-white/75">{intro}</div> : null}
          <div className="mt-10 space-y-8">
            {sections.map((s) => (
              <section key={s.h}>
                <h2 className="text-base font-semibold">{s.h}</h2>
                <p className="mt-2 text-sm sm:text-[15px] leading-relaxed text-white/65">{s.p}</p>
              </section>
            ))}
          </div>
        </article>
      </main>
      <Footer />
    </div>
  );
}
