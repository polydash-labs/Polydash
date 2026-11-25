const KEY = {
  name: 'key', type: 'tuple', components: [
    { name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' },
    { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' },
  ],
} as const;
const fn = (name: string, inputs: readonly { name: string; type: string }[], outputs: readonly { name: string; type: string }[] = [], view = false) =>
  ({ type: 'function', name, inputs, outputs, stateMutability: view ? 'view' : 'nonpayable' }) as const;

export const FundVaultV3ABI = [
  { type: 'function', name: 'proposeLiquidity', stateMutability: 'nonpayable', inputs: [KEY, { name: 'tickLower', type: 'int24' }, { name: 'tickUpper', type: 'int24' }, { name: 'maxLpBps', type: 'uint256' }, { name: 'reason', type: 'string' }, { name: 'thesisUri', type: 'string' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'addLiquidity', stateMutability: 'nonpayable', inputs: [KEY, { name: 'tickLower', type: 'int24' }, { name: 'tickUpper', type: 'int24' }, { name: 'liquidity', type: 'uint256' }, { name: 'amount0Max', type: 'uint256' }, { name: 'amount1Max', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'removeLiquidity', stateMutability: 'nonpayable', inputs: [KEY, { name: 'liquidity', type: 'uint256' }, { name: 'amount0Min', type: 'uint256' }, { name: 'amount1Min', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'harvestFees', stateMutability: 'nonpayable', inputs: [KEY], outputs: [{ name: '', type: 'uint256' }, { name: '', type: 'uint256' }] },
  fn('executeLiquidity', [{ name: 'id', type: 'uint256' }]),
  fn('cancelLiquidityProposal', [{ name: 'id', type: 'uint256' }]),
  fn('stake', [{ name: 'pool', type: 'address' }, { name: 'amount', type: 'uint256' }]),
  fn('unstakeAll', [{ name: 'pool', type: 'address' }]),
  fn('claimRewards', [{ name: 'pool', type: 'address' }, { name: 'maxGross', type: 'uint256' }]),
  fn('lpProposalCount', [], [{ name: '', type: 'uint256' }], true),
  {
    type: 'function', name: 'lpProposals', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }],
    outputs: [KEY, { name: 'tickLower', type: 'int24' }, { name: 'tickUpper', type: 'int24' }, { name: 'maxLpBps', type: 'uint256' }, { name: 'reason', type: 'string' }, { name: 'thesisUri', type: 'string' }, { name: 'readyAt', type: 'uint64' }, { name: 'status', type: 'uint8' }],
  },
  fn('lpPoolCount', [], [{ name: '', type: 'uint256' }], true),
  fn('lpPoolIds', [{ name: 'offset', type: 'uint256' }, { name: 'limit', type: 'uint256' }], [{ name: '', type: 'bytes32[]' }], true),
  fn('lpPositions', [{ name: '', type: 'bytes32' }], [
    { name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' },
    { name: 'tickLower', type: 'int24' }, { name: 'tickUpper', type: 'int24' }, { name: 'liquidity', type: 'uint256' }, { name: 'amount0', type: 'uint256' }, { name: 'amount1', type: 'uint256' },
    { name: 'feesHarvested0', type: 'uint256' }, { name: 'feesHarvested1', type: 'uint256' }, { name: 'lastHarvestAt', type: 'uint64' }, { name: 'active', type: 'bool' },
  ], true),
  fn('lpValue', [], [{ name: '', type: 'uint256' }], true),
  fn('stakedPools', [], [{ name: '', type: 'address[]' }], true),
  fn('stakedAmount', [{ name: 'pool', type: 'address' }], [{ name: '', type: 'uint256' }], true),
  fn('stakedValueEth', [{ name: 'pool', type: 'address' }], [{ name: '', type: 'uint256' }], true),
  fn('earnedRewards', [{ name: 'pool', type: 'address' }], [{ name: '', type: 'uint256' }], true),
] as const;
