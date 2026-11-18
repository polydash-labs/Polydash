import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { TokenDetailContent } from './_components/token-detail-content';
import { notFound } from 'next/navigation';
import { getLaunchLookup } from '@/lib/launches-server';
import { getTokenPreview, previewDescription } from '@/lib/token-preview';
import { pageMetadata } from '@/lib/seo';
import { getExternalToken } from '@/lib/listed-tokens';
import { ExternalTokenContent } from './_components/external-token-content';

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  const path = `/token/${address.toLowerCase()}`;
  const ext = getExternalToken(address);
  if (ext) {
    return pageMetadata({
      title: `$${ext.symbol} - ${ext.name} | Polypad`,
      description: `$${ext.symbol} on Robinhood Chain: listed token page with staking status and CTO report. Not financial advice.`,
      path,
    });
  }
  try {
    const { token, health } = await getTokenPreview(address);
    if (token) {
      // Canonical = launch contract address (what Explore links to), whether the URL used the token or the launch address.
      const launch = token.launchAddress.toLowerCase();
      return pageMetadata({
        title: `$${token.symbol} - ${token.name} | Polypad`,
        description: previewDescription(token, health),
        path: `/token/${launch}`,
        image: `/api/og/token/${launch}`,
        imageAlt: `$${token.symbol} on Polypad`,
      });
    }
  } catch (e) {
    console.error('token metadata failed', address, (e as Error)?.message);
  }
  return pageMetadata({ title: 'Token | Polypad', description: 'Token on Polypad, Robinhood Chain: bonding curve, trades and CTO report.', path });
}

export default async function TokenPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const ext = getExternalToken(address);
  if (ext) {
    // Listed token launched outside the factory: its own page, never a factory lookup.
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1">
          <ExternalTokenContent token={{ address: ext.address, symbol: ext.symbol, name: ext.name, imageUri: ext.imageUri, creator: ext.creator }} />
        </main>
        <Footer />
      </div>
    );
  }
  const { token: initial, missing } = await getLaunchLookup(address, 2_500).catch(() => ({ token: null, missing: false }));
  // Only a malformed address or a confirmed (error-free) lookup miss returns 404; timeouts still render the client page.
  if (missing) notFound();
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
        <TokenDetailContent address={address} initial={initial} />
      </main>
      <Footer />
    </div>
  );
}
