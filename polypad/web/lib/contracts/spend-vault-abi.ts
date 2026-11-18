// ABI for PolypadSpendVault (deployed Nov 17, 2026, Robinhood Chain).
// PolypadSpendVault 0xDb5544a977b0dF881268746F2C47F049da579486
// Owner 0x9a21c75aC263cC43125E70200636f6397f8776d0; facilitator set to the
// x402 facilitator wallet. Sourcify exact_match (creation + runtime).
// Contract is unaudited (Slither only).
import { parseAbi } from 'viem';

export const SpendVaultABI = parseAbi([
  'function deposit(address token, uint256 amount)',
  'function withdraw(address token, uint256 amount)',
  'function createKey(address key, address token, uint256 perPaymentCap, uint256 dailyCap, address[] allowlist, uint64 expiry)',
  'function revokeKey(address key)',
  'function balances(address owner, address token) view returns (uint256)',
  'function keys(address key) view returns (address owner, address token, uint256 perPaymentCap, uint256 dailyCap, uint64 expiry, bool revoked, uint64 spentDay, uint256 spentToday, uint256 allowlistCount)',
  'function keyAllowlist(address key, address payee) view returns (bool)',
  'function paused() view returns (bool)',
  'function facilitator() view returns (address)',
  'function owner() view returns (address)',
  'event Deposited(address indexed owner, address indexed token, uint256 amount)',
  'event Withdrawn(address indexed owner, address indexed token, uint256 amount)',
  'event KeyCreated(address indexed owner, address indexed key, address indexed token, uint256 perPaymentCap, uint256 dailyCap, uint64 expiry)',
  'event KeyRevoked(address indexed owner, address indexed key)',
  'event Spent(address indexed key, address indexed token, address indexed to, uint256 value, bytes32 nonce)',
]);

/** Block the vault was deployed in (tx 0x7cbdb09a…). Key scans start here. */
export const SPEND_VAULT_DEPLOY_BLOCK = 117097726n;
