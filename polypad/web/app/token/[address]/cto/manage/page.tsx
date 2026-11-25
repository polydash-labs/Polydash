import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { CtoManage } from './_components/cto-manage';

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
