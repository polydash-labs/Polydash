import Image from 'next/image';
import Link from 'next/link';

export function Footer() {
  return (
    <>
      <footer className="border-t border-black/10 bg-white text-black">
        <div className="mx-auto max-w-container px-5 py-10 sm:px-8 sm:py-20">
          <div className="grid grid-cols-2 gap-8 sm:gap-12 lg:grid-cols-[1.4fr_1fr_1fr]">
            <div className="col-span-2 lg:col-span-1">
              <Link href="/" className="flex items-center gap-2">
                <Image src="/polydash-mark-black.png" alt="Polypad logo" width={26} height={26} className="h-[26px] w-[26px]" />
                <span className="text-lg font-semibold tracking-tight text-black">Polypad</span>
              </Link>
              <p className="mt-4 max-w-sm text-[13px] leading-relaxed sm:text-sm text-black/50">
                Token launchpad on Robinhood Chain. Bonding curve to Uniswap V4.
              </p>
            </div>
            <div>
              <h4 className="mb-4 text-xs font-semibold uppercase tracking-widest text-black/40">Launchpad</h4>
              <ul className="space-y-3">
                <li><Link href="/" className="text-sm text-black/50 transition-colors hover:text-black">Explore</Link></li>
                <li><Link href="/create" className="text-sm text-black/50 transition-colors hover:text-black">Create a token</Link></li>
                <li><Link href="/leaderboard" className="text-sm text-black/50 transition-colors hover:text-black">Leaderboard</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="mb-4 text-xs font-semibold uppercase tracking-widest text-black/40">Ecosystem</h4>
              <ul className="space-y-3">
                <li><a href="https://dasheco.xyz/" target="_blank" rel="noopener noreferrer" className="text-sm text-black/50 transition-colors hover:text-black">Polydash ecosystem</a></li>
                <li><Link href="/portfolio" className="text-sm text-black/50 transition-colors hover:text-black">Portfolio</Link></li>
                <li><Link href="/about" className="text-sm text-black/50 transition-colors hover:text-black">About</Link></li>
                <li><Link href="/docs" className="text-sm text-black/50 transition-colors hover:text-black">Docs</Link></li>
              </ul>
            </div>
          </div>
          <div className="mt-10 flex flex-col items-start justify-between gap-2 border-t border-black/10 pt-6 sm:mt-14 sm:flex-row sm:items-center sm:pt-8">
            <p className="text-xs text-black/50 sm:text-sm">© 2026 Polypad</p>
          </div>
        </div>
      </footer>
    </>
  );
}
