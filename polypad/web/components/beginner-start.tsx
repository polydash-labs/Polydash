import Link from 'next/link';

/**
 * BeginnerStart — the shared "New to crypto?" block.
 *
 * A complete beginner's front door: what a wallet is, how to get ETH onto
 * Robinhood Chain, and that they come back here to connect. Import it at the
 * top of any page where a user is asked to connect a wallet or spend ETH.
 *
 * Props:
 * - compact: shorter text, no wallet download links (for tight spots).
 * - className: extra wrapper classes.
 */
export default function BeginnerStart({
  compact = false,
  className = '',
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <section
      aria-label="New to crypto? Start here"
      className={`rounded-2xl border border-polydash-green/30 bg-polydash-green/[0.06] p-5 ${className}`}
    >
      <p className="text-[13px] font-semibold text-white">New to crypto? Start here — 3 steps.</p>
      <ol className="mt-3 space-y-2 text-[13px] leading-relaxed text-white/70">
        <li>
          <span className="font-semibold text-white">1. Get a wallet.</span> A wallet is your
          crypto account — an app that holds your money and approves what you do here. Download{' '}
          <a
            href="https://metamask.io/download/"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-polydash-green underline underline-offset-2"
          >
            MetaMask
          </a>{' '}
          or{' '}
          <a
            href="https://www.coinbase.com/wallet/downloads"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-polydash-green underline underline-offset-2"
          >
            Coinbase Wallet
          </a>
          {compact ? (
            <> and set it up — it takes a few minutes.</>
          ) : (
            <>
              {' '}
              and set it up — it takes a few minutes. Your wallet will give you a secret recovery
              phrase (12 or 24 words). Write it down on paper and keep it private.
            </>
          )}
        </li>
        <li>
          <span className="font-semibold text-white">2. Get ETH on Robinhood Chain.</span> ETH is
          the money used on this site — for buying shares and for the small network fee (gas, a few
          cents per action).{' '}
          <a
            href="https://relay.link/onramp/robinhood"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-polydash-green underline underline-offset-2"
          >
            Buy ETH with a card (Relay)
          </a>{' '}
          and send it to your wallet — about $20 buys roughly one Tokenized Fund share plus fees.
        </li>
        <li>
          <span className="font-semibold text-white">3. Come back and connect.</span> Press
          “Connect wallet” on this page, pick your wallet, and approve the connection. Nothing
          moves until you confirm each step in your wallet.
        </li>
      </ol>
      <p className="mt-3 text-[12px] leading-relaxed text-white/60">
        Never share your secret recovery phrase with anyone — not even Polypad support. Polypad
        will never ask for it. Anyone with those words can take your money.{' '}
        <Link href="/about" className="text-polydash-green underline underline-offset-2">
          How Polypad works
        </Link>
        {' · '}
        <Link href="/start" className="text-polydash-green underline underline-offset-2">
          Not sure what to do first? Start here
        </Link>
      </p>
    </section>
  );
}
