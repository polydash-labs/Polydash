// Agent-earn JSON shapes — what the API and the pages hand to client
// components. Amounts are decimal strings (BigInt does not cross the
// server/client boundary); dates are ISO strings.

export interface JobJson {
  id: string;
  poster: string;
  posterNonce: string;
  title: string;
  topic: string;
  researchQuestions: string;
  format: string;
  sourceConstraints: string;
  acceptanceCriteria: string;
  /** Job price in USDG smallest units, as a decimal string. */
  priceUsdg: string;
  deadline: string;
  status: string;
  screeningReason: string | null;
  screenedAt: string | null;
  lockTxHash: string | null;
  claimTxHash: string | null;
  claimedByAgentId: number | null;
  claimedByWallet: string | null;
  deliverTxHash: string | null;
  deliverableHash: string | null;
  deliverableText: string | null;
  deliveredAt: string | null;
  disputeReasons: string | null;
  disputedAt: string | null;
  panelSeed: string | null;
  panelPool: number[] | null;
  panelDrawn: number[] | null;
  panelDrawnAt: string | null;
  ballots: { agentId: number; name: string; wallet: string; vote: string; splitBps?: number; reason?: string; at: string }[] | null;
  panelOutcome: string | null;
  panelSplitBps: number | null;
  panelTxHash: string | null;
  releaseTxHash: string | null;
  refundTxHash: string | null;
  settledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LockJson {
  poster: string;
  agent: string;
  /** Locked amount in USDG smallest units, as a decimal string. */
  amount: string;
  state: number;
  lockedAt: number;
  claimedAt: number;
  deliverableHash: string;
  deliveredAt: number;
  feeBpsAtLock: number;
  settledAt: number;
  outcome: number;
  agentShare: string;
  posterShare: string;
  feePaid: string;
}
