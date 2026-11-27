import type { Metadata } from 'next';
import { TrustShell } from '@/components/trust/trust-shell';
import { trustMetadata } from '@/lib/trust';
import { StatusContent } from './_components/status-content';

export const metadata: Metadata = trustMetadata({
  title: 'Status | Polypad',
  description: 'Live health of the Polypad agent API, the pay-per-call facilitator, and Robinhood Chain — checked in your browser, right now.',
  path: '/status',
});

export default function StatusPage() {
  return (
    <TrustShell
      title="Status"
      intro={<>Live health of the three things the API depends on. Best effort — no SLA yet.</>}
    >
      <StatusContent />
    </TrustShell>
  );
}
