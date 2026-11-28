export type GlossaryTerm = { term: string; def: string };

const DEFAULT_TERMS: GlossaryTerm[] = [
  {
    term: 'Wallet',
    def: 'Your crypto account — an app (like MetaMask or Coinbase Wallet) that holds your money and approves what you do on a site. You connect it; Polypad never sees your password or recovery phrase.',
  },
  {
    term: 'ETH',
    def: 'The money used on Robinhood Chain. You pay in ETH and you also pay the small network fee (gas) in ETH.',
  },
  {
    term: 'Gas (network fee)',
    def: 'A small fee paid to the network for each action — usually a few cents. It is paid separately, on top of the amount you are spending, and you need a little extra ETH for it.',
  },
  {
    term: 'Mint / buy a share',
    def: 'Buying a share is called minting — you pay ETH and an NFT share (a digital certificate for your share) arrives in your wallet.',
  },
  {
    term: 'Sign',
    def: 'Approving an action in your wallet. Signing just says “yes, do this” — it does not give Polypad access to your money.',
  },
  {
    term: 'Approve',
    def: 'Letting this page move a specific coin, up to a specific amount, once. Approving alone moves nothing — the next step actually moves it.',
  },
  {
    term: 'Chain / network',
    def: 'Polypad runs on Robinhood Chain. Your wallet will ask you to switch to it — that is free and takes one tap.',
  },
  {
    term: 'Token',
    def: 'A digital coin on the chain. POLYDASH is Polypad’s own token; USDG is a digital dollar (1 USDG ≈ $1).',
  },
  {
    term: 'Tokenized Fund',
    def: 'A fund whose shares are NFTs. You buy a share with ETH, the manager invests the pooled ETH in public, and you can sell your share or get your money back.',
  },
  {
    term: 'Value per share',
    def: 'What one share is worth right now — the fund’s total value divided by the number of shares. It goes up and down with the investments.',
  },
  {
    term: 'Vault',
    def: 'The fund’s safe — a smart contract that holds the money. Only the fund’s own rules can move money out of it.',
  },
  {
    term: 'Slippage',
    def: 'How much a price can move while your transaction is waiting. If it moves too far, the transaction stops instead of giving you a bad price.',
  },
];

/**
 * GlossaryBox — a collapsible "Words used on this page" box.
 *
 * Define terms on first use instead of sending beginners to a separate
 * glossary page. Pass `terms` to add page-specific words or override a
 * default definition; defaults are always included.
 */
export default function GlossaryBox({
  terms = [],
  className = '',
}: {
  terms?: GlossaryTerm[];
  className?: string;
}) {
  const merged = [...DEFAULT_TERMS];
  for (const t of terms) {
    const i = merged.findIndex((m) => m.term.toLowerCase() === t.term.toLowerCase());
    if (i >= 0) merged[i] = t;
    else merged.push(t);
  }
  return (
    <details
      className={`rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 ${className}`}
    >
      <summary className="cursor-pointer text-[13px] font-medium text-white">
        Words used on this page
        <span className="ml-2 font-normal text-white/50">— tap to see plain-English definitions</span>
      </summary>
      <dl className="mt-3 space-y-2 text-[13px] leading-relaxed">
        {merged.map((t) => (
          <div key={t.term}>
            <dt className="inline font-semibold text-white">{t.term}: </dt>
            <dd className="inline text-white/70">{t.def}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
