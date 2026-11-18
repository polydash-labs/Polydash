import Link from 'next/link';
import { ArrowLeft, Search } from 'lucide-react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex flex-1 items-center">
        <div className="mx-auto w-full max-w-xl px-5 py-20 text-center sm:px-8 sm:py-28">
          <p className="font-mono text-sm tracking-widest text-polydash-green tabular-nums">404</p>
          <h1 className="mt-4 text-[28px] sm:text-[40px] font-semibold tracking-tight leading-tight">Page not found</h1>
          <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-white/65">
            The page you are looking for does not exist or has moved. If you followed a token link, check the address.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/"><ArrowLeft className="mr-1.5 h-4 w-4" strokeWidth={1.5} />Back to home</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/stake"><Search className="mr-1.5 h-4 w-4" strokeWidth={1.5} />Browse staking pools</Link>
            </Button>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
