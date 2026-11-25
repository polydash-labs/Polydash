// Shape of a launch as shown in the UI, built from on-chain reads.
// phase follows the contract enum: 0 Uninitialized, 1 Pending (commit), 2 ProcessingCommitments, 3 Trading, 4 Graduated
export interface LaunchToken {
  launchAddress: string;
  tokenAddress: string;
  name: string;
  symbol: string;
  imageUri: string;
  description: string;
  creator: string;
  creatorFeeBps: number;
  curveProgress: number; // 0-100
  marketCapUsd: number;
  /** null when trade logs could not be read (unknown, shown as an em dash). */
  volumeUsd: number | null;
  priceEth: number;
  ethRaised: number;
  graduationThreshold: number;
  graduated: boolean;
  totalSupply: string;
  socialLinks: string[];
  createdAt: number;
  phase: number;
  launchTime: number; // ms; trading opens at/after this time (commit window ends)
  totalCommitted: number; // ETH currently committed (pending / unprocessed)
  committers: number;
  commitmentCursor: number;
  // raw curve params (wei) for charting
  virtualEthWei: string;
  curveSupplyWei: string;
  tokensSoldWei: string;
  kWei: string;
}

export const PHASE = { Uninitialized: 0, Pending: 1, Processing: 2, Trading: 3, Graduated: 4 } as const;
