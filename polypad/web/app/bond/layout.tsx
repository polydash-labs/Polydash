import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';

/** app/bond/page.tsx is a client component, so its metadata lives here.
 * Bond detail pages set their own metadata and override this. */
export const metadata: Metadata = pageMetadata({
  title: 'Bonds | Polypad',
  description: 'On-chain bonds on Robinhood Chain: see live bonds, their terms and payouts — everything verifiable on-chain.',
  path: '/bond',
});

export default function BondLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
