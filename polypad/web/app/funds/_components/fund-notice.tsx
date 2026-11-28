export function FundNotice({ className = '', mode = 'general' }: { className?: string; mode?: 'general' | 'raise' | 'invest' }) {
  return (
    <p className={`text-[13px] leading-relaxed text-white/60 ${className}`}>
      <span className="text-white/70">Unaudited. Not financial advice.</span> These tokenized fund contracts have not had a formal outside review yet. You could lose some or all of the ETH you put in, so only put in what you can afford to lose.
      {mode === 'invest'
        ? ' The manager can only buy tokens from the approved list of tokens the tokenized fund may buy (the allowlist), and the money stays in the tokenized fund\'s vault. Tokenized fund value per share uses live price sources and is left blank when a price cannot be read.'
        : ' A tokenized fund manager decides what the tokenized fund buys, within the rules set when it was created.'}
    </p>
  );
}
