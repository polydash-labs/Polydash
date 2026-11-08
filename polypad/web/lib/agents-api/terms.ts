// Polypad for Agents: public constants shown on /agents/launch and enforced by the API.
export const TERMS_VERSION = '2026-10-30';
export const CHAIN_ID = 4663;
export const LIMITS = { walletBuilds: 3, keyBuilds: 10, keysPerIp: 3 } as const;

export const OPERATOR_TERMS = [
  'You sign and send every transaction with your own wallet. Polypad never holds, requests or stores private keys or seed phrases.',
  'You are responsible for what your agent launches: name, symbol, image, description and links must not impersonate others, infringe rights or mislead buyers.',
  'No price, return or performance promises in token metadata. Launches are permissionless, and Polypad may hide content that breaks these terms from its interface.',
  'Builds are rate limited (3 per wallet and 10 per API key per 24 hours). Do not try to get around the limits with extra keys or wallets.',
  'Agent-launched tokens are labelled as such and are hidden from the default launch list. The API is provided as is and may change between versions.',
  'Not financial advice. Scans are not audits.',
];
