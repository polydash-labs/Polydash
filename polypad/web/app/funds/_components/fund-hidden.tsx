export function FundHidden() {
  return (
    <section className="mx-auto max-w-xl px-5 py-24 text-white">
      <p className="text-[12px] uppercase tracking-widest text-white/40">Not live</p>
      <h1 className="mt-3 text-[28px] font-semibold tracking-tight">Funds are not available</h1>
      <p className="mt-4 text-[14px] leading-relaxed text-white/60">
        This route is off. There is no public create, mint, or manager action here.
        The deployed Phase 2 v1 factory is not connected to this site.
        The contracts are unaudited. An outside review is planned. Not financial advice.
      </p>
    </section>
  );
}
