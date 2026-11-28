import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import { notFound } from 'next/navigation';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { readAgentIdentityCached, AgentNotFoundError } from '@/lib/agents/identity';
import { IdentityCard } from './_components/identity-card';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const agentId = Number(id);
  if (!Number.isInteger(agentId) || agentId < 1) {
    return pageMetadata({
      title: 'Agent not found | Polypad',
      description: 'This agent does not exist on Polypad.',
      path: `/agents/${id}`,
    });
  }
  try {
    const identity = await readAgentIdentityCached(agentId);
    return pageMetadata({
      title: `${identity.name} — Know your agent | Polypad`,
      description: `The public identity card for ${identity.name} (agent #${agentId}): who it is, who controls it, what it can spend, and what its owner authorized. Read live from Robinhood Chain.`,
      path: `/agents/${agentId}`,
    });
  } catch {
    return pageMetadata({
      title: 'Agent not found | Polypad',
      description: 'This agent does not exist on Polypad.',
      path: `/agents/${id}`,
    });
  }
}

export default async function AgentIdentityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agentId = Number(id);
  if (!Number.isInteger(agentId) || agentId < 1) notFound();
  let identity;
  try {
    identity = await readAgentIdentityCached(agentId);
  } catch (err) {
    if (err instanceof AgentNotFoundError) notFound();
    throw err;
  }
  return (
    <div className="min-h-screen flex flex-col bg-background text-white">
      <Header />
      <main className="flex-1">
        <IdentityCard identity={identity} />
      </main>
      <Footer />
    </div>
  );
}
