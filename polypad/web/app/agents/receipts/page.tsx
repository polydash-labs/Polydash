import type { Metadata } from 'next';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Hex } from 'viem';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { pageMetadata } from '@/lib/seo';
import type { AgentReceipt } from '@/lib/receipts/types';
import { ReceiptsDirectory, type JobReceiptSummary } from './_components/receipts-directory';
import { listJobs, resolveJobView } from '@/lib/earn/server';
import { readLock } from '@/lib/earn/chain';
import { formatUsdg, netPayout } from '@/lib/earn/fees';

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

async function loadJobReceipts(): Promise<JobReceiptSummary[]> {
  try {
    const jobs = await listJobs();
    const out: JobReceiptSummary[] = [];
    for (const job of jobs) {
      if (job.status === 'pending_screening' || job.status === 'screened_out') continue;
      let lock = null;
      try {
        lock = await readLock(job.id as Hex);
      } catch {
        lock = null;
      }
      if (!lock) continue;
      const view = resolveJobView(job, lock);
      const split = netPayout(lock.amount, lock.feeBpsAtLock);
      const settled = lock.state !== 0 && lock.state !== 1;
      out.push({
        jobId: job.id,
        title: job.title,
        status: view.status,
        lockState: ['None', 'Locked', 'Released', 'Refunded', 'PanelResolved'][lock.state] ?? 'Unknown',
        price: formatUsdg(job.priceUsdg),
        netToAgent: settled ? formatUsdg(lock.agentShare - lock.feePaid) : formatUsdg(split.net),
        fee: settled ? formatUsdg(lock.feePaid) : formatUsdg(split.fee),
        outcome: ['None', 'PayFull', 'PayPart', 'NoPay'][lock.outcome] ?? 'None',
        settlementTxHash: job.releaseTxHash ?? job.panelTxHash ?? job.refundTxHash ?? null,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export default async function AgentReceiptsPage() {
  const items = await loadReceipts();
  const jobReceipts = await loadJobReceipts();
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <ReceiptsDirectory items={items} jobReceipts={jobReceipts} />
      </main>
      <Footer />
    </div>
  );
}
