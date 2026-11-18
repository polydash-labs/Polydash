// Strategy #6–#9 (Polydash LP-Dividend) on the V3 tokenized fund factory. Robinhood Chain 4663.
export const FUND_FACTORY_V3 = '0xb5251bac3cfe2a057b7703d4477bf80f10b8154b' as const;
export const FUND_LIQUIDITY_FACET = '0x3e9f80aafbd59bd60368349d873615156108720f' as const;
export const FUND_STAKE_FACET = '0x023a50cd42532b518d5937c08c68ae25f2f6bb81' as const;

export const V3_TEMPLATE_IDS = [6, 7, 8, 9] as const;
export function isLpTemplate(id: number | null | undefined): boolean {
  return id != null && (V3_TEMPLATE_IDS as readonly number[]).includes(id);
}
/** LP-Dividend performance-fee choice: same strategy, one strategy id per fee. 5% (Strategy #6) is the default. */
export const LP_FEE_OPTIONS = [
  { feeBps: 0, templateId: 7 },
  { feeBps: 500, templateId: 6 },
  { feeBps: 1000, templateId: 8 },
  { feeBps: 2000, templateId: 9 },
] as const;
export const LP_DEFAULT_TEMPLATE_ID = 6;
export const LP_NAME = 'Polydash LP-Dividend Tokenized Fund';
export const LP_SUMMARY = 'The tokenized fund buys POLYDASH, adds POLYDASH/WETH liquidity, and earns trading fees that are paid out as dividends, plus staking rewards for share (NFT) holders.';

export function lpLines(feeBps: number): string[] {
  return [
    'Buys POLYDASH only',
    'Can add POLYDASH/WETH liquidity to earn trading fees (LP yield), at most 50% of the tokenized fund per pool',
    'Can stake POLYDASH in staking pools to earn rewards',
    'At most 80% of the tokenized fund in POLYDASH, at most 10% per trade',
    feeBps ? `${feeBps / 100}% performance fee on new gains only` : 'No performance fee (0%)',
    'New buys pause after a 20% drop (drawdown brake)',
    'Manager shares locked 30 days (skin lock)',
  ];
}

/** Plain-language summary of the Strategy #6 write-up (mandate) shown on fund pages. */
export const LP_MANDATE_LINES = [
  'Pair: POLYDASH/WETH on Uniswap V4.',
  'Trading fees in this pool are thin today: about $1.58 per week in total pool fees, shared by every liquidity provider.',
  'Upside case, never a promise: a higher price could bring more interest, more trading volume and more fees. It may not happen.',
  'No guaranteed returns. The value can go down.',
  'Harvested fees stay in the vault until the manager pays them out as a dividend; holders then claim them.',
  'When you exit, you are paid from liquid holdings only. Money in liquidity or staking is paid out only after the manager removes or unstakes it.',
  'Every new liquidity position waits 2 days in public before the manager can add it.',
];

/** Full Strategy #6 rules shown on the page while the IPFS file is not served by any gateway. Site copy, not the on-chain file. */
export const LP_MANDATE_TEXT = `Polydash LP-Dividend Tokenized Fund — Strategy #6 rules

1. What the tokenized fund holds
- The tokenized fund buys POLYDASH with the ETH investors put in.
- At most 80% of the tokenized fund may be in POLYDASH (per-asset cap). At most 10% of the tokenized fund may move in one trade (per-trade cap).
- Only tokens on the approved list (the allowlist) can ever be bought.

2. Liquidity (LP)
- Pair: POLYDASH/WETH on Uniswap V4.
- At most 50% of the tokenized fund may sit in liquidity for one pool (LP cap).
- Every new liquidity position is published first and waits 2 days in public before the manager can add it. Anyone can see it during the wait.

3. Staking
- The manager may stake POLYDASH in Polypad staking pools to earn staking rewards.

4. Fees earned and dividends
- Trading fees harvested from the liquidity position stay in the vault until the manager pays them out as a dividend. Holders then claim their part.
- Trading fees in this pool are thin today (about $1.58 per week in total pool fees, shared by every liquidity provider).

5. Protections
- New buys pause after a 20% drop from the peak value per share (drawdown brake). Selling still works.
- The manager's own shares are locked for 30 days (skin lock).
- Strategy #6 charges a 5% performance fee, only on new gains above the high-water mark. There is no management fee.

6. Exits
- When you exit, you are paid from liquid holdings only. Money in liquidity or staking is paid out only after the manager removes or unstakes it.

7. Risks
- No guaranteed returns. The value can go down, and you can lose money.
- A higher POLYDASH price could bring more trading volume and more fees. That is an upside case, never a promise.
- The contracts are not audited. This is not financial advice.`;

export const LP_MANDATE_URIS: Record<number, string> = {
  6: 'ipfs://bafybeidjlmuy5afm6beolwuzivgmtsz7k6qzy57c5wfftn3rlu56sm2fxa',
  7: 'ipfs://bafybeicwcd5cu2thnc2uagibx5dqpa7eauuoc63ijyajyxfvo36oxxknze',
  8: 'ipfs://bafybeih5g5fv3xl77tsl3veasr655gnvsyzltvhrmwymg2shh4wer6xuua',
  9: 'ipfs://bafybeiet2eihlujjfqdexc32q4j6whlgu2ew5vcoozsmrwceuclz5ayzfu',
};

export const OPTIN_COPY = {
  lp: 'Earn trading fees by adding POLYDASH/WETH liquidity (optional)',
  stake: 'Stake POLYDASH in staking pools for rewards (optional)',
  note: 'These are your plans, shown on your page preview. They are not stored on-chain: the tokenized fund can do both, and you decide later whether to use them.',
};

/** POLYDASH/WETH Uniswap V4 pool key. */
export const POLYDASH_WETH_KEY = {
  currency0: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  currency1: '0x319525528f42167eF7fC18b77b889958080568e4',
  fee: 8388608,
  tickSpacing: 200,
  hooks: '0x48B8F6AD3A1b4aA477314c9a23035b8F84dDe8cc',
} as const;
export const TICK_SPACING = 200;
export function snapTick(t: number): number {
  return Math.round(t / TICK_SPACING) * TICK_SPACING;
}
