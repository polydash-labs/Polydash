import assert from 'node:assert/strict';
import test from 'node:test';
import { getAddress, parseEther } from 'viem';
import { FundFactoryABI, FundFactoryInvestABI } from '../contracts/fund-abi';
import { FUND_FACTORY_ADDRESS, getFundFactoryAddress } from './address';
import {
  DEFAULT_FUND_DRAFT,
  MAX_MINT_PRICE,
  MIN_MINT_PRICE,
  bpsLabel,
  feeOn,
  filterFunds,
  formatFundEth,
  formatTokenAmount,
  fundStatus,
  fundTxError,
  mandateHashFor,
  parseAssetList,
  previewDraft,
  previewSupply,
  quoteMint,
  skinRequiredCount,
  sortFunds,
  utf8Size,
  type FundListItem,
} from './model';

const ETHER = 10n ** 18n;

test('recorded factory address is checksummed', () => {
  assert.equal(getAddress(FUND_FACTORY_ADDRESS), '0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878');
  assert.equal(FUND_FACTORY_ADDRESS, '0x6c0094BA60DaA0467Daf81f4D576d74DD3a08878');
});

test('factory address falls back when env is unset or zero', () => {
  const previous = process.env.NEXT_PUBLIC_FUND_FACTORY_ADDRESS;
  delete process.env.NEXT_PUBLIC_FUND_FACTORY_ADDRESS;
  assert.equal(getFundFactoryAddress(), FUND_FACTORY_ADDRESS);
  process.env.NEXT_PUBLIC_FUND_FACTORY_ADDRESS = '0x0000000000000000000000000000000000000000';
  assert.equal(getFundFactoryAddress(), FUND_FACTORY_ADDRESS);
  process.env.NEXT_PUBLIC_FUND_FACTORY_ADDRESS = '0x0000000000000000000000000000000000000001';
  assert.equal(getFundFactoryAddress(), '0x0000000000000000000000000000000000000001');
  if (previous === undefined) delete process.env.NEXT_PUBLIC_FUND_FACTORY_ADDRESS;
  else process.env.NEXT_PUBLIC_FUND_FACTORY_ADDRESS = previous;
});

test('createFund argument order matches FundFactory.Params', () => {
  const fn = FundFactoryABI.find((item) => item.type === 'function' && item.name === 'createFund');
  assert.ok(fn && fn.type === 'function');
  if (!fn || fn.type !== 'function') return;
  const tuple = fn.inputs[0];
  assert.equal(tuple?.type, 'tuple');
  if (tuple?.type !== 'tuple') return;
  assert.deepEqual(tuple.components.map((component) => component.name), [
    'name', 'symbol', 'imageUri', 'baseURI', 'mintPrice', 'raiseCap', 'entryFeeBps', 'minSkinBps',
  ]);
});

test('supply preview rounds down and reports leftover wei', () => {
  const price = parseEther('0.01');
  const { maxSupply, dust } = previewSupply(parseEther('1'), price);
  assert.equal(maxSupply, 100n);
  assert.equal(dust, 0n);
  const odd = previewSupply(parseEther('1') + 1n, price);
  assert.equal(odd.maxSupply, 100n);
  assert.equal(odd.dust, 1n);
});

test('manager share rounds up, with a floor of one NFT', () => {
  assert.equal(skinRequiredCount(1n, 500n), 1n);
  assert.equal(skinRequiredCount(2n, 500n), 1n);
  assert.equal(skinRequiredCount(20n, 500n), 1n);
  assert.equal(skinRequiredCount(21n, 500n), 2n);
  assert.equal(skinRequiredCount(100n, 500n), 5n);
  assert.equal(skinRequiredCount(10_000n, 500n), 500n);
  assert.equal(skinRequiredCount(100n, 0n), 5n);
});

test('default draft is 100 NFTs, 5 for the manager, and sends the factory default', () => {
  const result = previewDraft({ ...DEFAULT_FUND_DRAFT, name: 'Example Fund', symbol: 'EX', mandateText: 'Hold WETH.', mandateUri: 'ipfs://QmMandate' });
  assert.equal(result.issues.length, 0);
  assert.ok(result.params);
  assert.equal(result.params?.maxSupply, 100n);
  assert.equal(result.params?.dust, 0n);
  assert.equal(result.params?.skinRequired, 5n);
  assert.equal(result.params?.skinBps, 500n);
  assert.equal(result.params?.minSkinBps, 0n);
  assert.equal(result.params?.managerEth, parseEther('0.05'));
  assert.equal(result.params?.protocolFeeOnManagerMint, parseEther('0.0001'));
  assert.equal(result.params?.protocolFeeOnFullRaise, parseEther('0.002'));
  assert.equal(result.params?.entryFeeBps, 0n);
});

test('a higher manager share is sent as basis points', () => {
  const result = previewDraft({ ...DEFAULT_FUND_DRAFT, name: 'Example', symbol: 'EX', skinBps: 1000, mandateText: 'Hold WETH.', mandateUri: 'ipfs://QmMandate' });
  assert.equal(result.params?.minSkinBps, 1000n);
  assert.equal(result.params?.skinRequired, 10n);
});

test('contract bounds reject names, prices, supply, and fees', () => {
  const base = { ...DEFAULT_FUND_DRAFT, name: 'Example', symbol: 'EX', mandateText: 'Hold WETH.', mandateUri: 'ipfs://QmMandate' };
  assert.ok(previewDraft({ ...base, name: '' }).issues.some((issue) => issue.field === 'name'));
  assert.ok(previewDraft({ ...base, name: 'a'.repeat(65) }).issues.some((issue) => issue.field === 'name'));
  assert.equal(previewDraft({ ...base, name: 'a'.repeat(64) }).issues.some((issue) => issue.field === 'name'), false);
  assert.equal(utf8Size('👍'), 4);
  assert.ok(previewDraft({ ...base, name: '👍'.repeat(17) }).issues.some((issue) => issue.field === 'name'));
  assert.ok(previewDraft({ ...base, symbol: 'S'.repeat(17) }).issues.some((issue) => issue.field === 'symbol'));
  assert.ok(previewDraft({ ...base, mintPriceEth: '0.000009' }).issues.some((issue) => issue.field === 'mintPriceEth'));
  assert.equal(previewDraft({ ...base, mintPriceEth: '0.00001' }).issues.some((issue) => issue.field === 'mintPriceEth'), false);
  assert.ok(previewDraft({ ...base, mintPriceEth: '100.0000000000000000001' }).issues.some((issue) => issue.message.includes('18 decimal')));
  assert.equal(MIN_MINT_PRICE, parseEther('0.00001'));
  assert.equal(MAX_MINT_PRICE, parseEther('100'));
  const huge = previewDraft({ ...base, mintPriceEth: '0.00001', raiseCapEth: '0.10001' });
  assert.ok(huge.issues.some((issue) => issue.message.includes('10,000')));
  assert.equal(huge.preview?.maxSupply, 10_001n);
  assert.ok(previewDraft({ ...base, entryFeeBps: 501 }).issues.some((issue) => issue.field === 'entryFeeBps'));
  assert.ok(previewDraft({ ...base, skinBps: 499 }).issues.some((issue) => issue.field === 'skinBps'));
  assert.equal(previewDraft({ ...base, entryFeeBps: 500, skinBps: 10_000 }).params?.skinRequired, 100n);
});

test('mint quote floors the protocol fee and the entry fee separately', () => {
  const quote = quoteMint(parseEther('0.01'), 1n, 500n);
  assert.equal(quote.cost, parseEther('0.01'));
  assert.equal(quote.protocolFee, parseEther('0.00002'));
  assert.equal(quote.entryFee, parseEther('0.0005'));
  assert.equal(quote.staysInVault, quote.cost - quote.protocolFee - quote.entryFee);
  assert.equal(quote.failedRaiseRefund, quote.staysInVault);
  assert.ok(quote.failedRaiseRefund < quote.cost);
  assert.equal(quote.failedRaiseRefund + quote.protocolFee + quote.entryFee, quote.cost);
  assert.equal(feeOn(1n, 20n), 0n);
});

test('status follows the vault and the manager gate', () => {
  assert.equal(fundStatus(0, false), 'waiting');
  assert.equal(fundStatus(0, true), 'open');
  assert.equal(fundStatus(1, true), 'closed');
  assert.equal(fundStatus(1, false), 'closed');
  assert.equal(fundStatus(2, true), 'investing');
  assert.equal(fundStatus(2, false), 'investing');
});

test('list filters and sorts do not change the source order in place', () => {
  const items: FundListItem[] = [
    { address: '0xaaa', index: 0, name: 'Alpha', symbol: 'ALP', manager: '0x1111111111111111111111111111111111111111', status: 'waiting', vaultStatus: 0, raised: 2n },
    { address: '0xbbb', index: 1, name: 'Beta', symbol: 'BET', manager: '0x2222222222222222222222222222222222222222', status: 'open', vaultStatus: 0, raised: 5n },
    { address: '0xccc', index: 2, name: 'Gamma', symbol: 'GAM', manager: '0x1111111111111111111111111111111111111111', status: 'closed', vaultStatus: 1, raised: 1n },
    { address: '0xddd', index: 3, name: 'Delta', symbol: 'DEL', manager: '0x1111111111111111111111111111111111111111', status: 'closed', vaultStatus: 3, raised: 1n },
  ];
  const newest = sortFunds(items, 'newest').map((item) => item.symbol);
  assert.deepEqual(newest, ['DEL', 'GAM', 'BET', 'ALP']);
  assert.deepEqual(items.map((item) => item.symbol), ['ALP', 'BET', 'GAM', 'DEL']);
  assert.deepEqual(sortFunds(items, 'raised').map((item) => item.symbol), ['BET', 'ALP', 'DEL', 'GAM']);
  assert.deepEqual(filterFunds(items, 'open', '').map((item) => item.symbol), ['BET']);
  assert.deepEqual(filterFunds(items, 'refund', '').map((item) => item.symbol), ['DEL']);
  assert.deepEqual(filterFunds(items, 'closed', '').map((item) => item.symbol), ['GAM', 'DEL']);
  assert.deepEqual(filterFunds(items, 'mine', '', '0x1111111111111111111111111111111111111111').map((item) => item.symbol), ['ALP', 'GAM', 'DEL']);
  assert.deepEqual(filterFunds(items, 'mine', ''), []);
  assert.deepEqual(filterFunds(items, 'all', 'bet').map((item) => item.symbol), ['BET']);
  assert.deepEqual(filterFunds(items, 'all', '0xccc').map((item) => item.symbol), ['GAM']);
});

test('plain labels and wallet errors stay short', () => {
  assert.equal(bpsLabel(0), '0%');
  assert.equal(bpsLabel(500), '5%');
  assert.equal(bpsLabel(250), '2.5%');
  assert.equal(formatFundEth(parseEther('0.00001')), '0.00001');
  assert.equal(formatFundEth(parseEther('1')), '1');
  assert.equal(formatFundEth(0n), '0');
  assert.equal(fundTxError('User rejected the request'), 'Transaction cancelled');
  assert.equal(fundTxError('execution reverted: SkinRequired()'), 'The manager has to mint their share before anyone else can.');
  assert.equal(fundTxError('x'.repeat(400)), 'Transaction failed.');
});

test('token amounts format in the token’s own decimals', () => {
  assert.equal(formatTokenAmount(1_000_000n, 6), '1');
  assert.equal(formatTokenAmount(1_500_000n, 6), '1.5');
  assert.equal(formatTokenAmount(0n, 6), '0');
  assert.equal(formatTokenAmount(parseEther('1.5'), 18), '1.5');
  assert.equal(formatTokenAmount(1_234_567_890_123n, 8), '12,345.67890123');
});

test('investing draft requires a mandate, a link, a duration, and caps', () => {
  const base = { ...DEFAULT_FUND_DRAFT, name: 'Example', symbol: 'EX' };
  const empty = previewDraft(base);
  assert.ok(empty.issues.some((issue) => issue.field === 'mandateText'));
  assert.ok(empty.issues.some((issue) => issue.field === 'mandateUri'));
  assert.equal(empty.params, null);

  const badUri = previewDraft({ ...base, mandateText: 'Hold WETH.', mandateUri: 'example.com/mandate' });
  assert.ok(badUri.issues.some((issue) => issue.field === 'mandateUri'));
  const badDays = previewDraft({ ...base, mandateText: 'Hold WETH.', mandateUri: 'ipfs://mandate', raiseDurationDays: '31' });
  assert.ok(badDays.issues.some((issue) => issue.field === 'raiseDurationDays'));
  const badAsset = previewDraft({ ...base, mandateText: 'Hold WETH.', mandateUri: 'ipfs://mandate', assetsText: 'not-an-address' });
  assert.ok(badAsset.issues.some((issue) => issue.field === 'assetsText'));
  const badCap = previewDraft({ ...base, mandateText: 'Hold WETH.', mandateUri: 'ipfs://mandate', maxPositionBps: 10_001 });
  assert.ok(badCap.issues.some((issue) => issue.field === 'maxPositionBps'));

  const ok = previewDraft({
    ...base,
    mandateText: 'Hold WETH and up to 60% USDC. No leverage.',
    mandateUri: 'ipfs://QmMandate',
    raiseDurationDays: '7',
    assetsText: '0x0000000000000000000000000000000000000002',
  });
  assert.equal(ok.issues.length, 0);
  assert.equal(ok.params?.mandateHash, mandateHashFor('Hold WETH and up to 60% USDC. No leverage.'));
  assert.equal(ok.params?.mandateUri, 'ipfs://QmMandate');
  assert.equal(ok.params?.raiseDuration, 7n * 86_400n);
  assert.deepEqual(ok.params?.assets, ['0x0000000000000000000000000000000000000002']);
  assert.equal(ok.params?.maxPositionBps, 7500n);
  assert.equal(ok.params?.maxTradeBps, 7500n);
  assert.equal(ok.params?.maxDeviationBps, 5000n);
});

test('mandate hash is keccak256 of the text and asset list rejects duplicates', () => {
  const hash = mandateHashFor('Hold WETH.');
  assert.match(hash, /^0x[0-9a-f]{64}$/);
  assert.equal(mandateHashFor('Hold WETH.'), hash);
  assert.notEqual(mandateHashFor('Hold WETH.'), mandateHashFor('Hold USDC.'));
  const parsed = parseAssetList('0x0000000000000000000000000000000000000002\n0x0000000000000000000000000000000000000003');
  assert.equal(parsed.ok, true);
  assert.equal(parseAssetList('0x0000000000000000000000000000000000000002\n0x0000000000000000000000000000000000000002').ok, false);
  assert.equal(parseAssetList('').ok, true);
});

test('createFund argument order matches FundFactoryInvest.Params', () => {
  const fn = FundFactoryInvestABI.find((item) => item.type === 'function' && item.name === 'createFund');
  assert.ok(fn && fn.type === 'function');
  if (!fn || fn.type !== 'function') return;
  const tuple = fn.inputs[0];
  assert.equal(tuple?.type, 'tuple');
  if (tuple?.type !== 'tuple') return;
  assert.deepEqual(tuple.components.map((component) => component.name), [
    'name', 'symbol', 'imageUri', 'baseURI', 'mintPrice', 'raiseCap', 'entryFeeBps', 'minSkinBps',
    'raiseDuration', 'mandateHash', 'assets', 'mandateUri', 'maxPositionBps', 'maxTradeBps', 'maxDeviationBps',
  ]);
});

test('cap and deadline errors map to plain language', () => {
  assert.match(fundTxError('execution reverted: PositionCap()'), /single-asset cap/);
  assert.match(fundTxError('execution reverted: TradeCap()'), /per-trade cap/);
  assert.match(fundTxError('execution reverted: Deviation()'), /feed price/);
  assert.match(fundTxError('execution reverted: TooSoon()'), /once an hour/);
  assert.match(fundTxError('execution reverted: RaiseEnded()'), /deadline/);
});
