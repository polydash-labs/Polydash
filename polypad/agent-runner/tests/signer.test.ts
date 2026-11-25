/**
 * EIP-712 signing tests (node:test + tsx).
 *
 * The signature must be one the on-chain AgentExecutor would accept: same
 * domain (name "PolypadAgentExecutor", version "1"), same Instruction type,
 * and recoverable to the agent key. The test key below is a fixed, obviously
 * fake key (0x11 repeated) — a test key only, never a real key.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import {
  buildInstruction,
  getEip712Domain,
  recoverInstructionSigner,
  signInstruction,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  type Instruction,
} from '../src/signer.js';

const TEST_PRIVATE_KEY = ('0x' + '11'.repeat(32)) as `0x${string}`;
const TEST_ADDRESS = privateKeyToAccount(TEST_PRIVATE_KEY).address;
const EXECUTOR = '0x1111111111111111111111111111111111111111' as const;
const VAULT = '0x2222222222222222222222222222222222222222' as const;
const ROUTER = '0x3333333333333333333333333333333333333333' as const;
const WETH = '0x4444444444444444444444444444444444444444' as const;
const ASSET = '0x5555555555555555555555555555555555555555' as const;
const CHAIN_ID = 4663;

function testInstruction(overrides: Partial<Instruction> = {}): Instruction {
  return buildInstruction({
    vault: VAULT,
    router: ROUTER,
    assetIn: WETH,
    assetOut: ASSET,
    amountIn: 1_000_000_000_000_000_000n,
    minAmountOut: 990_000_000_000_000_000n,
    data: '0x',
    deadline: 1_800_000_600n,
    nonce: 0n,
    ...overrides,
  });
}

describe('EIP-712 domain', () => {
  it('uses the spec domain name and version', () => {
    assert.equal(EIP712_DOMAIN_NAME, 'PolypadAgentExecutor');
    assert.equal(EIP712_DOMAIN_VERSION, '1');
    const domain = getEip712Domain(CHAIN_ID, EXECUTOR);
    assert.equal(domain.name, 'PolypadAgentExecutor');
    assert.equal(domain.version, '1');
    assert.equal(domain.chainId, CHAIN_ID);
    assert.equal(domain.verifyingContract, EXECUTOR);
  });
});

describe('signInstruction', () => {
  it('produces a 65-byte signature that recovers to the agent key', async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    assert.equal(account.address, TEST_ADDRESS);
    const ix = testInstruction();
    const signature = await signInstruction({
      account,
      chainId: CHAIN_ID,
      executorAddress: EXECUTOR,
      instruction: ix,
    });
    assert.equal(signature.length, 132); // 0x + 65 bytes hex
    const recovered = await recoverInstructionSigner({
      chainId: CHAIN_ID,
      executorAddress: EXECUTOR,
      instruction: ix,
      signature,
    });
    assert.equal(recovered, TEST_ADDRESS);
  });

  it('a tampered instruction does not recover to the agent key', async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const ix = testInstruction();
    const signature = await signInstruction({
      account,
      chainId: CHAIN_ID,
      executorAddress: EXECUTOR,
      instruction: ix,
    });
    const recovered = await recoverInstructionSigner({
      chainId: CHAIN_ID,
      executorAddress: EXECUTOR,
      instruction: testInstruction({ amountIn: 2_000_000_000_000_000_000n }),
      signature,
    });
    assert.notEqual(recovered, TEST_ADDRESS);
  });

  it('the nonce is part of the signed data', async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const sig0 = await signInstruction({
      account,
      chainId: CHAIN_ID,
      executorAddress: EXECUTOR,
      instruction: testInstruction({ nonce: 0n }),
    });
    const sig1 = await signInstruction({
      account,
      chainId: CHAIN_ID,
      executorAddress: EXECUTOR,
      instruction: testInstruction({ nonce: 1n }),
    });
    assert.notEqual(sig0, sig1);
  });

  it('signing is deterministic for the same instruction', async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const ix = testInstruction();
    const a = await signInstruction({ account, chainId: CHAIN_ID, executorAddress: EXECUTOR, instruction: ix });
    const b = await signInstruction({ account, chainId: CHAIN_ID, executorAddress: EXECUTOR, instruction: ix });
    assert.equal(a, b);
  });
});

describe('buildInstruction', () => {
  it('defaults router calldata to empty', () => {
    const ix = testInstruction();
    assert.equal(ix.data, '0x');
    assert.equal(ix.vault, VAULT);
    assert.equal(ix.nonce, 0n);
  });
});
