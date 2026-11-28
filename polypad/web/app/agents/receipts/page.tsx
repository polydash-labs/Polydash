import type { Metadata } from 'next';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { pageMetadata } from '@/lib/seo';
import type { AgentReceipt } from '@/lib/receipts/types';
import { ReceiptsDirectory } from './_components/receipts-directory';

export const metadata: Metadata = pageMetadata({
  title: 'Agent action receipts | Polypad',
  description:
    'Public, verifiable receipts for agent actions on Polypad. Each receipt shows the agent identity, the authority it acted under, the approval obtained, and how it settled — checkable by anyone against Robinhood Chain.',
  path: '/agents/receipts',
});

interface ReceiptIndex {
  format: string;
  receipts: { id: string; type: string; file: string; transactionHash: string }[];
}

async function loadReceipts(): Promise<{ receipt: AgentReceipt; file: string }[]> {
  const dir = path.join(process.cwd(), 'public', 'receipts');
  try {
    const index = JSON.parse(await readFile(path.join(dir, 'index.json'), 'utf8')) as ReceiptIndex;
    const out: { receipt: AgentReceipt; file: string }[] = [];
    for (const entry of index.receipts) {
      try {
        out.push({
          receipt: JSON.parse(await readFile(path.join(dir, entry.file), 'utf8')) as AgentReceipt,
          file: entry.file,
        });
      } catch {
        // Skip an entry whose file cannot be read; the index stays the source of truth.
      }
    }
    return out;
  } catch {
    return [];
  }
}

export default async function AgentReceiptsPage() {
  const items = await loadReceipts();
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <ReceiptsDirectory items={items} />
      </main>
      <Footer />
    </div>
  );
}
