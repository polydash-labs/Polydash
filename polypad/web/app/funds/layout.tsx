import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { fundsPublicEnabled } from '@/lib/fund/visibility';
import { FundHidden } from './_components/fund-hidden';

export default function FundsLayout({ children }: { children: React.ReactNode }) {
  if (!fundsPublicEnabled()) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1">
          <FundHidden />
        </main>
        <Footer />
      </div>
    );
  }
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
