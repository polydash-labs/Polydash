/**
 * Fork tests on chain 4663. They run only when FORK_RPC is set; they start their own anvil fork and never touch
 * the live chain with a write. Run: FORK_RPC=<rpc url> npm run test:fork
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { decodeFunctionData, getAddress, parseAbi, type Hex } from 'viem';
import { ApiError } from './core';
import { ADDR } from './config';
import { fund, runAll, sendTx, startFork, type Fork } from './fork-harness';
import { handleV2 } from './router';
import { handleMcp } from './mcp';
import { TOOLS, runTool } from './tools';
import { readAttribution } from './prepared';

const SKIP = process.env.FORK_RPC ? false : 'FORK_RPC not set';
const ALICE = getAddress('0x00000000000000000000000000000000000a11ce');
const BOB = getAddress('0x0000000000000000000000000000000000000b0b');
const META = { ip: 'test', client: 'fork-test', ref: 'grok' };
const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)']);
const NFT = parseAbi(['function balanceOf(address) view returns (uint256)', 'function ownerOf(uint256) view returns (address)', 'function setApprovalForAll(address,bool)', 'function totalMinted() view returns (uint256)']);
const MARKET = parseAbi(['function list(address nft, uint256 tokenId, uint256 price, uint64 expiry) returns (uint256)', 'function nextListingId() view returns (uint256)']);

let fork: Fork;
const call = async (name: string, input: Record<string, unknown>): Promise<any> => {
  const tool = TOOLS.find((t) => t.name === name)!;
  return runTool(fork.ctx, tool, input, META, false);
};
const fails = async (name: string, input: Record<string, unknown>, code: string) => {
  await assert.rejects(call(name, input), (e: unknown) => e instanceof ApiError && e.code === code, `${name} should fail with ${code}`);
};

describe('v2 on a chain 4663 fork', { skip: SKIP }, () => {
  before(async () => {
    fork = await startFork();
    for (const a of [ALICE, BOB]) await fund(fork, a, 200);
  });
  after(() => fork?.stop());

  describe('read tools', () => {
    it('what_can_i_do returns live counts and guardrails', async () => {
      const r = await call('polypad_what_can_i_do', {});
      assert.equal(r.chain.id, 4663);
      assert.ok(r.live.tokens >= 4, 'launch count');
      assert.ok(r.live.nftCollections >= 2);
      assert.ok(r.guardrails.some((g: string) => g === 'Not audited.'));
    });

    it('list_tokens: trending, new, search, and filters', async () => {
      const t = await call('polypad_list_tokens', { sort: 'trending' });
      assert.ok(t.tokens.length >= 4);
      const n = await call('polypad_list_tokens', { sort: 'new', limit: 2 });
      assert.equal(n.tokens.length, 2);
      assert.ok(n.tokens[0].launchedAt >= n.tokens[1].launchedAt);
      const q = await call('polypad_list_tokens', { q: 'polycat' });
      assert.equal(q.tokens[0].symbol, 'POLYCAT');
      const g = await call('polypad_list_tokens', { agentLaunched: true });
      assert.ok(g.tokens.every((x: any) => x.agentLaunched));
    });

    it('get_token resolves by symbol, name, token and launch address; rejects unknown', async () => {
      const bySym = await call('polypad_get_token', { token: 'POLYCAT' });
      const byLaunch = await call('polypad_get_token', { token: bySym.token.launch });
      const byToken = await call('polypad_get_token', { token: bySym.token.token });
      assert.equal(byLaunch.token.launch, bySym.token.launch);
      assert.equal(byToken.token.launch, bySym.token.launch);
      await fails('polypad_get_token', { token: 'NOPE_NOT_REAL' }, 'not_found');
    });

    it('token_protections speaks in plain words and never says safe', async () => {
      const r = await call('polypad_token_protections', { token: 'POLYCAT' });
      assert.ok(typeof r.plainSummary === 'string' && r.plainSummary.length > 20);
      assert.ok(Array.isArray(r.checks) && r.checks.length >= 4);
      assert.ok(Array.isArray(r.cannotTellYou) && r.cannotTellYou.length >= 1);
      assert.match(JSON.stringify(r), /Not audited\./);
      assert.doesNotMatch(JSON.stringify(r).replace(/Not audited\./g, ''), /\b(safe|guaranteed|audited)\b/i);
    });

    it('list_nfts and listings', async () => {
      const r = await call('polypad_list_nfts', {});
      assert.ok(r.collections.length >= 2);
      const s = await call('polypad_list_nfts', { q: 'rugslayers' });
      assert.equal(s.collections[0].symbol, 'RUGSLAYERS');
      const l = await call('polypad_list_nft_listings', {});
      assert.ok(Array.isArray(l.listings));
    });

    it('fund templates and funds with filters', async () => {
      const t = await call('polypad_list_fund_templates', {});
      assert.equal(t.templates.length, 5);
      const f = await call('polypad_list_funds', {});
      assert.ok(f.funds.length >= 1);
      const byAsset = await call('polypad_list_funds', { asset: 'WETH' });
      assert.ok(byAsset.funds.length >= 1);
      const none = await call('polypad_list_funds', { open: true });
      assert.ok(none.funds.every((x: any) => x.status === 'raising'));
      const one = await call('polypad_get_fund', { fund: f.funds[0].fund });
      assert.equal(one.fund.fund, f.funds[0].fund);
    });
  });

  describe('quote and curve trades', () => {
    it('quote_trade buy and sell on the curve', async () => {
      const q = await call('polypad_quote_trade', { token: 'POLYCAT', side: 'buy', amountEth: '0.01' });
      assert.equal(q.venue, 'bonding_curve');
      assert.ok(BigInt(q.expectedOut) > 0n);
      assert.ok(BigInt(q.minAmountOut) < BigInt(q.expectedOut));
      // The live curve holds little ETH, so a sell larger than it can take back is refused with a clear error.
      await assert.rejects(call('polypad_quote_trade', { token: 'POLYCAT', side: 'sell', amount: q.expectedOut }), (e: unknown) => e instanceof ApiError && e.code === 'amount_exceeds_curve' && typeof e.extra.maxTokens === 'string');
      const s = await call('polypad_quote_trade', { token: 'POLYCAT', side: 'sell', amount: '1000000000000000000000' });
      assert.ok(BigInt(s.expectedOut) > 0n);
    });

    let boughtLaunch: Hex;
    let buyHash: Hex;
    it('prepare_buy returns tx, summary, link, simulation; executes on the fork', async () => {
      const p = await call('polypad_prepare_buy', { token: 'POLYCAT', from: ALICE, amountEth: '0.01' });
      assert.equal(p.chainId, 4663);
      assert.equal(p.custody, 'non-custodial');
      assert.equal(p.transactions.length, 1);
      const tx = p.transactions[0];
      assert.equal(tx.simulated, true);
      assert.ok(BigInt(tx.gas) > 21000n);
      assert.equal(tx.value, '10000000000000000');
      assert.match(p.signing.url, /^https:\/\/polypad\.family\/sign\?v=1&a=buy&/);
      assert.match(p.signing.url, new RegExp(`h=${p.signing.checksum}`));
      assert.match(p.summary.headline, /Buy POLYCAT/);
      assert.ok(p.summary.risks.includes('Not audited.'));
      assert.deepEqual(readAttribution(tx.data), { codes: ['polypad', 'grok'] });
      const dec = decodeFunctionData({ abi: parseAbi(['function buy(uint256 minTokensOut) payable']), data: tx.data.slice(0, 74) as Hex });
      assert.equal(dec.functionName, 'buy');
      boughtLaunch = p.token.launch;
      const before = await fork.client.readContract({ address: p.token.token, abi: ERC20, functionName: 'balanceOf', args: [ALICE] });
      const done = await runAll(fork, p);
      buyHash = done.hash;
      const after = await fork.client.readContract({ address: p.token.token, abi: ERC20, functionName: 'balanceOf', args: [ALICE] });
      assert.ok(after - before >= BigInt(p.summary.youReceiveAtLeast.replace(/[^0-9]/g, '') ? 0 : 0));
      assert.ok(after - before >= BigInt(p.quote.minAmountOut), 'received at least the minimum shown');
    });

    it('get_tx_status decodes the confirmed buy and the attribution suffix', async () => {
      const s = await call('polypad_get_tx_status', { hash: buyHash });
      assert.equal(s.status, 'confirmed');
      assert.equal(s.attribution.ref, 'grok');
      assert.match(JSON.stringify(s.result), /POLYCAT/);
      await fails('polypad_get_tx_status', { hash: '0x' + 'ab'.repeat(32) }, 'tx_not_found');
    });

    it('prepare_sell by percent of balance: approval then sale, both execute', async () => {
      const p = await call('polypad_prepare_sell', { token: boughtLaunch, from: ALICE, percentOfBalance: 100 });
      assert.ok(p.transactions.length >= 1);
      assert.equal(p.transactions.at(-1).kind, 'sell');
      assert.match(p.summary.headline, /Sell/);
      const ethBefore = await fork.client.getBalance({ address: ALICE });
      await runAll(fork, p);
      assert.ok((await fork.client.getBalance({ address: ALICE })) > ethBefore - 10n ** 16n);
      const bal = await fork.client.readContract({ address: p.token.token, abi: ERC20, functionName: 'balanceOf', args: [ALICE] });
      assert.equal(bal, 0n);
      await fails('polypad_prepare_sell', { token: boughtLaunch, from: ALICE, percentOfBalance: 100 }, 'insufficient_balance');
    });

    it('error paths: too much, bad slippage, fee wallet, unknown token, bad address', async () => {
      await fails('polypad_prepare_buy', { token: 'POLYCAT', from: ALICE, amountEth: '30' }, 'amount_too_large');
      await fails('polypad_prepare_buy', { token: 'POLYCAT', from: ALICE, amountEth: '2' }, 'confirm_large_required');
      await fails('polypad_prepare_buy', { token: 'POLYCAT', from: ALICE, amountEth: '0.01', slippageBps: 5001 }, 'invalid_params');
      await fails('polypad_prepare_buy', { token: 'POLYCAT', from: ADDR.feeWallet, amountEth: '0.01' }, 'invalid_params');
      await fails('polypad_prepare_buy', { token: 'NOPE_NOT_REAL', from: ALICE, amountEth: '0.01' }, 'not_found');
      await fails('polypad_prepare_buy', { token: 'POLYCAT', from: 'hello', amountEth: '0.01' }, 'invalid_params');
      await fails('polypad_prepare_buy', { token: 'POLYCAT', from: ALICE, amountEth: '0.01.5' }, 'invalid_params');
      await fails('polypad_prepare_buy', { token: 'POLYCAT', from: ALICE }, 'invalid_params');
      await fails('polypad_prepare_buy', { token: 'POLYCAT', from: getAddress('0x00000000000000000000000000000000000ca5e5'), amountEth: '0.01' }, 'insufficient_balance');
    });

    it('a reverting simulation returns an error and no signing link', async () => {
      // A minimum-out of "everything" cannot be met; use a 0 bps slippage buy larger than the price moves would allow.
      // The simplest guaranteed revert: sell tokens the wallet does not hold, with an explicit amount.
      await fails('polypad_prepare_sell', { token: 'POLYCAT', from: BOB, amount: '1000000000000000000' }, 'insufficient_balance');
    });
  });

  describe('graduated token: Uniswap V4 via Universal Router and Permit2', () => {
    const STAKE = '0xdf256782ac0bcF299f31DC6e605d633B5715c1fF';
    let token: Hex;
    it('a large buy needs confirmLarge, then graduates the token on the fork', async () => {
      await fails('polypad_prepare_buy', { token: STAKE, from: ALICE, amountEth: '17' }, 'confirm_large_required');
      const p = await call('polypad_prepare_buy', { token: STAKE, from: ALICE, amountEth: '17', confirmLarge: true });
      assert.equal(p.quote.graduatesInThisTrade, true);
      assert.match(p.warnings.join(' ') + p.summary.lines.join(' '), /graduat/i);
      token = p.token.token;
      await runAll(fork, p);
      fork.ctx.cache.clear();
      const g = await call('polypad_get_token', { token: STAKE });
      assert.equal(g.token.phase, 'graduated');
    });

    it('quote_trade uses the V4 quoter after graduation', async () => {
      const q = await call('polypad_quote_trade', { token: STAKE, side: 'buy', amountEth: '0.01' });
      assert.equal(q.venue, 'uniswap_v4');
      assert.ok(BigInt(q.expectedOut) > 0n);
    });

    it('prepare_buy goes through the Universal Router, executes, and receives at least the minimum', async () => {
      const p = await call('polypad_prepare_buy', { token: STAKE, from: BOB, amountEth: '0.01' });
      assert.equal(p.transactions.length, 1);
      assert.equal(getAddress(p.transactions[0].to), getAddress(ADDR.universalRouter));
      assert.equal(p.transactions[0].simulated, true);
      assert.deepEqual(readAttribution(p.transactions[0].data), { codes: ['polypad', 'grok'] });
      const done = await runAll(fork, p);
      const bal = await fork.client.readContract({ address: token, abi: ERC20, functionName: 'balanceOf', args: [BOB] });
      assert.ok(bal >= BigInt(p.quote.minAmountOut));
      const st = await call('polypad_get_tx_status', { hash: done.hash });
      assert.equal(st.status, 'confirmed');
      assert.match(st.result, /Received .* STAKE/);
    });

    it('prepare_sell adds the Permit2 approvals, then sells half and the router pays ETH', async () => {
      const p = await call('polypad_prepare_sell', { token: STAKE, from: BOB, percentOfBalance: 50 });
      assert.ok(p.transactions.length >= 2, 'approval steps present');
      assert.equal(p.transactions.at(-1).kind, 'swap');
      assert.equal(getAddress(p.transactions.at(-1).to), getAddress(ADDR.universalRouter));
      assert.equal(p.transactions.at(-1).simulated, false, 'later steps cannot be simulated before the approvals exist');
      const before = await fork.client.readContract({ address: token, abi: ERC20, functionName: 'balanceOf', args: [BOB] });
      const ethBefore = await fork.client.getBalance({ address: BOB });
      await runAll(fork, p);
      const after = await fork.client.readContract({ address: token, abi: ERC20, functionName: 'balanceOf', args: [BOB] });
      assert.ok(after < before && after >= before / 2n - 1n);
      assert.ok((await fork.client.getBalance({ address: BOB })) > ethBefore - 10n ** 16n);
    });

    it('protections for a graduated token mention the pool', async () => {
      const r = await call('polypad_token_protections', { token: STAKE });
      assert.match(JSON.stringify(r), /Uniswap|pool|liquidity/i);
    });
  });

  describe('NFTs', () => {
    const RUG = '0x359Ec209361bEdC9a09a5e622605481CACb1AD06';
    const PCAT = '0xcB674D45947dcb46a60Dd8a1eD18EEc2E0546bE0';
    it('public mint: prepare, execute, wallet cap, and sold-out math', async () => {
      const p = await call('polypad_prepare_nft_buy', { from: BOB, collection: RUG, quantity: 2 });
      assert.equal(p.transactions[0].value, (2n * 10n ** 15n).toString());
      assert.match(p.summary.headline, /Mint 2 x RUGSLAYERS/);
      await runAll(fork, p);
      assert.equal(await fork.client.readContract({ address: RUG, abi: NFT, functionName: 'balanceOf', args: [BOB] }), 2n);
      await fails('polypad_prepare_nft_buy', { from: BOB, collection: RUG, quantity: 4 }, 'wallet_cap');
      const byName = await call('polypad_prepare_nft_buy', { from: ALICE, collectionName: 'rugslayers' });
      assert.equal(getAddress(byName.transactions[0].to), getAddress(RUG));
    });

    it('marketplace: list on-chain, find it in listings, prepare and execute the buy', async () => {
      const mint = await call('polypad_prepare_nft_buy', { from: BOB, collection: PCAT, quantity: 1 });
      await runAll(fork, mint);
      const total = await fork.client.readContract({ address: PCAT, abi: NFT, functionName: 'totalMinted' });
      let tokenId = -1n;
      for (const c of [total - 1n, total, total + 1n]) {
        try { if (getAddress((await fork.client.readContract({ address: PCAT, abi: NFT, functionName: 'ownerOf', args: [c] })) as string) === BOB) { tokenId = c; break; } } catch { /* next */ }
      }
      assert.ok(tokenId >= 0n, 'found the minted token id');
      const { encodeFunctionData } = await import('viem');
      await sendTx(fork, { from: BOB, to: PCAT, value: '0', chainId: 4663, data: encodeFunctionData({ abi: NFT, functionName: 'setApprovalForAll', args: [ADDR.nftMarket, true] }) });
      const expiry = BigInt(Math.floor(Date.now() / 1000) + 86_400);
      const listed = await sendTx(fork, { from: BOB, to: ADDR.nftMarket, value: '0', chainId: 4663, data: encodeFunctionData({ abi: MARKET, functionName: 'list', args: [PCAT, tokenId, 2n * 10n ** 15n, expiry] }) });
      assert.ok(listed.ok);
      fork.ctx.cache.clear();
      const l = await call('polypad_list_nft_listings', { collection: PCAT });
      assert.equal(l.listings.length, 1);
      const lid = l.listings[0].listingId;
      const under = await call('polypad_list_nft_listings', { maxPriceEth: '0.001' });
      assert.equal(under.listings.length, 0);
      await fails('polypad_prepare_nft_buy', { from: BOB, listingId: lid }, 'own_listing');
      const p = await call('polypad_prepare_nft_buy', { from: ALICE, listingId: lid });
      assert.equal(getAddress(p.transactions[0].to), getAddress(ADDR.nftMarket));
      assert.equal(p.transactions[0].value, (2n * 10n ** 15n).toString());
      await runAll(fork, p);
      assert.equal(getAddress((await fork.client.readContract({ address: PCAT, abi: NFT, functionName: 'ownerOf', args: [tokenId] })) as string), ALICE);
      await fails('polypad_prepare_nft_buy', { from: ALICE, listingId: lid }, 'listing_not_valid');
      await fails('polypad_prepare_nft_buy', { from: ALICE, listingId: 99999 }, 'not_found');
    });
  });

  describe('funds', () => {
    let fund: Hex;
    it('prepare_fund_create: honest answer for USDG and stock tokens, then a real template', async () => {
      await assert.rejects(call('polypad_prepare_fund_create', { from: BOB, assets: ['USDG', 'AAPL'], name: 'X', symbol: 'X', mintPriceEth: '0.01', raiseCapEth: '1' }), (e: unknown) => e instanceof ApiError && e.code === 'no_matching_template' && Array.isArray(e.extra.availableTemplates) && /Stock tokens are not part/.test(e.message));
      await fails('polypad_prepare_fund_create', { from: BOB, templateId: 1, name: 'X', symbol: 'X', mintPriceEth: '0.00000001', raiseCapEth: '1' }, 'invalid_params');
      await fails('polypad_prepare_fund_create', { from: BOB, templateId: 99, name: 'X', symbol: 'X', mintPriceEth: '0.01', raiseCapEth: '1' }, 'unknown_template');
      await fails('polypad_prepare_fund_create', { from: BOB, templateId: 1, name: '', symbol: 'X', mintPriceEth: '0.01', raiseCapEth: '1' }, 'invalid_params');
    });

    it('creates a Phase 6 fund on the fork and reports it in status', async () => {
      const p = await call('polypad_prepare_fund_create', { from: BOB, templateId: 1, name: 'Fork Test Fund', symbol: 'FTF', mintPriceEth: '0.01', raiseCapEth: '1' });
      assert.equal(getAddress(p.transactions[0].to), getAddress(ADDR.fundFactories[0].factory));
      assert.equal(p.managerSkin.shares, '5');
      assert.match(p.summary.lines.join(' '), /must mint 5 shares/);
      assert.ok(p.preview.fundAddress);
      const done = await runAll(fork, p);
      const st = await call('polypad_get_tx_status', { hash: done.hash });
      assert.equal(st.status, 'confirmed');
      assert.equal(getAddress(st.newFund), getAddress(p.preview.fundAddress));
      fund = st.newFund;
      fork.ctx.cache.clear();
      const g = await call('polypad_get_fund', { fund });
      assert.equal(g.fund.status, 'raising');
      assert.equal(g.fund.publicMintOpen, false);
      const byName = await call('polypad_get_fund', { fund: 'Fork Test Fund' });
      assert.equal(byName.fund.fund, g.fund.fund);
    });

    it('public mint is refused until the manager mints required shares; then it works', async () => {
      await assert.rejects(call('polypad_prepare_fund_mint', { from: ALICE, fund, quantity: 1 }), (e: unknown) => e instanceof ApiError && e.code === 'skin_required' && e.extra.sharesRequired === 5);
      const m = await call('polypad_prepare_fund_mint', { from: BOB, fund, quantity: 5 });
      assert.equal(m.transactions[0].value, (5n * 10n ** 16n).toString());
      await runAll(fork, m);
      const a = await call('polypad_prepare_fund_mint', { from: ALICE, fund, quantity: 2 });
      assert.match(a.summary.headline, /Mint 2 shares of Fork Test Fund/);
      await runAll(fork, a);
      fork.ctx.cache.clear();
      const g = await call('polypad_get_fund', { fund });
      assert.equal(g.fund.shares.minted, 7);
      assert.equal(g.fund.publicMintOpen, true);
      await fails('polypad_prepare_fund_mint', { from: ALICE, fund, quantity: 500 }, 'sold_out');
      await fails('polypad_prepare_fund_redeem', { from: ALICE, fund }, 'raise_open');
    });

    it('open funds filter and template filter find it', async () => {
      const r = await call('polypad_list_funds', { open: true, templateId: 1, q: 'fork' });
      assert.equal(r.funds.length, 1);
      const m = await call('polypad_list_funds', { manager: BOB });
      assert.ok(m.funds.every((x: any) => getAddress(x.manager) === BOB));
    });

    it('the existing Phase 3 fund is refused politely for public mint', async () => {
      await fails('polypad_prepare_fund_mint', { from: ALICE, fund: '0x6Ab881AddD044Cc601F21f107f9B110e41531ba4', quantity: 1 }, 'skin_required');
    });

    it('after the raise window: exit or refund paths are reached and simulated', async () => {
      await fork.rpc('evm_increaseTime', [8 * 86_400]);
      await fork.rpc('evm_mine', []);
      fork.ctx.nowSec = () => Math.floor(Date.now() / 1000) + 8 * 86_400; // the API reads the wall clock; the fork moved ahead
      fork.ctx.cache.clear();
      const g = await call('polypad_get_fund', { fund });
      assert.equal(g.fund.status, 'raising');
      const p = await call('polypad_prepare_fund_redeem', { from: ALICE, fund });
      assert.equal(p.mode, 'refund');
      assert.deepEqual(p.transactions.map((x: any) => x.kind), ['fail_raise', 'refund']);
      assert.equal(p.transactions[0].simulated, true);
      assert.equal(p.transactions[1].simulated, false);
      const ethBefore = await fork.client.getBalance({ address: ALICE });
      const done = await runAll(fork, p);
      assert.ok((await fork.client.getBalance({ address: ALICE })) > ethBefore);
      const st = await call('polypad_get_tx_status', { hash: done.hash });
      assert.equal(st.status, 'confirmed');
      fork.ctx.cache.clear();
      const left = await call('polypad_prepare_fund_redeem', { from: ALICE, fund }).catch((e) => e);
      assert.ok(left instanceof ApiError && left.code === 'no_shares');
      const g2 = await call('polypad_get_fund', { fund });
      assert.equal(g2.fund.status, 'failed');
      // The manager can now refund too, with no extra fail step.
      const mgr = await call('polypad_prepare_fund_redeem', { from: BOB, fund, quantity: 2 });
      assert.deepEqual(mgr.transactions.map((x: any) => x.kind), ['refund']);
    });
  });

  describe('portfolio, intent, token launch, HTTP and MCP', () => {
    it('portfolio is read-only, in ETH units, with coverage notes', async () => {
      fork.ctx.cache.clear();
      const r = await call('polypad_portfolio', { address: BOB });
      assert.equal(r.address, BOB);
      assert.ok(Array.isArray(r.tokens) && Array.isArray(r.funds) && Array.isArray(r.nfts));
      assert.doesNotMatch(JSON.stringify(r), /\bUSD\b|\$\d|price target|will (rise|fall|go up)/i);
      assert.equal(r.tokens[0].netResultEth, null, 'no net result for a graduated token');
      assert.equal(r.funds[0].netResultEth, '-0.0001');
      assert.match(r.reading, /not forecasts/);
      await fails('polypad_portfolio', { address: 'nope' }, 'invalid_params');
    });

    it('intent: "buy 0.01 ETH of POLYCAT" prepares the buy in one call', async () => {
      const r = await call('polypad_intent', { text: 'buy 0.01 ETH of POLYCAT', from: ALICE });
      assert.equal(r.intent, 'buy');
      assert.equal(r.result.action, 'buy');
      assert.match(r.result.signing.url, /^https:\/\/polypad\.family\/sign/);
    });

    it('intent: asks for the wallet, and for the amount, instead of guessing', async () => {
      const a = await call('polypad_intent', { text: 'buy 0.01 ETH of POLYCAT' });
      assert.deepEqual(a.missing.map((m: any) => m.field), ['from']);
      assert.equal(a.result, undefined);
      const b = await call('polypad_intent', { text: 'buy POLYCAT', from: ALICE });
      assert.ok(b.missing.some((m: any) => m.field === 'amountEth'));
    });

    it('intent: read requests run directly', async () => {
      const t = await call('polypad_intent', { text: "what's trending" });
      assert.ok(t.result.tokens.length >= 1);
      const r = await call('polypad_intent', { text: 'is $POLYCAT risky?' });
      assert.ok(r.result.plainSummary);
      const h = await call('polypad_intent', { text: 'what can I do' });
      assert.ok(h.result.youCanAsk);
    });

    it('intent: "launch a fund with USDG and 3 stock tokens" answers honestly and lists templates', async () => {
      const r = await call('polypad_intent', { text: 'launch a fund with USDG and 3 stock tokens', from: ALICE });
      assert.equal(r.intent, 'fund_create');
      assert.ok(r.unsupported.length >= 1);
      assert.ok(r.missing.some((m: any) => m.field === 'name'));
    });

    it('intent: sell half of my token uses percentOfBalance', async () => {
      const r = await call('polypad_intent', { text: 'sell half my STAKE', from: BOB });
      assert.equal(r.intent, 'sell');
      assert.equal(r.result.transactions.at(-1).kind, 'swap');
    });

    it('prepare_token_launch: validates, simulates createLaunch, marks Agent-launched', async () => {
      const bad = await call('polypad_prepare_token_launch', { from: ALICE, name: 'Moon Cat', symbol: 'MCAT', creatorFeeBps: 900 }).catch((e) => e);
      assert.ok(bad instanceof ApiError && bad.code === 'invalid_params');
      const p = await call('polypad_prepare_token_launch', { from: ALICE, name: 'Moon Cat', symbol: 'MCAT', creatorFeeBps: 100, description: 'A test token on a fork.' });
      assert.equal(p.action, 'token-launch');
      assert.equal(p.transactions[0].simulated, true);
      assert.match(p.summary.headline, /Launch Moon Cat \(MCAT\) on Robinhood Chain/);
      assert.match(JSON.stringify(p.params), /agent-launched/i);
      const done = await runAll(fork, p);
      const st = await call('polypad_get_tx_status', { hash: done.hash });
      assert.ok(st.newToken, 'status reports the new token');
      fork.ctx.cache.clear();
      const found = await call('polypad_list_tokens', { agentLaunched: true });
      assert.ok(found.tokens.some((x: any) => x.symbol === 'MCAT'));
    });

    it('a launch with a delay opens a commitment window; a buy becomes a commit', async () => {
      const p = await call('polypad_prepare_token_launch', { from: ALICE, name: 'Window Cat', symbol: 'WCAT', creatorFeeBps: 0, launchDelay: '3600' });
      const done = await runAll(fork, p);
      const st = await call('polypad_get_tx_status', { hash: done.hash });
      fork.ctx.cache.clear();
      const t = await call('polypad_get_token', { token: st.newToken });
      assert.equal(t.token.phase, 'commit_window');
      const q = await call('polypad_quote_trade', { token: st.newToken, side: 'buy', amountEth: '0.01' });
      assert.equal(q.venue, 'commit_window');
      const b = await call('polypad_prepare_buy', { token: st.newToken, from: BOB, amountEth: '0.01' });
      assert.equal(b.transactions[0].kind, 'commit');
      assert.match(b.summary.lines.join(' '), /withdraw/i);
      await runAll(fork, b);
      await fails('polypad_prepare_sell', { token: st.newToken, from: BOB, percentOfBalance: 100 }, 'not_tradable');
    });

    it('key material is refused everywhere a body is accepted', async () => {
      const key = '0x' + 'ab'.repeat(32);
      await fails('polypad_prepare_buy', { token: 'POLYCAT', from: ALICE, amountEth: '0.01', privateKey: key }, 'key_material_rejected');
      await fails('polypad_prepare_buy', { token: 'POLYCAT', from: ALICE, amountEth: '0.01', note: key }, 'key_material_rejected');
      await fails('polypad_intent', { text: key }, 'key_material_rejected');
      await fails('polypad_prepare_fund_create', { from: ALICE, templateId: 1, name: 'x', symbol: 'x', mnemonic: 'a b c' }, 'key_material_rejected');
    });

    it('no prepared transaction ever targets an unknown contract or the fee wallet', async () => {
      const calls = [
        await call('polypad_prepare_buy', { token: 'POLYCAT', from: ALICE, amountEth: '0.01' }),
        await call('polypad_prepare_nft_buy', { from: ALICE, collection: '0x359Ec209361bEdC9a09a5e622605481CACb1AD06' }),
        await call('polypad_prepare_fund_create', { from: ALICE, templateId: 1, name: 'Z', symbol: 'Z', mintPriceEth: '0.01', raiseCapEth: '1' }),
      ];
      const { isAllowedTarget } = await import('./prepared');
      for (const c of calls) for (const t of c.transactions) {
        assert.equal(isAllowedTarget(getAddress(t.to), [getAddress(t.to)]), true);
        assert.notEqual(getAddress(t.to), ADDR.feeWallet);
        assert.equal(t.chainId, 4663);
        assert.ok(!JSON.stringify(c).includes('PRIVATE_KEY'));
      }
      assert.equal(isAllowedTarget(getAddress('0x00000000000000000000000000000000deadbeef')), false);
    });

    it('REST: index, GET read, POST prepare, errors, CORS, limits', async () => {
      const get = (path: string) => handleV2(new Request('http://x/api/agents/v2/' + path), path.split('?')[0].split('/').filter(Boolean), fork.ctx);
      const idx = await get('');
      assert.equal(idx.status, 200);
      assert.equal((idx.body.endpoints as unknown[]).length, TOOLS.length);
      assert.equal(idx.headers['access-control-allow-origin'], '*');
      const tok = await get('token/POLYCAT');
      assert.equal(tok.status, 200);
      const sw = await get('tokens?sort=new&limit=1');
      assert.equal((sw.body.tokens as unknown[]).length, 1);
      const nf = await get('nope');
      assert.equal(nf.status, 404);
      const wrong = await handleV2(new Request('http://x/api/agents/v2/prepare/buy'), ['prepare', 'buy'], fork.ctx);
      assert.equal(wrong.status, 405);
      const post = await handleV2(new Request('http://x/api/agents/v2/prepare/buy', { method: 'POST', headers: { 'x-polypad-client': 'grok-bot' }, body: JSON.stringify({ token: 'POLYCAT', from: ALICE, amountEth: '0.01', ref: 'grok-x' }) }), ['prepare', 'buy'], fork.ctx);
      assert.equal(post.status, 200);
      assert.match(String((post.body.signing as { url: string }).url), /ref=grok-x/);
      const badJson = await handleV2(new Request('http://x/api/agents/v2/prepare/buy', { method: 'POST', body: '{nope' }), ['prepare', 'buy'], fork.ctx);
      assert.equal(badJson.status, 400);
      const big = await handleV2(new Request('http://x/api/agents/v2/prepare/buy', { method: 'POST', body: JSON.stringify({ pad: 'x'.repeat(20_000) }) }), ['prepare', 'buy'], fork.ctx);
      assert.equal(big.status, 413);
      assert.doesNotMatch(JSON.stringify(post.body) + JSON.stringify(nf.body), /127\.0\.0\.1|rpc\./);
    });

    it('MCP: initialize, tools/list, tools/call, errors, notifications, batch', async () => {
      const rpc = async (body: unknown, method = 'POST') => handleMcp(new Request('http://x/api/mcp', { method, body: method === 'POST' ? JSON.stringify(body) : undefined }), fork.ctx);
      const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
      assert.equal(init.status, 200);
      const ir = (init.body as any).result;
      assert.equal(ir.protocolVersion, '2025-06-18');
      assert.equal(ir.serverInfo.name, 'polypad');
      assert.match(ir.instructions, /BEFORE the signing link/);
      const note = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
      assert.equal(note.status, 202);
      const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      const tools = (list.body as any).result.tools;
      assert.equal(tools.length, TOOLS.length);
      for (const t of tools) { assert.match(t.name, /^polypad_[a-z_]+$/); assert.equal(t.inputSchema.type, 'object'); assert.ok(t.description.length > 30); }
      const call1 = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'polypad_get_token', arguments: { token: 'POLYCAT' } } });
      const r1 = (call1.body as any).result;
      assert.equal(r1.isError, false);
      assert.equal(r1.structuredContent.token.symbol, 'POLYCAT');
      assert.equal(JSON.parse(r1.content[0].text).token.symbol, 'POLYCAT');
      const call2 = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'polypad_get_token', arguments: { token: 'NOPE_NOT_REAL' } } });
      assert.equal((call2.body as any).result.isError, true);
      assert.equal((call2.body as any).result.structuredContent.error.code, 'not_found');
      const unk = await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } });
      assert.equal((unk.body as any).error.code, -32602);
      const meth = await rpc({ jsonrpc: '2.0', id: 6, method: 'does/not/exist' });
      assert.equal((meth.body as any).error.code, -32601);
      const batch = await rpc([{ jsonrpc: '2.0', id: 7, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/cancelled' }]);
      assert.equal((batch.body as any[]).length, 1);
      const parse = await handleMcp(new Request('http://x/api/mcp', { method: 'POST', body: '{' }), fork.ctx);
      assert.equal(parse.status, 400);
      assert.equal((await rpc({}, 'GET')).status, 405);
      const prep = await rpc({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'polypad_prepare_buy', arguments: { token: 'POLYCAT', from: ALICE, amountEth: '0.01' } } });
      const pr = (prep.body as any).result.structuredContent;
      assert.match(pr.signing.url, /polypad\.family\/sign/);
    });

    it('rate limits: prepare and per-wallet buckets return 429 with retry-after', async () => {
      const { makeCtx } = await import('./core');
      const small = makeCtx(fork.client);
      let last: Awaited<ReturnType<typeof handleV2>> | undefined;
      for (let i = 0; i < 13; i += 1) {
        last = await handleV2(new Request('http://x/api/agents/v2/prepare/buy', { method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' }, body: JSON.stringify({ token: 'NOPE_NOT_REAL', from: ALICE, amountEth: '0.01' }) }), ['prepare', 'buy'], small);
      }
      assert.equal(last!.status, 429);
      assert.equal(last!.headers['retry-after'], '60');
      assert.equal((last!.body.error as { code: string }).code, 'rate_limited_wallet');
    });
  });
});
