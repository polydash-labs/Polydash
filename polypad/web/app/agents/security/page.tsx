import type { Metadata } from 'next';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { AgentSecurityContent } from './_components/security-content';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Security for AI agents | Polypad',
  description:
    'How Polypad keeps AI agents safe with your money: an on-chain firewall (daily caps + owner freeze), continuous monitoring, verifiable receipts, and a public audit.',
  path: '/agents/security',
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

export default async function AgentSecurityPage() {
  const count = await receiptCount();
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <AgentSecurityContent receiptCount={count} />
      </main>
      <Footer />
    </div>
  );
}
