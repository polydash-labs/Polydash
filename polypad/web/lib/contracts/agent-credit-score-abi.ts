// ABIs for the Agent Credit Score contracts (deployed Nov 17, 2026, Robinhood Chain).
// AgentRegistry 0x514e352A12F3DB3d4cA649dD328776390e1725eF
// AgentScore    0x1F7ebaAf16aEAa2F519D2Cc69B6091f908C6C92b
// Contracts are unaudited (Slither only).

const agentTuple = {
  name: '',
  type: 'tuple',
  components: [
    { name: 'wallet', type: 'address' },
    { name: 'agentAccount', type: 'address' },
    { name: 'name', type: 'string' },
    { name: 'stake', type: 'uint256' },
    { name: 'registeredAt', type: 'uint64' },
    { name: 'active', type: 'bool' },
  ],
} as const;

const scoreTuple = {
  name: '',
  type: 'tuple',
  components: [
    { name: 'score', type: 'uint16' },
    { name: 'performance', type: 'uint16' },
    { name: 'history', type: 'uint16' },
    { name: 'activity', type: 'uint16' },
    { name: 'stake', type: 'uint16' },
    { name: 'conduct', type: 'uint16' },
    { name: 'updatedAt', type: 'uint64' },
    { name: 'inputsHash', type: 'bytes32' },
    { name: 'exists', type: 'bool' },
  ],
} as const;

export const AgentRegistryABI = [
  { type: 'function', name: 'agentCount', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'agents', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }], outputs: [agentTuple] },
  { type: 'function', name: 'getAgent', stateMutability: 'view', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [agentTuple] },
  { type: 'function', name: 'agentIdByWallet', stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'isRegistered', stateMutability: 'view', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'REGISTRATION_STAKE', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'polydash', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  {
    type: 'function', name: 'registerAgent', stateMutability: 'nonpayable',
    inputs: [{ name: 'name', type: 'string' }, { name: 'wallet', type: 'address' }, { name: 'agentAccount', type: 'address' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
  },
] as const;

export const AgentScoreABI = [
  { type: 'function', name: 'scores', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }], outputs: [scoreTuple] },
  { type: 'function', name: 'getScore', stateMutability: 'view', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [scoreTuple] },
  { type: 'function', name: 'scoreOf', stateMutability: 'view', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ name: '', type: 'uint16' }] },
  { type: 'function', name: 'bandOf', stateMutability: 'view', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ name: '', type: 'uint8' }] },
  { type: 'function', name: 'bandForScore', stateMutability: 'view', inputs: [{ name: 'score', type: 'uint16' }], outputs: [{ name: '', type: 'uint8' }] },
] as const;
