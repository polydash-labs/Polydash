/** Offline tests for the v2 agent API. No network, no chain. */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { getAddress, type Hex } from 'viem';
import { ADDR, LIMITS } from './config';
import {
  ApiError, bodyGuard, createRateBuckets, guardAmountWei, metaOf, optUint, parseUnits10, reqAddress, reqTxHash, scrub, slippageOf, takeLimit, toApiError,
} from './core';
import { ethToWei, parseIntent } from './intent';
import { schemaDocument } from './export-schemas';
import { matchTemplates, type Template } from './funds';
import { handleMcp } from './mcp';
import { attributionSuffix, checksumOf, isAllowedTarget, readAttribution, signingUrl, withAttribution } from './prepared';
import { handleV2 } from './router';
import { TOOLS } from './tools';

const A = getAddress('0x00000000000000000000000000000000000a11ce');
const HERE = new URL('.', import.meta.url).pathname;

describe('ethToWei', () => {
  it('converts decimals without floating point', () => {
    assert.equal(ethToWei('0.01'), 10n ** 16n);
    assert.equal(ethToWei('1'), 10n ** 18n);
    assert.equal(ethToWei('.5'), 5n * 10n ** 17n);
    assert.equal(ethToWei('0.000000000000000001'), 1n);
    assert.equal(ethToWei('123.456789012345678'), 123456789012345678000n);
  });
  it('rejects anything else', () => {
    for (const bad of ['', '.', '1e3', '-1', '0.1.2', '1,5', '0x10', 'abc', '0.0000000000000000001', ' ']) assert.equal(ethToWei(bad), null, bad);
  });
});

describe('parsers and guards', () => {
  it('parseUnits10 accepts whole base-unit strings only', () => {
    assert.equal(parseUnits10('123', 'x'), 123n);
    for (const bad of ['1.5', '-1', '0x1', '', 'abc', '1'.repeat(41), 1.5, -1, null, undefined]) assert.throws(() => parseUnits10(bad, 'x'), ApiError, String(bad));
  });
  it('optUint enforces bounds and defaults', () => {
    assert.equal(optUint(undefined, 'x', 7, 1, 10), 7);
    assert.equal(optUint('5', 'x', 7, 1, 10), 5);
    assert.throws(() => optUint('11', 'x', 7, 1, 10), ApiError);
    assert.throws(() => optUint('1.5', 'x', 7, 1, 10), ApiError);
    assert.throws(() => optUint(0, 'x', 7, 1, 10), ApiError);
  });
  it('slippage defaults to 100 bps and caps at the maximum', () => {
    assert.equal(slippageOf({}), 100);
    assert.equal(slippageOf({ slippageBps: 1000 }), 1000);
    assert.throws(() => slippageOf({ slippageBps: 1001 }), ApiError);
    assert.throws(() => slippageOf({ slippageBps: -1 }), ApiError);
  });
  it('addresses and hashes are validated and checksummed', () => {
    assert.equal(reqAddress({ a: A.toLowerCase() }, 'a'), A);
    assert.throws(() => reqAddress({ a: 'nope' }, 'a'), ApiError);
    assert.throws(() => reqAddress({ a: '0x0000000000000000000000000000000000000000' }, 'a'), ApiError);
    assert.throws(() => reqAddress({}, 'a'), ApiError);
    assert.equal(reqTxHash({ hash: '0x' + 'ab'.repeat(32) }), '0x' + 'ab'.repeat(32));
    assert.throws(() => reqTxHash({ hash: '0x12' }), ApiError);
  });
  it('amount guard: zero, over cap, and confirm-large', () => {
    assert.throws(() => guardAmountWei(0n, {}), ApiError);
    assert.doesNotThrow(() => guardAmountWei(10n ** 18n, {}));
    assert.throws(() => guardAmountWei(10n ** 18n + 1n, {}), (e: unknown) => (e as ApiError).code === 'confirm_large_required');
    assert.doesNotThrow(() => guardAmountWei(10n ** 18n + 1n, { confirmLarge: true }));
    assert.doesNotThrow(() => guardAmountWei(LIMITS.maxActionWei, { confirmLarge: true }));
    assert.throws(() => guardAmountWei(LIMITS.maxActionWei + 1n, { confirmLarge: true }), (e: unknown) => (e as ApiError).code === 'amount_too_large');
  });
  it('bodyGuard rejects key fields and 64-hex values anywhere, but allows addresses', () => {
    const hex = '0x' + 'cd'.repeat(32);
    for (const bad of [{ privateKey: 'x' }, { PRIVATE_KEY: 'x' }, { nested: { mnemonic: 'a b' } }, { seedPhrase: 'x' }, { list: [{ note: hex }] }, { note: hex.slice(2) }]) {
      assert.throws(() => bodyGuard(bad), (e: unknown) => (e as ApiError).code === 'key_material_rejected', JSON.stringify(bad).slice(0, 40));
    }
    assert.doesNotThrow(() => bodyGuard({ from: A, token: 'POLYCAT', amountEth: '0.01' }));
    assert.throws(() => bodyGuard([]), ApiError);
    assert.throws(() => bodyGuard(null), ApiError);
  });
  it('metaOf validates ref and client', () => {
    const req = (h: Record<string, string>) => new Request('http://x', { headers: h });
    assert.deepEqual({ ...metaOf(req({ 'x-polypad-client': 'grok-bot' }), { ref: 'Launch-Week' }), ip: '' }, { ip: '', client: 'grok-bot', ref: 'launch-week' });
    assert.equal(metaOf(req({ 'x-polypad-client': 'bad value!' }), { ref: '../x' }).client, null);
    assert.equal(metaOf(req({}), { ref: '../x' }).ref, 'grok');
    assert.equal(metaOf(req({}), {}).ref, 'grok');
  });
});

describe('errors never leak endpoints or secrets', () => {
  it('scrub removes URLs, 32-byte hex, and credentials but keeps Polypad links', () => {
    const msg = scrub('failed at https://rpc.example.com/v2/abcdef key 0x' + 'ab'.repeat(32) + ' api_key=SECRET123 see https://polypad.family/docs');
    assert.doesNotMatch(msg, /rpc\.example|abcdef|SECRET123/);
    assert.doesNotMatch(msg, new RegExp('ab'.repeat(32)));
    assert.match(msg, /https:\/\/polypad\.family\/docs/);
  });
  it('unknown errors become a generic 500 with no detail', () => {
    const e = toApiError(new Error('connect ECONNREFUSED http://10.0.0.1:8545 secret=abc'));
    assert.equal(e.status, 500);
    assert.doesNotMatch(e.message, /10\.0\.0\.1|secret/);
  });
});

describe('rate limits', () => {
  it('per-IP and per-wallet buckets return 429 with limits and reset with the clock', () => {
    let now = 1_000_000;
    const ctx = { limits: createRateBuckets(() => now) } as unknown as Parameters<typeof takeLimit>[0];
    const meta = { ip: '1.2.3.4', client: null, ref: 'grok' };
    for (let i = 0; i < LIMITS.rate.perWalletPrepare.limit; i += 1) takeLimit(ctx, 'prepare', meta, A);
    assert.throws(() => takeLimit(ctx, 'prepare', meta, A), (e: unknown) => (e as ApiError).code === 'rate_limited_wallet' && (e as ApiError).status === 429);
    takeLimit(ctx, 'prepare', meta, getAddress('0x0000000000000000000000000000000000000b0b'));
    for (let i = 0; i < LIMITS.rate.read.limit; i += 1) takeLimit(ctx, 'read', meta);
    assert.throws(() => takeLimit(ctx, 'read', meta), (e: unknown) => (e as ApiError).code === 'rate_limited');
    takeLimit(ctx, 'read', { ...meta, ip: '5.6.7.8' });
    now += 61_000;
    assert.doesNotThrow(() => takeLimit(ctx, 'read', meta));
  });
});

describe('attribution and signing links', () => {
  it('ERC-8021 schema 0 suffix: layout and round trip', () => {
    const suffix = attributionSuffix('grok');
    assert.ok(suffix.endsWith('80218021802180218021802180218021'));
    const codes = 'polypad,grok';
    assert.equal(suffix.slice(2, 2 + codes.length * 2), Buffer.from(codes).toString('hex'));
    assert.equal(suffix.slice(2 + codes.length * 2, 4 + codes.length * 2), codes.length.toString(16).padStart(2, '0'));
    assert.equal(suffix.slice(4 + codes.length * 2, 6 + codes.length * 2), '00');
    const data = withAttribution('0xd96a094a0000000000000000000000000000000000000000000000000000000000000001', 'launch-week');
    assert.deepEqual(readAttribution(data), { codes: ['polypad', 'launch-week'] });
    assert.equal(readAttribution('0xd96a094a'), null);
    assert.equal(readAttribution(('0x' + '00'.repeat(40) + '80218021802180218021802180218021') as Hex), null);
  });
  it('signing URL carries intent and never calldata or keys', () => {
    const url = new URL(signingUrl('buy', { t: ADDR.nftMarket, amt: '1', sl: 100, f: A }, { ref: 'grok', client: 'grok-bot' }, 'abc123abc123'));
    assert.equal(url.origin, 'https://polypad.family');
    assert.equal(url.pathname, '/sign');
    assert.equal(url.searchParams.get('a'), 'buy');
    assert.equal(url.searchParams.get('ref'), 'grok');
    assert.equal(url.searchParams.get('h'), 'abc123abc123');
    assert.doesNotMatch(url.toString(), /0x[0-9a-f]{64}|data=|calldata/i);
  });
  it('checksum ignores min-out and deadline, but changes with target, selector, value, or chain', () => {
    const base = { to: ADDR.universalRouter, data: '0xd96a094a1111' as Hex, value: 5n };
    assert.equal(checksumOf(base), checksumOf({ ...base, data: '0xd96a094a9999' as Hex }));
    assert.notEqual(checksumOf(base), checksumOf({ ...base, data: '0xaaaaaaaa1111' as Hex }));
    assert.notEqual(checksumOf(base), checksumOf({ ...base, value: 6n }));
    assert.notEqual(checksumOf(base), checksumOf({ ...base, to: ADDR.nftMarket }));
    assert.match(checksumOf(base), /^[0-9a-f]{12}$/);
  });
  it('output firewall allows known contracts and refuses others and the fee wallet', () => {
    assert.equal(isAllowedTarget(ADDR.universalRouter), true);
    assert.equal(isAllowedTarget(ADDR.fundFactories[0].factory), true);
    assert.equal(isAllowedTarget(ADDR.feeWallet), false);
    assert.equal(isAllowedTarget(getAddress('0x00000000000000000000000000000000deadbeef')), false);
    assert.equal(isAllowedTarget(getAddress('0x00000000000000000000000000000000deadbeef'), [getAddress('0x00000000000000000000000000000000deadbeef')]), true);
  });
});

describe('natural-language intents', () => {
  const p = parseIntent;
  it('buy', () => {
    const r = p('buy 0.01 ETH of POLYCAT');
    assert.equal(r.intent, 'buy');
    assert.equal(r.tool, 'polypad_prepare_buy');
    assert.deepEqual(r.arguments, { token: 'POLYCAT', amountWei: (10n ** 16n).toString() });
    assert.deepEqual(r.missing, []);
    assert.equal(r.needsWallet, true);
    assert.deepEqual(p('ape 0.5eth into $STAKE').arguments, { token: 'STAKE', amountWei: (5n * 10n ** 17n).toString() });
    assert.deepEqual(p('Buy me .25 ETH worth of Bernie').arguments, { token: 'Bernie', amountWei: (25n * 10n ** 16n).toString() });
  });
  it('buy without an amount or token asks instead of guessing; dollars are not ETH', () => {
    assert.deepEqual(p('buy POLYCAT').missing.map((m) => m.field), ['amountEth']);
    assert.deepEqual(p('buy 0.1 ETH').missing.map((m) => m.field), ['token']);
    const usd = p('buy $50 of POLYCAT');
    assert.ok(usd.missing.some((m) => /dollars|ETH/.test(m.question)));
    assert.equal(usd.arguments.amountWei, undefined);
  });
  it('sell with all, half, and percent', () => {
    assert.deepEqual(p('sell all my POLYCAT').arguments, { token: 'POLYCAT', percentOfBalance: 100 });
    assert.deepEqual(p('sell half of my $STAKE').arguments, { token: 'STAKE', percentOfBalance: 50 });
    assert.deepEqual(p('sell 25% of BERNIE').arguments, { token: 'BERNIE', percentOfBalance: 25 });
    assert.deepEqual(p('sell POLYCAT').missing.map((m) => m.field), ['percentOfBalance']);
  });
  it('addresses are used as tokens, checksummed', () => {
    const r = p('sell all of 0x0da3f383163f423d8cbc4802ede6e796fc80c9f3');
    assert.equal(r.arguments.token, getAddress('0x0da3f383163f423d8cbc4802ede6e796fc80c9f3'));
  });
  it('fund launch with unsupported assets is explicit', () => {
    const r = p('launch a fund with USDG and 3 stock tokens');
    assert.equal(r.intent, 'fund_create');
    assert.equal(r.tool, 'polypad_prepare_fund_create');
    assert.deepEqual(r.arguments.assets, ['USDG']);
    assert.equal(r.unsupported.length, 1);
    assert.match(r.unsupported[0], /stock tokens/);
    assert.ok(r.missing.some((m) => m.field === 'name'));
    const named = p('create a fund called Alpha Basket ticker ALPH with POLYDASH');
    assert.equal(named.arguments.name, 'Alpha Basket');
    assert.equal(named.arguments.symbol, 'ALPH');
    assert.deepEqual(named.arguments.assets, ['POLYDASH']);
  });
  it('token launch', () => {
    const r = p('launch a token called Moon Cat ticker MCAT');
    assert.equal(r.intent, 'token_launch');
    assert.equal(r.arguments.name, 'Moon Cat');
    assert.equal(r.arguments.symbol, 'MCAT');
    assert.deepEqual(r.missing.map((m) => m.field), ['creatorFeeBps']);
  });
  it('funds, NFTs, portfolio, protections, trending, new, status, help', () => {
    assert.equal(p('show open funds').arguments.open, true);
    assert.equal(p('show me funds').tool, 'polypad_list_funds');
    assert.equal(p('mint 2 RUGSLAYERS').intent, 'nft_buy');
    assert.equal(p('mint 2 RUGSLAYERS').arguments.quantity, 2);
    assert.equal(p('mint 2 RUGSLAYERS').arguments.collectionName, 'RUGSLAYERS');
    assert.equal(p('show NFT collections').tool, 'polypad_list_nfts');
    assert.equal(p('NFTs under 0.01 ETH').tool, 'polypad_list_nft_listings');
    assert.equal(p('buy listing #3').arguments.listingId, 3);
    assert.equal(p('what do I hold at 0x00000000000000000000000000000000000a11ce').tool, 'polypad_portfolio');
    assert.deepEqual(p('my portfolio').missing.map((m) => m.field), ['address']);
    assert.equal(p('is $POLYCAT risky?').tool, 'polypad_token_protections');
    assert.equal(p('what is trending').arguments.sort, 'trending');
    assert.equal(p('show new launches').arguments.sort, 'new');
    assert.equal(p('did my transaction go through 0x' + 'ab'.repeat(32)).tool, 'polypad_get_tx_status');
    assert.equal(p('what can I do').tool, 'polypad_what_can_i_do');
    assert.equal(p('').intent, 'help');
    assert.equal(p('asdf qwer').intent, 'unknown');
  });
  it('fund shares', () => {
    const r = p('invest in fund 0x00000000000000000000000000000000000a11ce, mint 3 shares');
    assert.equal(r.intent, 'fund_mint');
    assert.equal(r.arguments.quantity, 3);
    assert.deepEqual(r.missing, []);
    assert.equal(p('exit my fund shares').intent, 'fund_redeem');
  });
  it('every tool an intent can name exists in the registry', () => {
    const names = new Set(TOOLS.map((t) => t.name));
    const samples = ['buy 0.01 ETH of X', 'sell all X', 'launch a fund with POLYDASH', 'launch a token called A ticker B', 'show open funds', 'mint 1 X', 'show NFTs', 'my portfolio', 'is $X risky', 'trending', 'new launches', 'what can I do', 'invest in fund 0x00000000000000000000000000000000000a11ce mint 1 share', 'redeem fund shares', 'tx 0x' + 'ab'.repeat(32) + ' status', 'NFTs under 1 ETH'];
    for (const s of samples) { const t = p(s).tool; assert.ok(t === null || names.has(t), `${s} -> ${t}`); }
  });
});

describe('fund template matching', () => {
  const tpl = (id: number, symbols: string[]): Template => ({ id, assets: symbols.map((s, i) => ({ symbol: s, address: ('0x' + String(i + 1).padStart(40, '0')) as `0x${string}` })) } as unknown as Template);
  const templates = [tpl(1, []), tpl(2, ['POLYDASH']), tpl(3, ['POLYDASH', 'USDG'])];
  it('ETH-only wishes match the ETH template; known assets match; unknown assets are listed', () => {
    assert.deepEqual(matchTemplates(templates, ['ETH']).matches.map((t) => t.id), [1]);
    assert.deepEqual(matchTemplates(templates, ['polydash']).matches.map((t) => t.id), [2, 3]);
    assert.deepEqual(matchTemplates(templates, ['POLYDASH', 'usdg']).matches.map((t) => t.id), [3]);
    const m = matchTemplates(templates, ['USDG', 'AAPL']);
    assert.deepEqual(m.unmatched, ['aapl']);
    assert.deepEqual(m.matches, []);
  });
});

describe('tool registry', () => {
  it('has unique names and paths, valid schemas, and honest descriptions', () => {
    assert.equal(new Set(TOOLS.map((t) => t.name)).size, TOOLS.length);
    assert.equal(new Set(TOOLS.map((t) => `${t.method} ${t.path}`)).size, TOOLS.length);
    const required = ['polypad_what_can_i_do', 'polypad_intent', 'polypad_list_tokens', 'polypad_get_token', 'polypad_token_protections', 'polypad_quote_trade', 'polypad_prepare_buy', 'polypad_prepare_sell', 'polypad_list_nfts', 'polypad_list_nft_listings', 'polypad_prepare_nft_buy', 'polypad_list_fund_templates', 'polypad_list_funds', 'polypad_get_fund', 'polypad_prepare_fund_create', 'polypad_prepare_fund_mint', 'polypad_prepare_fund_redeem', 'polypad_prepare_token_launch', 'polypad_portfolio', 'polypad_get_tx_status', 'polypad_stats'];
    assert.deepEqual(TOOLS.map((t) => t.name).sort(), [...required].sort());
    for (const t of TOOLS) {
      assert.equal(t.inputSchema.type, 'object');
      assert.equal(t.inputSchema.additionalProperties, false);
      for (const r of t.inputSchema.required ?? []) assert.ok(r in t.inputSchema.properties, `${t.name} requires unknown field ${r}`);
      if (t.kind === 'prepare') assert.ok('from' in t.inputSchema.properties, `${t.name} needs from`);
      if (t.method === 'POST') assert.ok(t.kind === 'prepare' || t.name === 'polypad_intent');
      assert.ok(t.description.length > 40 && t.description.length < 700, t.name);
      assert.ok(!('privateKey' in t.inputSchema.properties));
    }
  });
  it('the generated stdio schema file is in sync with the registry', () => {
    const onDisk = JSON.parse(readFileSync(join(HERE, '../../../../../agents/polypad-mcp/schemas/tools_v2.json'), 'utf8'));
    assert.deepEqual(onDisk, JSON.parse(JSON.stringify(schemaDocument())), 'run: npm run gen:agent-tools');
  });
});

describe('HTTP and MCP surfaces without a chain', () => {
  it('REST: index lists every tool; unknown paths and wrong methods fail cleanly; keys are refused before any chain read', async () => {
    const idx = await handleV2(new Request('http://x/api/agents/v2'), []);
    assert.equal(idx.status, 200);
    assert.equal((idx.body.endpoints as unknown[]).length, TOOLS.length);
    assert.equal((idx.body.mcp as { url: string }).url, 'https://polypad.family/api/mcp');
    assert.equal((await handleV2(new Request('http://x/api/agents/v2/nope'), ['nope'])).status, 404);
    assert.equal((await handleV2(new Request('http://x/api/agents/v2/prepare/buy'), ['prepare', 'buy'])).status, 405);
    const key = await handleV2(new Request('http://x', { method: 'POST', body: JSON.stringify({ token: 'X', from: A, amountEth: '1', privateKey: '0x' + '11'.repeat(32) }) }), ['prepare', 'buy']);
    assert.equal(key.status, 400);
    assert.equal((key.body.error as { code: string }).code, 'key_material_rejected');
    assert.doesNotMatch(JSON.stringify(key.body), /1111/);
    assert.equal(key.headers['access-control-allow-origin'], '*');
    const big = await handleV2(new Request('http://x', { method: 'POST', body: 'x'.repeat(20_000) }), ['prepare', 'buy']);
    assert.equal(big.status, 413);
  });
  it('MCP: initialize negotiates, lists every tool, handles notifications, rejects bad calls', async () => {
    const rpc = (body: unknown) => handleMcp(new Request('http://x/api/mcp', { method: 'POST', body: JSON.stringify(body) }));
    const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
    assert.equal((init.body as any).result.protocolVersion, '2025-06-18');
    const old = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
    assert.equal((old.body as any).result.protocolVersion, '2024-11-05');
    const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.equal((list.body as any).result.tools.length, TOOLS.length);
    assert.equal((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
    assert.equal(((await rpc({ jsonrpc: '2.0', id: 3, method: 'nope' })).body as any).error.code, -32601);
    assert.equal(((await rpc({ id: 4 })).body as any).error.code, -32600);
    assert.equal((await rpc([])).status, 400);
    const keyed = await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'polypad_prepare_sell', arguments: { token: 'X', from: A, privateKey: 'k' } } });
    assert.equal((keyed.body as any).result.isError, true);
    assert.equal((keyed.body as any).result.structuredContent.error.code, 'key_material_rejected');
    assert.equal((await handleMcp(new Request('http://x/api/mcp', { method: 'OPTIONS' }))).status, 204);
    assert.equal((await handleMcp(new Request('http://x/api/mcp', { method: 'GET' }))).status, 405);
  });
});

describe('wording and secrets lint over the v2 code', () => {
  const files = readdirSync(HERE).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'fork-harness.ts');
  const text = files.map((f) => ({ f, s: readFileSync(join(HERE, f), 'utf8') }));
  it('never uses "audited" except "Not audited.", and avoids safe/guaranteed/first/best/Not financial advice in strings shown to users', () => {
    for (const { f, s } of text) {
      const stripped = s.replace(/Not audited\./g, '');
      assert.doesNotMatch(stripped, /\baudited\b/i, `${f}: audited`);
      for (const word of ['guaranteed', 'Not financial advice']) assert.ok(!s.includes(word), `${f}: ${word}`);
      assert.doesNotMatch(s, /\b(first|best|safe|safely|safest)\b/i, `${f}: banned word`);
      // User-facing strings only: quoted text that is not code identifiers.
      const quoted = [...s.matchAll(/(['`])((?:\\.|(?!\1).){12,})\1/g)].map((m) => m[2]).filter((q) => /\s/.test(q));
      for (const q of quoted) {
        if (/^[a-z0-9_ ,.()|&:;=<>!?*/+\-[\]{}$'"\\#%^~@]+$/.test(q) && /\b(function|const|return|import|export)\b/.test(q)) continue;
        assert.doesNotMatch(q, /\b(safe|safely|safest)\b/i, `${f}: "${q.slice(0, 60)}"`);
        assert.doesNotMatch(q, /\b(best|first-ever|the first)\b/i, `${f}: "${q.slice(0, 60)}"`);
      }
    }
  });
  it('writes Robinhood Chain in full', () => {
    for (const { f, s } of text) assert.doesNotMatch(s, /\bRH Chain\b|\bRobinhood L2\b|\bRHC\b/, f);
  });
  it('contains no private key, mnemonic, or provider URL', () => {
    for (const { f, s } of text) {
      assert.doesNotMatch(s, /0x[0-9a-fA-F]{64}\b/, `${f}: 32-byte hex literal`);
      assert.doesNotMatch(s, /alchemy|infura|quicknode|ankr\.com/i, `${f}: provider`);
      assert.doesNotMatch(s, /process\.env\.(PRIVATE_KEY|FEE|MNEMONIC|SECRET)/i, `${f}: env secret`);
    }
  });
});
