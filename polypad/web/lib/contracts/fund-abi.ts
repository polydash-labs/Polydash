// Subset of the FundFactory / FundNFT / FundVault ABI used by the fund pages.
// Full compiler ABIs live in polypad/abi. This file is fund-only.

export const FundFactoryABI = [
  {
    type: 'function',
    name: 'allFunds',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'allFundsLength',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'isFund',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'previewSupply',
    stateMutability: 'pure',
    inputs: [
      { name: 'raiseCap', type: 'uint256' },
      { name: 'mintPrice', type: 'uint256' },
    ],
    outputs: [
      { name: 'maxSupply', type: 'uint256' },
      { name: 'dust', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'createFund',
    stateMutability: 'nonpayable',
    inputs: [{
      name: 'p',
      type: 'tuple',
      components: [
        { name: 'name', type: 'string' },
        { name: 'symbol', type: 'string' },
        { name: 'imageUri', type: 'string' },
        { name: 'baseURI', type: 'string' },
        { name: 'mintPrice', type: 'uint256' },
        { name: 'raiseCap', type: 'uint256' },
        { name: 'entryFeeBps', type: 'uint256' },
        { name: 'minSkinBps', type: 'uint256' },
      ],
    }],
    outputs: [{ name: 'fund', type: 'address' }],
  },
  {
    type: 'event',
    name: 'FundCreated',
    inputs: [
      { name: 'fund', type: 'address', indexed: true },
      { name: 'vault', type: 'address', indexed: true },
      { name: 'manager', type: 'address', indexed: true },
      { name: 'mintPrice', type: 'uint256', indexed: false },
      { name: 'raiseCap', type: 'uint256', indexed: false },
      { name: 'maxSupply', type: 'uint256', indexed: false },
      { name: 'entryFeeBps', type: 'uint256', indexed: false },
      { name: 'minSkinBps', type: 'uint256', indexed: false },
      { name: 'skinRequired', type: 'uint256', indexed: false },
    ],
  },
  { type: 'error', name: 'InvalidParams', inputs: [] },
  { type: 'error', name: 'NotOwner', inputs: [] },
] as const;

export const FundNFTABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
  { type: 'function', name: 'imageUri', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
  { type: 'function', name: 'manager', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'vault', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'mintPrice', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'maxSupply', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'totalMinted', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'managerMinted', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'publicOpen', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'entryFeeBps', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'skinRequired', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'minSkinBps', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'payable',
    inputs: [{ name: 'qty', type: 'uint256' }],
    outputs: [],
  },
  { type: 'error', name: 'NotRaising', inputs: [] },
  { type: 'error', name: 'SkinRequired', inputs: [] },
  { type: 'error', name: 'BadQuantity', inputs: [] },
  { type: 'error', name: 'BadValue', inputs: [] },
  { type: 'error', name: 'SoldOut', inputs: [] },
] as const;

export const FundVaultABI = [
  { type: 'function', name: 'raiseCap', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'raised', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'status', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
] as const;
