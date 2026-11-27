import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { ADMIN_COOKIE, readAdmin } from '@/lib/agent-actions';
import { pageMetadata } from '@/lib/seo';
import { CreditsContent } from './_components/credits-content';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = pageMetadata({
  title: 'Poly credits | Polypad',
  description: 'Free Poly credits pay for pay-per-call reports — token report, fund NAV, CTO report — so agent developers can try them without holding crypto. Claim a $25 starter balance.',
  path: '/agents/credits',
});

export default async function PolyCreditsPage() {
  const admin = await readAdmin((await cookies()).get(ADMIN_COOKIE)?.value);
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <CreditsContent isAdmin={admin !== null} />
      </main>
      <Footer />
    </div>
  );
}
