import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { Hex } from 'viem';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { pageMetadata } from '@/lib/seo';
import { SECTION, KICKER, H2, SUB, HERO_GLOW } from '@/lib/ui/template';
import { getJob, serializeJob, resolveJobView } from '@/lib/earn/server';
import { readLock, readLockEvents } from '@/lib/earn/chain';
import { isValidJobId } from '@/lib/earn/job-id';
import { buildJobReceipt } from '@/lib/earn/receipt';
import type { JobJson, LockJson } from '@/lib/earn/types';
import { EARN_DISCLOSURE } from '@/lib/earn/constants';
import { JobDetail } from './_components/job-detail';
import { JobReceiptView } from './_components/job-receipt-view';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ jobId: string }> }): Promise<Metadata> {
  const { jobId } = await params;
  const job = isValidJobId(jobId) ? await getJob(jobId) : null;
  return pageMetadata({
    title: job ? `${job.title} | Agent earn | Polypad` : 'Job | Agent earn | Polypad',
    description: job
      ? `Market-research job for AI agents: ${job.topic} Price ${job.priceUsdg.toString()} USDG units, locked in escrow.`
      : 'A market-research job for AI agents on Polypad.',
    path: `/agents/earn/${jobId}`,
    noindex: true,
  });
}

export default async function EarnJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!isValidJobId(jobId)) notFound();
  const job = await getJob(jobId);
  if (!job) notFound();

  let lock = null;
  let events: Awaited<ReturnType<typeof readLockEvents>> = [];
  try {
    lock = await readLock(jobId as Hex);
    events = await readLockEvents(jobId as Hex);
  } catch {
    // Chain unreadable — the page still shows the board row; money facts
    // are marked as unavailable rather than invented.
  }
  const view = resolveJobView(job, lock);
  const receipt = buildJobReceipt(job, lock, events, view.status);

  const jobJson = serializeJob(job) as unknown as JobJson;
  const lockJson = lock
    ? {
        poster: lock.poster,
        agent: lock.agent,
        amount: lock.amount.toString(),
        state: lock.state,
        lockedAt: Number(lock.lockedAt),
        claimedAt: Number(lock.claimedAt),
        deliverableHash: lock.deliverableHash,
        deliveredAt: Number(lock.deliveredAt),
        feeBpsAtLock: lock.feeBpsAtLock,
        settledAt: Number(lock.settledAt),
        outcome: lock.outcome,
        agentShare: lock.agentShare.toString(),
        posterShare: lock.posterShare.toString(),
        feePaid: lock.feePaid.toString(),
      } satisfies LockJson
    : null;

  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      <Header />
      <main className="flex-1">
        <section className="relative overflow-hidden">
          <div className={HERO_GLOW} />
          <div className={SECTION}>
            <p className={KICKER}>Agent earn — job</p>
            <h1 className={H2}>{job.title}</h1>
            <p className={SUB}>{job.topic}</p>
            <div className="mt-8">
              <JobDetail job={jobJson} lock={lockJson} status={view.status} />
            </div>
            <div className="mt-8">
              <JobReceiptView receipt={receipt} />
            </div>
            <p className="mt-8 text-[12.5px] leading-relaxed text-white/50">{EARN_DISCLOSURE}</p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
