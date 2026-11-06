import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeErrorResult, encodeFunctionResult, zeroAddress, type Hex } from 'viem';
import { createRateLimiter } from './logo-upload';
import { AGENT_LAUNCH_MARK } from './agent-mark';
import {
  AGENT_RATE_LIMIT,
  AGENT_RATE_WINDOW_MS,
  CREATE_LAUNCH_ABI,
  MAX_CREATOR_FEE_BPS,
  MAX_LAUNCH_DELAY_SECONDS,
  MAX_TOTAL_SUPPLY_WEI,
  MIN_TOTAL_SUPPLY_WEI,
  MIN_VIRTUAL_ETH_WEI,
  POLYPAD_CHAIN_NAME,
  POLYPAD_FACTORY,
  agentIndexBody,
  clearAgentLaunchLog,
  decodeCreateLaunch,
  decodeRevert,
  encodeCreateLaunch,
  handleAgentMarks,
  handleAgentSimulate,
  handleAgentValidate,
  listAgentLaunches,
  validateLaunchBody,
  type EthCallOutcome,
  type EthCallRequest,
} from './agent-launch';

const SIGNER = '0x1111111111111111111111111111111111111111';
const LAUNCH = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x3333333333333333333333333333333333333333';
const ONE_TOKEN = 10n ** 18n;

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    from: SIGNER,
    name: 'Example',
    symbol: 'EXM',
    imageUri: 'https://example.com/logo.png',
    description: 'Example token',
    socialLinks: ['https://example.com'],
    creatorFeeBps: 100,
    devBuyEth: '0',
    totalSupply: '0',
    virtualEthReserve: '0',
    launchDelay: '0',
    ...overrides,
  };
}

function request(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://polypad.family${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function successCall(calls: EthCallRequest[]): (req: EthCallRequest) => Promise<EthCallOutcome> {
  return async (req) => {
    calls.push(req);
    return {
      ok: true,
      gas: 1_200_000n,
      data: encodeFunctionResult({
        abi: CREATE_LAUNCH_ABI,
        functionName: 'createLaunch',
        result: [LAUNCH, TOKEN],
      }),
    };
  };
}

test('discovery document names Robinhood Chain, the factory, and the non-custodial API', () => {
  const body = agentIndexBody(POLYPAD_FACTORY, 4663);
  assert.equal(body.chain, POLYPAD_CHAIN_NAME);
  assert.equal(body.factory, POLYPAD_FACTORY);
  assert.equal(body.custody, 'non-custodial');
  assert.equal((body.rateLimit as { limit: number }).limit, AGENT_RATE_LIMIT);
  assert.equal(AGENT_RATE_WINDOW_MS, 600000);
  assert.equal(MAX_CREATOR_FEE_BPS, 500);
  assert.equal(MAX_LAUNCH_DELAY_SECONDS, 2592000);
  assert.equal(MIN_TOTAL_SUPPLY_WEI, 1_000_000n * ONE_TOKEN);
  assert.equal(MAX_TOTAL_SUPPLY_WEI, 1_000_000_000_000n * ONE_TOKEN);
  assert.equal(MIN_VIRTUAL_ETH_WEI, 10n ** 16n);
});

test('validation accepts factory bounds and stores the agent mark once', () => {
  const ok = validateLaunchBody(validBody({
    creatorFeeBps: '500',
    totalSupply: MIN_TOTAL_SUPPLY_WEI.toString(),
    virtualEthReserve: MIN_VIRTUAL_ETH_WEI.toString(),
    launchDelay: String(MAX_LAUNCH_DELAY_SECONDS),
    repository: 'https://github.com/polydash-labs/Polydash.git',
    socialLinks: ['https://example.com', AGENT_LAUNCH_MARK],
  }), { requireFrom: true });
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.equal(ok.value.creatorFeeBps, 500);
  assert.equal(ok.value.totalSupply, MIN_TOTAL_SUPPLY_WEI);
  assert.equal(ok.value.repository, 'https://github.com/polydash-labs/Polydash');
  assert.equal(ok.value.socialLinks.filter((link) => link === AGENT_LAUNCH_MARK).length, 1);
  assert.equal(ok.value.socialLinks.at(-1), AGENT_LAUNCH_MARK);
  assert.ok(ok.value.socialLinks.includes('https://github.com/polydash-labs/Polydash'));
  assert.equal(ok.value.creatorPayoutWallet, zeroAddress);
});

test('validation reports each broken field and does not default the creator fee', () => {
  const broken = validateLaunchBody({
    name: ' ',
    symbol: '',
    imageUri: 'http://example.com/logo.png',
    socialLinks: Array.from({ length: 11 }, (_, i) => `https://example.com/${i}`),
    creatorFeeBps: 501,
    devBuyEth: '1.5',
    totalSupply: '1',
    virtualEthReserve: (MIN_VIRTUAL_ETH_WEI - 1n).toString(),
    launchDelay: String(MAX_LAUNCH_DELAY_SECONDS + 1),
    repository: 'https://github.com/only-owner',
    from: zeroAddress,
    creatorPayoutWallet: 'not-an-address',
  }, { requireFrom: true });
  assert.equal(broken.ok, false);
  if (broken.ok) return;
  for (const field of ['name', 'symbol', 'imageUri', 'socialLinks', 'creatorFeeBps', 'devBuyEth', 'totalSupply', 'virtualEthReserve', 'launchDelay', 'repository', 'from', 'creatorPayoutWallet']) {
    assert.equal(typeof broken.fields[field], 'string', field);
  }

  const missingFee = validateLaunchBody(validBody({ creatorFeeBps: undefined }), { requireFrom: false });
  assert.equal(missingFee.ok, false);
  if (!missingFee.ok) assert.match(missingFee.fields.creatorFeeBps, /Required/);
});

test('agentMark false leaves the mark off, and a full list cannot grow', () => {
  const off = validateLaunchBody(validBody({ agentMark: false, socialLinks: [] }), { requireFrom: false });
  assert.equal(off.ok, true);
  if (off.ok) {
    assert.equal(off.value.agentLaunched, false);
    assert.deepEqual(off.value.socialLinks, []);
  }

  const full = validateLaunchBody(validBody({
    socialLinks: Array.from({ length: 10 }, (_, i) => `https://example.com/${i}`),
  }), { requireFrom: false });
  assert.equal(full.ok, false);
  if (!full.ok) assert.match(full.fields.socialLinks, /10/);
});

test('prepared calldata decodes as createLaunch and value equals devBuyEth', () => {
  const validated = validateLaunchBody(validBody({ devBuyEth: '1000' }), { requireFrom: true });
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  const data = encodeCreateLaunch(validated.value);
  const decoded = decodeCreateLaunch(data);
  assert.equal(decoded.functionName, 'createLaunch');
  const params = decoded.args[0];
  assert.equal(params.name, 'Example');
  assert.equal(params.devBuyEth, 1000n);
  assert.equal(params.creatorFeeBps, 100n);
  assert.ok(params.socialLinks.includes(AGENT_LAUNCH_MARK));
});

test('validate route returns field errors and does not call the RPC', async () => {
  let called = false;
  const result = await handleAgentValidate(request('/api/agents/v1/validate', { name: 'Example' }), {
    limiter: createRateLimiter(5, 60_000),
    ethCall: async () => {
      called = true;
      return { ok: false, kind: 'rpc' };
    },
  });
  assert.equal(result.status, 400);
  assert.equal((result.body.error as { code: string }).code, 'INVALID_PARAMS');
  assert.equal(called, false);
});

test('simulate returns an unsigned transaction and the eth_call addresses', async () => {
  clearAgentLaunchLog();
  const calls: EthCallRequest[] = [];
  const result = await handleAgentSimulate(
    request('/api/agents/v1/simulate', validBody({ devBuyEth: '5' }), { 'x-polypad-client': 'bankr' }),
    {
      limiter: createRateLimiter(5, 60_000),
      ethCall: successCall(calls),
      factory: POLYPAD_FACTORY,
      chainId: 4663,
      now: () => 1_700_000_000_000,
      randomId: () => 'req-1',
    },
  );
  assert.equal(result.status, 200);
  const tx = result.body.unsignedTx as { to: string; data: Hex; value: string; chainId: number; from: string };
  assert.equal(tx.to, POLYPAD_FACTORY);
  assert.equal(tx.value, '5');
  assert.equal(tx.value === tx.from, false);
  assert.equal(tx.chainId, 4663);
  assert.equal(tx.from, SIGNER);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].data, tx.data);
  assert.equal(calls[0].value, 5n);
  const simulation = result.body.simulation as { success: boolean; launch: string; token: string; gas: string };
  assert.equal(simulation.success, true);
  assert.equal(simulation.launch, LAUNCH);
  assert.equal(simulation.token, TOKEN);
  assert.equal(simulation.gas, '1200000');
  assert.equal(result.body.requestId, 'req-1');
  assert.match(JSON.stringify(result.body), /does not accept private keys/);
  const marks = listAgentLaunches(SIGNER);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].client, 'bankr');
  assert.equal(marks[0].symbol, 'EXM');
});

test('a reverted eth_call still returns the unsigned transaction', async () => {
  const data = encodeErrorResult({ abi: CREATE_LAUNCH_ABI, errorName: 'InvalidParams' });
  const result = await handleAgentSimulate(request('/api/agents/v1/simulate', validBody()), {
    limiter: createRateLimiter(5, 60_000),
    ethCall: async () => ({ ok: false, kind: 'revert', data }),
  });
  assert.equal(result.status, 422);
  assert.equal((result.body.error as { code: string; revert: string }).code, 'SIMULATION_REVERTED');
  assert.equal((result.body.error as { revert: string }).revert, 'InvalidParams');
  assert.equal(decodeRevert(data), 'InvalidParams');
  assert.equal(typeof (result.body.unsignedTx as { data: string }).data, 'string');
});

test('an unreachable RPC returns the unsigned transaction with 503', async () => {
  const result = await handleAgentSimulate(request('/api/agents/v1/simulate', validBody()), {
    limiter: createRateLimiter(5, 60_000),
    ethCall: async () => {
      throw new Error('socket hang up');
    },
  });
  assert.equal(result.status, 503);
  assert.equal((result.body.error as { code: string }).code, 'RPC_UNAVAILABLE');
  assert.equal(typeof (result.body.unsignedTx as { data: string }).data, 'string');
});

test('key material is rejected and the value is not copied into the response', async () => {
  const secret = 'rejected-on-purpose';
  const keyName = ['private', 'Key'].join('');
  const result = await handleAgentValidate(request('/api/agents/v1/validate', { ...validBody(), [keyName]: secret }), {
    limiter: createRateLimiter(5, 60_000),
  });
  assert.equal(result.status, 400);
  assert.equal((result.body.error as { code: string }).code, 'KEY_MATERIAL_REJECTED');
  assert.equal(JSON.stringify(result.body).includes(secret), false);
});

test('malformed and oversized bodies fail before validation', async () => {
  const limiter = createRateLimiter(5, 60_000);
  const malformed = await handleAgentValidate(
    new Request('https://polypad.family/api/agents/v1/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    }),
    { limiter },
  );
  assert.equal(malformed.status, 400);
  assert.equal((malformed.body.error as { code: string }).code, 'INVALID_JSON');

  const oversized = await handleAgentValidate(
    new Request('https://polypad.family/api/agents/v1/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '99999' },
      body: '{}',
    }),
    { limiter },
  );
  assert.equal(oversized.status, 413);
});

test('the rate limit is a sliding window shared by validate and simulate', async () => {
  let now = 1_000_000;
  const limiter = createRateLimiter(2, 1_000, () => now);
  const deps = { limiter, ethCall: async (): Promise<EthCallOutcome> => ({ ok: false, kind: 'rpc' }) };
  const first = await handleAgentValidate(request('/api/agents/v1/validate', validBody()), deps);
  const second = await handleAgentSimulate(request('/api/agents/v1/simulate', validBody()), deps);
  const third = await handleAgentValidate(request('/api/agents/v1/validate', validBody()), deps);
  assert.equal(first.status, 200);
  assert.equal(second.status, 503);
  assert.equal(third.status, 429);
  assert.equal(third.headers?.['retry-after'], '600');
  assert.equal((third.body.error as { code: string }).code, 'RATE_LIMITED');

  const otherIp = await handleAgentValidate(
    request('/api/agents/v1/validate', validBody(), { 'x-forwarded-for': '203.0.113.9' }),
    deps,
  );
  assert.equal(otherIp.status, 200);

  now += 1_001;
  const afterWindow = await handleAgentValidate(request('/api/agents/v1/validate', validBody()), deps);
  assert.equal(afterWindow.status, 200);
});

test('the mark log is looked up by signer and is not the badge', async () => {
  clearAgentLaunchLog();
  await handleAgentSimulate(request('/api/agents/v1/simulate', validBody()), {
    limiter: createRateLimiter(5, 60_000),
    ethCall: successCall([]),
    randomId: () => 'req-2',
  });
  const found = await handleAgentMarks(request(`/api/agents/v1/marks?from=${SIGNER}`), {
    limiter: createRateLimiter(5, 60_000),
  });
  assert.equal(found.status, 200);
  const marks = found.body.marks as { id: string }[];
  assert.equal(marks[0].id, 'req-2');
  assert.match(String(found.body.note), /not the badge/);

  const missing = await handleAgentMarks(request('/api/agents/v1/marks'), {
    limiter: createRateLimiter(5, 60_000),
  });
  assert.equal(missing.status, 400);
});
