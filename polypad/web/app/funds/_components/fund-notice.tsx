export function FundNotice({ className = '', mode = 'raise' }: { className?: string; mode?: 'raise' | 'invest' }) {
  return (
    <p className={`text-[12px] leading-relaxed text-white/45 ${className}`}>
      Unaudited. Not financial advice. These fund contracts have not had a formal outside review yet. You could lose some or all of the ETH you put in, so only put in what you can afford to lose.
      {mode === 'invest'
        ? ' The manager can only buy tokens from the approved list of tokens the fund may buy (the allowlist), and the money stays in the fund\u2019s vault. Fund value per share (NAV, net asset value) uses live price sources and is left blank when a price cannot be read.'
        : ' A fund manager decides what the fund buys, within the rules set when the fund was created.'}
    </p>
  );
}
