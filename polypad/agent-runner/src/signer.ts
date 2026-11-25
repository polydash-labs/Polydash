/**
 * EIP-712 signing of trade instructions.
 *
 * Domain and type are exactly the executor's (SPEC.md "AgentExecutor.sol"):
 *   domain: name "PolypadAgentExecutor", version "1", chainId, verifyingContract
 *   type:   Instruction(address vault,address router,address assetIn,address assetOut,
 *           uint256 amountIn,uint256 minAmountOut,bytes data,uint256 deadline,uint256 nonce)
 * with `data` hashed as keccak256(data) by the typed-data encoding.
 *
 * The signature is the authorization: anyone may submit `execute`, but only
 * an instruction signed by the agent key is accepted on-chain.
 */
import type { Address, Hex } from 'viem';
import { recoverTypedDataAddress } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';

export const EIP712_DOMAIN_NAME = 'PolypadAgentExecutor';
export const EIP712_DOMAIN_VERSION = '1';

export interface Instruction {
  vault: Address;
  router: Address;
  assetIn: Address;
  assetOut: Address;
  amountIn: bigint;
  minAmountOut: bigint;
  data: Hex;
  deadline: bigint;
  nonce: bigint;
}

export const INSTRUCTION_TYPES = {
  Instruction: [
    { name: 'vault', type: 'address' },
    { name: 'router', type: 'address' },
    { name: 'assetIn', type: 'address' },
    { name: 'assetOut', type: 'address' },
    { name: 'amountIn', type: 'uint256' },
    { name: 'minAmountOut', type: 'uint256' },
    { name: 'data', type: 'bytes' },
    { name: 'deadline', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

export function getEip712Domain(chainId: number, executorAddress: Address) {
  return {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId,
    verifyingContract: executorAddress,
  } as const;
}

export interface SignInstructionParams {
  account: PrivateKeyAccount;
  chainId: number;
  executorAddress: Address;
  instruction: Instruction;
}

/** Sign an instruction with the agent key. Returns the 65-byte signature. */
export async function signInstruction(params: SignInstructionParams): Promise<Hex> {
  const { account, chainId, executorAddress, instruction } = params;
  return account.signTypedData({
    domain: getEip712Domain(chainId, executorAddress),
    types: INSTRUCTION_TYPES,
    primaryType: 'Instruction',
    message: instruction,
  });
}

/** Recover the signer of an instruction + signature (used by tests / checks). */
export async function recoverInstructionSigner(params: {
  chainId: number;
  executorAddress: Address;
  instruction: Instruction;
  signature: Hex;
}): Promise<Address> {
  return recoverTypedDataAddress({
    domain: getEip712Domain(params.chainId, params.executorAddress),
    types: INSTRUCTION_TYPES,
    primaryType: 'Instruction',
    message: params.instruction,
    signature: params.signature,
  });
}

export interface BuildInstructionParams {
  vault: Address;
  router: Address;
  assetIn: Address;
  assetOut: Address;
  amountIn: bigint;
  minAmountOut: bigint;
  /** Router calldata (opaque to the executor; '0x' for a plain swap). */
  data?: Hex;
  deadline: bigint;
  nonce: bigint;
}

export function buildInstruction(params: BuildInstructionParams): Instruction {
  return {
    vault: params.vault,
    router: params.router,
    assetIn: params.assetIn,
    assetOut: params.assetOut,
    amountIn: params.amountIn,
    minAmountOut: params.minAmountOut,
    data: params.data ?? '0x',
    deadline: params.deadline,
    nonce: params.nonce,
  };
}
