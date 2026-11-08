import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { agentIndexBody, POLYPAD_FACTORY } from '../agent-launch';
import { PolydashLaunchABI } from '../contracts/abis';
import { CHAIN_ID, LIMITS, OPERATOR_TERMS, TERMS_VERSION } from './terms';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Quote, tx, spec, key, and task routes from the live export import modules that
// are not in the export and have no equivalent here. They stay out of this tree.

test('terms constants match the live export and do not promise returns', () => {
  assert.equal(TERMS_VERSION, '2026-10-30');
  assert.equal(CHAIN_ID, 4663);
  assert.deepEqual(LIMITS, { walletBuilds: 3, keyBuilds: 10, keysPerIp: 3 });
  const text = OPERATOR_TERMS.join('\n');
  assert.match(text, /never holds, requests or stores private keys or seed phrases/);
  assert.match(text, /No price, return or performance promises/);
  assert.match(text, /Scans are not audits/);
  assert.equal(/guaranteed|audited/i.test(text), false);
});

test('launch ABI fragment includes payout and creator-fee entries and still quotes', () => {
  const names = new Set<string>(PolydashLaunchABI.map((entry) => entry.name));
  for (const name of [
    'pendingPayoutWallet',
    'payoutWalletChangeAt',
    'PAYOUT_WALLET_DELAY',
    'hook',
    'poolId',
    'initiatePayoutWalletChange',
    'cancelPayoutWalletChange',
    'executePayoutWalletChange',
    'claimCreatorFees',
    'PayoutWalletChangeInitiated',
    'PayoutWalletChangeCancelled',
    'PayoutWalletChanged',
    'OnlyCreator',
    'TooEarly',
    'NoPendingChange',
    'NothingToClaim',
    'quoteBuy',
    'quoteSell',
    'factory',
  ]) {
    assert.equal(names.has(name), true, name);
  }
  const claim = PolydashLaunchABI.find((entry) => entry.name === 'claimCreatorFees');
  assert.equal(claim?.type, 'function');
  assert.equal(claim?.stateMutability, 'nonpayable');
  assert.deepEqual(claim?.inputs, []);
});

test('discovery lists only the handlers this tree serves', () => {
  const body = agentIndexBody(POLYPAD_FACTORY, 4663);
  const endpoints = body.endpoints as Record<string, { method: string; path: string }>;
  assert.deepEqual(
    Object.entries(endpoints)
      .map(([name, endpoint]) => [name, endpoint.method, endpoint.path])
      .sort(),
    [
      ['marks', 'GET', '/api/agents/v1/marks'],
      ['simulate', 'POST', '/api/agents/v1/simulate'],
      ['validate', 'POST', '/api/agents/v1/validate'],
    ],
  );
});

test('blocked live-export routes and their missing modules are not in this tree', () => {
  const absent = [
    'app/api/agents/v1/quote/route.ts',
    'app/api/agents/v1/tokens/route.ts',
    'app/api/agents/v1/spec/route.ts',
    'app/api/agents/v1/tx/[action]/route.ts',
    'app/api/agents/v1/keys/route.ts',
    'app/api/agents/v1/metadata/route.ts',
    'app/api/agents/v1/launch/build/route.ts',
    'app/api/agents/v1/token/[address]/route.ts',
    'app/api/agents/v1/buyback-tasks/route.ts',
    'app/api/agents/v1/treasury-tasks/route.ts',
    'app/api/agents/v1/floor-vault-tasks/route.ts',
    'app/api/agents/v1/slice-tasks/route.ts',
    'lib/agents-api/core.ts',
    'lib/agents-api/trade.ts',
    'lib/db.ts',
    'lib/sanitize.ts',
    'lib/launches-server.ts',
    'lib/holder-protections.ts',
    'lib/buyback-server.ts',
    'lib/treasury-server.ts',
    'lib/treasury.ts',
    'lib/floor-vault-server.ts',
    'lib/floorVault.ts',
    'lib/slice-server.ts',
    'prisma/schema.prisma',
  ];
  for (const rel of absent) assert.equal(existsSync(path.join(webRoot, rel)), false, rel);
  assert.equal(existsSync(path.join(webRoot, 'lib/chain.ts')), true);
  assert.equal(existsSync(path.join(webRoot, 'lib/token-types.ts')), true);
  assert.equal(existsSync(path.join(webRoot, 'lib/s3.ts')), true);
  assert.equal(existsSync(path.join(webRoot, 'lib/contracts/addresses.ts')), true);
});
