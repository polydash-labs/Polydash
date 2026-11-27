/** Honest limits (spec §7) — shown on every wallet page, not in fine print. */
export function HonestLimitsBox() {
  return (
    <section aria-label="Be honest about the limits" className="rounded-[20px] border border-[#4a3a12] bg-[#191510] p-6 sm:p-8">
      <h2 className="text-[20px] font-bold tracking-tight text-amber-300 sm:text-[22px]">Be honest about the limits</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-[14.5px] leading-relaxed text-white/60">
        <li>
          <b className="font-semibold text-white/90">The 1,000 POLYDASH registration bond is worth about $0.0003</b> — it stops spam, it is not
          insurance and it does not pay you back if something goes wrong.
        </li>
        <li>
          <b className="font-semibold text-white/90">These wallet contracts have not been checked by an outside auditor yet</b> (automated
          checks only). The wallet itself is built on Safe, which is audited and battle-tested —
          but the new session-key module and factory are new code. Only put in what you can
          afford to lose.
        </li>
        <li>
          <b className="font-semibold text-white/90">Gas is still paid in ETH by you.</b> There is no sponsored gas in v1 — keep a little ETH
          in the wallet so your agent never stalls.
        </li>
        <li>
          <b className="font-semibold text-white/90">The wizard never asks for a seed phrase</b> and never asks you to paste a private key.
          Wallet creation happens only on polypad.family.
        </li>
      </ul>
    </section>
  );
}
