import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { CreateWizard } from './_components/create-wizard';

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
