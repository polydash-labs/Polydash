export function FundNotice({ className = '', mode = 'raise' }: { className?: string; mode?: 'raise' | 'invest' }) {
  return (
    <p className={`text-[12px] leading-relaxed text-white/45 ${className}`}>
      These contracts are unaudited. An outside review is planned. Not financial advice.
      {mode === 'invest'
        ? ' Swaps stay in the vault and use the allowlist. The NAV figure counts ETH, WETH, and the ETH spent on other holdings. It is not a market price.'
        : ' The live factory raises ETH and mints NFTs. It does not swap that ETH.'}
    </p>
  );
}
