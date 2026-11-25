import type { Metadata } from 'next';
import { TrustShell } from '@/components/trust/trust-shell';
import { trustMetadata } from '@/lib/trust';
import { PulseContent } from './_components/pulse-content';

export const metadata: Metadata = trustMetadata({
  title: 'Pulse | Polypad',
  description: 'Our numbers, in public, updated live: SDK downloads, registry listing, agents registered, tokenized funds, total TVL, platform API usage totals, and pay-per-call prices — with the source for every figure.',
  path: '/pulse',
});

export default function PulsePage() {
  return (
    <TrustShell
      title="Pulse"
      intro={
        <>
          Our numbers, in public, updated live. Every figure shows where it came from and when it was checked.
        </>
      }
    >
      <PulseContent />
    </TrustShell>
  );
}
