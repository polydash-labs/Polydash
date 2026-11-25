import type { Metadata } from 'next';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { BusinessContent } from './_components/business-content';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Polypad for business | Polypad',
  description:
    'AI infrastructure for commercial businesses: a secure agent wallet with limits you set, pay-per-call tools from $0.01, $25 free starter credits, and a receipt for every job.',
  path: '/business',
});

interface ReceiptIndex {
  format: string;
  receipts: { id: string; type: string; file: string; transactionHash: string }[];
}

async function receiptCount(): Promise<number> {
  try {
    const dir = path.join(process.cwd(), 'public', 'receipts');
    const index = JSON.parse(await readFile(path.join(dir, 'index.json'), 'utf8')) as ReceiptIndex;
    return index.receipts.length;
  } catch {
    return 0;
  }
}

export default async function BusinessPage() {
  const count = await receiptCount();
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <BusinessContent receiptCount={count} />
      </main>
      <Footer />
    </div>
  );
}
