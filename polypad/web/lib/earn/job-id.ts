// Agent-earn job IDs — unpredictable by construction (brief §2.4).
// jobId = keccak256(abi.encodePacked(poster, nonce)) where nonce is 32
// random bytes generated server-side at creation. A sequential or guessable
// jobId would let anyone squat a future jobId with a dust lock — LockExists
// would then block the real poster. The nonce is stored with the job so
// anyone can re-derive the jobId and check it.

import { encodePacked, keccak256, type Address, type Hex } from 'viem';

/** 32 fresh random bytes, hex-encoded. Server-side only. */
export function newJobNonce(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}` as Hex;
}

/** Derive the jobId from a poster address and a nonce. */
export function deriveJobId(poster: Address, nonce: Hex): Hex {
  return keccak256(encodePacked(['address', 'bytes32'], [poster, nonce]));
}

/** A jobId is a 32-byte hash — never a short or sequential value. */
export function isValidJobId(value: string): value is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}
