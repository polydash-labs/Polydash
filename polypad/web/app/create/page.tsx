import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { CreateWizard } from './_components/create-wizard';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Create a token | Polypad',
  description: 'Launch a token on Robinhood Chain: set name, ticker, logo and creator fee, with an optional commitment window before trading opens.',
  path: '/create',
});

export default async function CreatePage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.agent) ? params.agent[0] : params.agent;
  const agentLaunch = raw === '1' || raw === 'true';
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <CreateWizard agentLaunch={agentLaunch} />
      </main>
      <Footer />
    </div>
  );
}
