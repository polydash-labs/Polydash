// Base (eip155:8453) / USDC x402 variant — 402 response shape tests.
// Run from the repo root:  npx tsx lib/x402/base.test.ts
// No network, no DB, no CDP keys — the 402 builders are pure and the
// CDP client is only constructed when keys are present.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDiscoveryExtension } from '@x402/extensions/bazaar';
import {
  X402_NETWORK,
  X402_BASE_NETWORK,
  X402_PAY_TO,
  USDG_ADDRESS,
  USDC_BASE_ADDRESS,
  X402_PRODUCTS,
} from './constants';
import {
  isBaseVariant,
  cdpConfigured,
  buildBaseRequirement,
  buildDefaultAccepts,
  buildBasePaymentRequired,
  buildDefaultPaymentRequired,
  verifyBasePayment,
} from './base';
import { buildRequirements } from './facilitator';

const BASE_URL = 'https://polypad.family/api/x402/products/token-report?network=base&address=0x319525528f42167eF7fC18b77b889958080568e4';

test('isBaseVariant selects only ?network=base', () => {
  assert.equal(isBaseVariant(new URLSearchParams('network=base')), true);
  assert.equal(isBaseVariant(new URLSearchParams('')), false);
  assert.equal(isBaseVariant(new URLSearchParams('network=hood')), false);
  assert.equal(isBaseVariant(new URLSearchParams('network=4663')), false);
  assert.equal(isBaseVariant(new URLSearchParams('network=BASE')), false);
});

test('USDC on Base is the verified Circle address, not the brief address', () => {
  // The build brief carried a transposed address (…029029). The address
  // below is the one CDP docs and Circle list for native USDC on Base.
  assert.equal(USDC_BASE_ADDRESS, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  assert.notEqual(USDC_BASE_ADDRESS, '0x833589fCD6eDb6E08f4c7C32D4f71b54bd029029');
});

test('buildBaseRequirement prices each product in USDC 6dp on eip155:8453', () => {
  const cases: Array<[number, string]> = [
    [0.01, '10000'],
    [0.05, '50000'],
  ];
  for (const [price, amount] of cases) {
    const req = buildBaseRequirement(BASE_URL, 'Test product', price);
    assert.equal(req.scheme, 'exact');
    assert.equal(req.network, 'eip155:8453');
    assert.equal(req.network, X402_BASE_NETWORK);
    assert.equal(req.asset, USDC_BASE_ADDRESS);
    assert.equal(req.amount, amount);
    assert.equal(req.payTo, X402_PAY_TO);
    assert.equal(req.maxTimeoutSeconds, 120);
    assert.equal(req.extra.assetTransferMethod, 'eip3009');
    assert.equal(req.extra.name, 'USD Coin');
    assert.equal(req.extra.version, '2');
    assert.equal(req.resource.url, BASE_URL);
  }
});

test('buildBasePaymentRequired declares a valid Bazaar extension for every product', () => {
  for (const product of X402_PRODUCTS) {
    const url = `https://polypad.family/api/x402/products/${product.id}?network=base`;
    const body = buildBasePaymentRequired(product, url);
    assert.equal(body.x402Version, 2);
    assert.equal(body.accepts.length, 1);
    assert.equal(body.accepts[0].network, X402_BASE_NETWORK);
    assert.equal(body.accepts[0].asset, USDC_BASE_ADDRESS);
    assert.equal(body.accepts[0].amount, String(Math.round(product.priceUsd * 1e6)));
    // Top-level resource metadata the Bazaar listing reads.
    assert.equal(body.resource.url, url);
    assert.equal(body.resource.description, product.blurb);
    assert.equal(body.resource.serviceName, 'Polypad');
    assert.ok(body.resource.tags.length > 0);
    assert.ok(body.resource.iconUrl.startsWith('https://polypad.family/'));
    // Bazaar extension: present, GET, example params include network=base,
    // and valid against the facilitator's own schema validator.
    const bazaar = (body.extensions as Record<string, any>).bazaar;
    assert.ok(bazaar, `${product.id}: extensions.bazaar missing`);
    assert.equal(bazaar.info.input.type, 'http');
    assert.equal(bazaar.info.input.method, 'GET');
    assert.equal(bazaar.info.input.queryParams.network, 'base');
    assert.equal(bazaar.info.output.type, 'json');
    const validation = validateDiscoveryExtension(bazaar);
    assert.equal(validation.valid, true, `${product.id}: ${JSON.stringify(validation)}`);
  }
});

test('buildDefaultPaymentRequired declares the same valid Bazaar extension for every product', () => {
  // The Nov 22 Base settlements never echoed a Bazaar extension — the
  // default challenge carried none at all — so nothing was indexed even
  // though the payments settled through CDP. The default challenge must
  // declare the same extension the Base variant does, so a Bazaar-aware
  // client paying against the plain URL can echo it.
  for (const product of X402_PRODUCTS) {
    const url = `https://polypad.family/api/x402/products/${product.id}?address=0x319525528f42167eF7fC18b77b889958080568e4`;
    const hood = buildRequirements(url, product.blurb, product.priceUsd, 0);
    const accepts = buildDefaultAccepts(hood, url, product.blurb, product.priceUsd);
    const body = buildDefaultPaymentRequired(product, url, accepts);
    assert.equal(body.x402Version, 2);
    // Hood accepts first and unchanged, Base USDC option last.
    assert.deepEqual(body.accepts, accepts);
    assert.equal(body.accepts[body.accepts.length - 1].network, X402_BASE_NETWORK);
    // Top-level resource metadata, mirroring the Base variant.
    assert.equal(body.resource.url, url);
    assert.equal(body.resource.description, product.blurb);
    assert.equal(body.resource.serviceName, 'Polypad');
    assert.ok(body.resource.tags.length > 0);
    // Bazaar extension: present, GET, example params include network=base,
    // valid against the facilitator's own schema validator, and identical
    // to the one the Base variant declares for the same product.
    const bazaar = (body.extensions as Record<string, any>).bazaar;
    assert.ok(bazaar, `${product.id}: extensions.bazaar missing from default challenge`);
    assert.equal(bazaar.info.input.type, 'http');
    assert.equal(bazaar.info.input.method, 'GET');
    assert.equal(bazaar.info.input.queryParams.network, 'base');
    assert.equal(bazaar.info.output.type, 'json');
    const validation = validateDiscoveryExtension(bazaar);
    assert.equal(validation.valid, true, `${product.id}: ${JSON.stringify(validation)}`);
    const baseBody = buildBasePaymentRequired(product, `${url}&network=base`);
    assert.deepEqual(
      body.extensions,
      baseBody.extensions,
      `${product.id}: default and Base challenges must declare the same Bazaar extension`,
    );
  }
});

test('Bazaar examples use real, public, callable values per product', () => {
  const token = buildBasePaymentRequired(X402_PRODUCTS[0], BASE_URL);
  assert.equal(
    (token.extensions as any).bazaar.info.input.queryParams.address,
    '0x319525528f42167eF7fC18b77b889958080568e4',
  );
  const cto = buildBasePaymentRequired(X402_PRODUCTS[1], 'https://polypad.family/api/x402/products/cto-report?network=base');
  assert.equal(
    (cto.extensions as any).bazaar.info.input.queryParams.launch,
    '0x2B0b4151cA57546BD968718b1ba256b288e51CA9',
  );
  const fund = buildBasePaymentRequired(X402_PRODUCTS[2], 'https://polypad.family/api/x402/products/fund-nav?network=base');
  assert.equal(
    (fund.extensions as any).bazaar.info.input.queryParams.fund,
    '0x7c1d31629ac68aebe83f230edbc7eacfc26285ef',
  );
});

test('cdpConfigured is false with no env vars, and verify stays inert', async () => {
  const savedId = process.env.CDP_API_KEY_ID;
  const savedSecret = process.env.CDP_API_KEY_SECRET;
  delete process.env.CDP_API_KEY_ID;
  delete process.env.CDP_API_KEY_SECRET;
  try {
    assert.equal(cdpConfigured(), false);
    const requirement = buildBaseRequirement(BASE_URL, 'Test product', 0.01);
    const payload = {
      x402Version: 2,
      accepted: requirement,
      payload: { signature: '0x00', authorization: { from: X402_PAY_TO, to: X402_PAY_TO, value: '10000', validAfter: '0', validBefore: '0', nonce: '0x00' } },
    } as any;
    const result = await verifyBasePayment({} as any, payload, requirement);
    assert.equal(result.isValid, false);
    assert.equal(result.invalidReason, 'cdp_facilitator_not_configured');
  } finally {
    if (savedId !== undefined) process.env.CDP_API_KEY_ID = savedId;
    if (savedSecret !== undefined) process.env.CDP_API_KEY_SECRET = savedSecret;
  }
});

test('Hood defaults are untouched: network, USDG, and buildRequirements', () => {
  assert.equal(X402_NETWORK, 'eip155:4663');
  assert.equal(USDG_ADDRESS, '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168');
  const reqs = buildRequirements('https://polypad.family/api/x402/products/token-report', 'Test', 0.01, 0);
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0].network, 'eip155:4663');
  assert.equal(reqs[0].asset, USDG_ADDRESS);
  assert.equal(reqs[0].amount, '10000');
});

test('buildDefaultAccepts: Hood options first, Base USDC option last — the HIVE402 fix', () => {
  // HIVE402 rejected the Hood-only default challenge on Nov 24 ("None of
  // the payment options use an OMNIGATE or 402Proof network"). The
  // default challenge must carry a Base option alongside the Hood ones.
  const url = 'https://polypad.family/api/x402/products/token-report?address=0x319525528f42167eF7fC18b77b889958080568e4';
  for (const product of X402_PRODUCTS) {
    const hood = buildRequirements(url, product.blurb, product.priceUsd, 0);
    const accepts = buildDefaultAccepts(hood, url, product.blurb, product.priceUsd);
    // Hood requirements unchanged and first, in order.
    assert.equal(accepts.length, hood.length + 1);
    assert.deepEqual(accepts.slice(0, hood.length), hood);
    // Base option last: same USD price in USDC, same payTo.
    const base = accepts[accepts.length - 1];
    assert.equal(base.network, X402_BASE_NETWORK);
    assert.equal(base.asset, USDC_BASE_ADDRESS);
    assert.equal(base.amount, String(Math.round(product.priceUsd * 1e6)));
    assert.equal(base.payTo, X402_PAY_TO);
    assert.equal(base.scheme, 'exact');
    assert.equal(base.extra.assetTransferMethod, 'eip3009');
  }
});
