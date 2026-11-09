import Link from 'next/link';

const ROWS = [
  ['Locked template', 'The mandate, asset list, caps, performance fee, drawdown brake, and skin lock are copied from a published template. There is no edit function on the template or the fund.'],
  ['High-water mark', 'A performance fee accrues only on the gain in net value per share above the mark. The manager pulls that fee later. It is not a withdrawal of principal.'],
  ['Skin lock', 'The manager’s required shares cannot be transferred until the template’s lock ends. Burning them to exit is still allowed.'],
  ['NAV tape', 'Checkpoints and swaps emit a tape with net value, the high-water mark, and the drawdown. The trade blotter still records each fill.'],
  ['Drawdown brake', 'A new buy of a mandate asset reverts when the drop from the peak reaches the template’s limit. Sells and ETH/WETH wraps stay available. A limit of 0 leaves the brake off.'],
  ['Distributions', 'The manager can set aside spendable ETH for current shares. Holders pull their part. An exit pays any unclaimed part of those rounds first.'],
];

export default function Phase3Page() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10 text-white sm:px-8">
      <Link href="/funds" className="text-[12px] text-white/45 hover:text-white">
        Funds
      </Link>
      <p className="mt-6 text-[12px] uppercase tracking-widest text-white/40">Not deployed</p>
      <h1 className="mt-3 text-[28px] font-semibold tracking-tight sm:text-[36px]">Phase 3 manager tools</h1>
      <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-white/60">
        These contracts are source only. No Phase 3 address is live. This page does not ask a wallet to deploy or
        sign. Not a review. Not financial advice.
      </p>
      <dl className="mt-8 divide-y divide-white/10 border-y border-white/10">
        {ROWS.map(([title, body]) => (
          <div key={title} className="py-4">
            <dt className="text-[14px] font-medium">{title}</dt>
            <dd className="mt-1 text-[13px] leading-relaxed text-white/55">{body}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-6 text-[12px] leading-relaxed text-white/40">
        The unsigned creation payloads are in <span className="text-white/60">deploy/phase3/unsigned</span>. Nonces are
        not fixed there. They have to be read at signing time.
      </p>
    </div>
  );
}
