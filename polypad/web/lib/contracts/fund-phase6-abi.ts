export const FundVaultV2ABI = [
  { type: 'function', name: 'proposeAsset', stateMutability: 'nonpayable', inputs: [{ name: 'asset', type: 'address' }, { name: 'maxPositionBps', type: 'uint256' }, { name: 'reason', type: 'string' }, { name: 'thesisUri', type: 'string' }], outputs: [{ name: 'id', type: 'uint256' }] },
  { type: 'function', name: 'executeAsset', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'cancelProposal', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'executeRemoval', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }], outputs: [] },
  {
    type: 'function', name: 'getProposal', stateMutability: 'view', inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{
      name: '', type: 'tuple', components: [
        { name: 'asset', type: 'address' }, { name: 'maxPositionBps', type: 'uint256' }, { name: 'reason', type: 'string' },
        { name: 'thesisUri', type: 'string' }, { name: 'readyAt', type: 'uint64' }, { name: 'status', type: 'uint8' }, { name: 'kind', type: 'uint8' },
      ],
    }],
  },
  { type: 'function', name: 'proposalCount', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'mandateAssetCount', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'mandateAssets', stateMutability: 'view', inputs: [{ name: 'index', type: 'uint256' }], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'assetCap', stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'tradeCount', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'error', name: 'BadProposal', inputs: [] },
  { type: 'error', name: 'NotPending', inputs: [] },
  { type: 'error', name: 'AlreadyInMandate', inputs: [] },
  { type: 'error', name: 'NotSellable', inputs: [] },
  { type: 'error', name: 'BadUri', inputs: [] },
  { type: 'error', name: 'TooMany', inputs: [] },
  { type: 'error', name: 'NotInMandate', inputs: [] },
  { type: 'error', name: 'NotAllowlisted', inputs: [] },
  { type: 'error', name: 'TooEarly', inputs: [] },
  { type: 'error', name: 'NotManager', inputs: [] },
  { type: 'error', name: 'ZeroAddress', inputs: [] },
  { type: 'error', name: 'NotInvesting', inputs: [] },
  { type: 'error', name: 'BadPair', inputs: [] },
  { type: 'error', name: 'BadValue', inputs: [] },
] as const;

export const FundAllowlistABI = [
  { type: 'function', name: 'assetAllowed', stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'quote', stateMutability: 'view', inputs: [{ name: 'asset', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'proposalCount', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  {
    type: 'function', name: 'proposals', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'target', type: 'address' }, { name: 'isRouter', type: 'bool' }, { name: 'allowed', type: 'bool' }, { name: 'readyAt', type: 'uint64' },
      { name: 'executed', type: 'bool' }, { name: 'canceled', type: 'bool' }, { name: 'feed', type: 'address' }, { name: 'maxStale', type: 'uint64' },
      { name: 'minPriceX18', type: 'uint256' }, { name: 'maxPriceX18', type: 'uint256' },
    ],
  },
] as const;

export const Erc20MiniABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
] as const;
