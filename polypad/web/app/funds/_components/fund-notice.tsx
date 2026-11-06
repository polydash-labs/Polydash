export function FundNotice({ className = '' }: { className?: string }) {
  return (
    <p className={`text-[12px] leading-relaxed text-white/45 ${className}`}>
      These contracts are unaudited. An outside review is planned. Not financial advice.
      A fund raises ETH and mints NFTs. This phase does not invest the ETH.
    </p>
  );
}
