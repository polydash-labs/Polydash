import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { CtoManage } from './_components/cto-manage';

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  return pageMetadata({
    title: 'Manage community takeover | Polypad',
    description: 'Manage a community takeover for this token on Polypad.',
    path: `/token/${address.toLowerCase()}/cto/manage`,
    noindex: true,
  });
}

export default async function CtoManagePage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <CtoManage launchAddress={address} />
      </main>
      <Footer />
    </div>
  );
}
