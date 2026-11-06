export function FundNotice({ className = '', mode = 'raise' }: { className?: string; mode?: 'raise' | 'invest' }) {
  return (
    <p className={`text-[12px] leading-relaxed text-white/45 ${className}`}>
      These contracts are unaudited. An outside review is planned. Not financial advice.
      {mode === 'invest'
        ? ' Swaps stay in the vault and use the allowlist. NAV uses a feed for assets other than ETH and WETH. It is blank when that feed cannot be used. Cost basis is not the NAV.'
        : ' The live factory raises ETH and mints NFTs. It does not swap that ETH.'}
    </p>
  );
}
