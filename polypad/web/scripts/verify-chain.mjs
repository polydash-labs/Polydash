// Minimal Robinhood Chain definition for the preview verification script
// (mirrors lib/chain.ts — chain 4663, official RPC).
import { defineChain } from 'viem';

export const robinhoodChain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.chain.robinhood.com'] },
  },
  contracts: {
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' },
  },
});
