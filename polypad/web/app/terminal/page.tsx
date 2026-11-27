import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { TerminalContent } from './_components/terminal-content';
import { pageMetadata } from '@/lib/seo';
import { getInitialTerminal } from '@/lib/first-paint';

export const metadata = pageMetadata({
  title: 'Terminal | Polypad',
  description: 'Live activity across Polypad — Tokenized Fund NAV rankings, recent trades, share mints and new staking pools, read straight from Robinhood Chain.',
  path: '/terminal',
});

/**
 * First paint carries real figures: the server component reads the live
 * fund lists, the 24h activity scan and the NAVs before sending HTML, and
 * the client starts from that data instead of the "Updating…" skeleton.
 * The root layout forces dynamic rendering, so ISR does not apply — the
 * 30s freshness comes from the in-module server caches
 * (lib/fund/list-server.ts, lib/terminal/server.ts), and export const
 * revalidate = 30 is kept so ISR takes over if force-dynamic is ever
 * lifted.
 */
export const revalidate = 30;

export default async function TerminalPage() {
  const initial = await getInitialTerminal();
  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      <Header />
      <main className="flex-1">
        <TerminalContent
          initialWire={initial?.wire}
          initialActivity={initial?.activity ?? undefined}
          initialNavs={initial?.navs ?? undefined}
        />
      </main>
      <Footer />
    </div>
  );
}
