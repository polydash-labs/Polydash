// Token-launch path smoke check (read-only; no tx is sent, no files uploaded).
// Usage: yarn tsx scripts/launch-path-check.ts <baseUrl>
import { createPublicClient, http, zeroAddress, parseEther, type Address } from 'viem';
import { robinhoodChain } from '../lib/chain';
import { getFactoryAddress } from '../lib/contracts/addresses';
import { PolydashFactoryABI, PolydashLaunchABI } from '../lib/contracts/abis';
import { validatePool, defaultPool, poolFactoryAbi, approveAbi, POOL_FACTORY, type PoolForm } from '../app/agents/_components/forge';

const BASE = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const MOON_LAUNCH = '0xb023689bc81a4a54026441842346cc29c3f10527';
// PolyCat: launched on the current factory. Must resolve by token address and by launch address.
const POLYCAT_TOKEN = '0xf6E8D1902d42A7bB4432E9Bc28F88Bb87C1E1A79';
const POLYCAT_LAUNCH = '0x25d1049133e4647672880f513ad1aebcc4e150a8';
const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
let fails = 0;

async function hit(name: string, path: string, init?: RequestInit, check?: (status: number, body: string) => boolean) {
  const t = Date.now();
  try {
    const r = await fetch(path.startsWith('http') ? path : BASE + path, { ...init, signal: AbortSignal.timeout(60_000), headers: { 'user-agent': BROWSER_UA, ...(init?.headers ?? {}) } });
    const body = await r.text();
    const good = check ? check(r.status, body) : r.status === 200;
    if (!good) fails++;
    console.log(`${good ? 'PASS' : 'FAIL'}  ${name.padEnd(42)} ${r.status} ${Date.now() - t}ms${good ? '' : '  ' + body.slice(0, 120).replace(/\s+/g, ' ')}`);
  } catch (e) { fails++; console.log(`FAIL  ${name.padEnd(42)} ${(e as Error).message}`); }
}

async function main() {
  console.log('Base:', BASE);
  await hit('Explore (/)', '/');
  await hit('Create page (/create)', '/create', undefined, (s, b) => s === 200 && /Create|Launch/i.test(b));
  await hit('Token page ($MOON)', `/token/${MOON_LAUNCH}`);
  await hit('Token page (PolyCat token addr)', `/token/${POLYCAT_TOKEN}`, undefined, (s, b) => s === 200 && /<title>\$POLYCAT/.test(b));
  await hit('Token page (PolyCat launch addr)', `/token/${POLYCAT_LAUNCH}`, undefined, (s, b) => s === 200 && /<title>\$POLYCAT/.test(b));
  await hit('CTO report API (PolyCat token addr)', `/api/cto/${POLYCAT_TOKEN}`, undefined, (s, b) => s === 200 && b.includes(POLYCAT_LAUNCH));
  await hit('Promises API (PolyCat token addr)', `/api/promises/${POLYCAT_TOKEN}`, undefined, (s, b) => s === 200 && b.startsWith('{"promises"'));
  await hit('X-ray API (PolyCat token addr)', `/api/cto/${POLYCAT_TOKEN}/xray`, undefined, (s, b) => s === 200 && b.includes('"level"'));
  await hit('Explore lists PolyCat', '/', undefined, (s, b) => s === 200 && b.includes('Polycat'));
  await hit('Portfolio', '/portfolio');
  await hit('Leaderboard', '/leaderboard');
  await hit('About', '/about');
  await hit('Agents', '/agents', undefined, (s, b) => s === 200 && /PolyForge/.test(b));
  await hit('Agents staking form (?stake=)', `/agents?agent=polyforge&stake=${MOON_LAUNCH}`, undefined, (s, b) => s === 200 && /PolyForge/.test(b));
  await hit('X-ray API ($MOON)', `/api/cto/${MOON_LAUNCH}/xray`, undefined, (s, b) => s === 200 && b.startsWith('{'));
  await hit('Promises API ($MOON)', `/api/promises/${MOON_LAUNCH}`, undefined, (s, b) => s === 200 && b.startsWith('{'));
  await hit('ETH price API', '/api/eth-price', undefined, (s, b) => s === 200 && /\d/.test(b));
  await hit('Logo upload presign (Create step)', '/api/upload/logo', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ contentType: 'image/png', size: 1000 }) }, (s, b) => s === 200 && b.includes('"fields"'));
  await hit('Promise counts API', '/api/promises/counts');
  await hit('CTO report API ($MOON)', `/api/cto/${MOON_LAUNCH}`, undefined, (s, b) => s === 200 && b.includes('"report"'));
  await hit('Security scan API (Sourcify)', `/api/agents/tools/security?address=${MOON_LAUNCH}`);
  // Blockscout: the app only links to it from the browser (token/address/tx pages). Check a browser-style request works.
  await hit('Blockscout token page (browser link)', `https://robinhoodchain.blockscout.com/address/${MOON_LAUNCH}`);

  // Launch tx building + simulation: same args the Create wizard sends, as an eth_call (nothing is broadcast).
  const client = createPublicClient({ chain: robinhoodChain, transport: http() });
  const factory = getFactoryAddress();
  const t = Date.now();
  try {
    if (!factory) throw new Error('factory address not configured');
    const devBuy = parseEther('0');
    const { result } = await client.simulateContract({
      account: '0x351BDe628892Aeb055F717300DBd2848af178479', address: factory, abi: PolydashFactoryABI, functionName: 'createLaunch', value: devBuy,
      args: [{ name: 'Path Check', symbol: 'PCHK', imageUri: '', description: 'simulation only', socialLinks: [], creatorFeeBps: BigInt(100), creatorPayoutWallet: zeroAddress, devBuyEth: devBuy, totalSupply: BigInt(0), virtualEthReserve: BigInt(0), launchDelay: BigInt(86400) }],
    });
    console.log(`PASS  ${'createLaunch simulation (eth_call)'.padEnd(42)} ${Date.now() - t}ms  -> ${JSON.stringify(result, (_, v) => (typeof v === 'bigint' ? v.toString() : v)).slice(0, 100)}`);
  } catch (e) { fails++; console.log(`FAIL  createLaunch simulation: ${(e as Error).message.split('\n')[0]}`); }

  // Trade: simulate a 0.001 ETH buy on PolyCat with the quoted output as the minimum (eth_call; nothing is broadcast).
  const tb = Date.now();
  try {
    const value = parseEther('0.001');
    const { result } = await client.simulateContract({ account: '0x351BDe628892Aeb055F717300DBd2848af178479', address: POLYCAT_LAUNCH, abi: PolydashLaunchABI, functionName: 'buy', args: [BigInt(1)], value,
      // eth_call only: give the simulated caller enough ETH for gas + value.
      stateOverride: [{ address: '0x351BDe628892Aeb055F717300DBd2848af178479', balance: parseEther('1') }] });
    console.log(`PASS  ${'buy simulation (PolyCat, 0.001 ETH)'.padEnd(42)} ${Date.now() - tb}ms  -> tokensOut ${String(result)}`);
  } catch (e) { fails++; console.log(`FAIL  buy simulation: ${(e as Error).message.split('\n')[0]}`); }

  await stakingChecks(client);
  await stakePageChecks(client);

  console.log(fails ? `\n${fails} check(s) failed` : '\nAll launch-path checks passed');
  process.exit(fails ? 1 : 0);
}
// Staking pool creation (PolyForge): form validation via the same validatePool the UI uses, then approve + createPool
// simulated in sequence (eth_simulateV1; nothing is broadcast). The launch contract is used as a token-holding account.
async function stakingChecks(client: ReturnType<typeof createPublicClient>) {
  const token = (await client.readContract({ address: MOON_LAUNCH, abi: PolydashLaunchABI, functionName: 'token' })) as Address;
  const holder = MOON_LAUNCH as Address;
  const base: PoolForm = { ...defaultPool, stakeToken: token, rewardAmount: '1000', name: 'Path check pool', description: 'simulation only' };
  const cases: [string, Partial<PoolForm>, Address | undefined, RegExp][] = [
    ['no wallet connected', {}, undefined, /Connect your wallet/],
    ['empty reward amount', { rewardAmount: '' }, holder, /Reward amount is not a valid number/],
    ['zero reward amount', { rewardAmount: '0' }, holder, /greater than 0/],
    ['negative reward amount', { rewardAmount: '-5' }, holder, /not a valid number|greater than 0/],
    ['non-numeric reward amount', { rewardAmount: 'abc' }, holder, /not a valid number/],
    ['invalid max total stake', { maxTotalStake: '1e5x' }, holder, /Max total stake is not a valid number/],
    ['invalid stake token address', { stakeToken: '0x123' }, holder, /Stake token is not a valid address/],
    ['empty pool name', { name: '  ' }, holder, /Pool name is required/],
    ['duration 0 days', { durationDays: '0' }, holder, /Duration must be between/],
    ['claim fee 50 bps (below min)', { claimFeeBps: '50' }, holder, /Claim fee must be/],
    ['reward above balance', { rewardAmount: '999999999999999' }, holder, /below the reward amount/],
  ];
  for (const [label, patch, acct, expect] of cases) {
    const { errors, plan } = await validatePool({ ...base, ...patch }, acct);
    const good = !plan && errors.some((e) => expect.test(e));
    if (!good) fails++;
    console.log(`${good ? 'PASS' : 'FAIL'}  ${('Staking validation: ' + label).padEnd(42)} ${errors[0] ?? '(no error)'}`);
  }
  const t = Date.now();
  try {
    const { errors, plan } = await validatePool(base, holder);
    if (!plan) throw new Error('valid form rejected: ' + errors.join('; '));
    const steps = plan.steps;
    if (steps[steps.length - 1].functionName !== 'createPool' || steps[steps.length - 1].to !== POOL_FACTORY) throw new Error('unexpected tx plan');
    const sim = (await client.simulateCalls({
      account: holder,
      calls: steps.map((s) => ({ to: s.to, abi: (s.functionName === 'approve' ? approveAbi : poolFactoryAbi) as never, functionName: s.functionName as never, args: s.args as never, value: s.value })) as never,
    })) as unknown as { results: { status: string; result?: unknown; error?: Error }[] };
    const results = sim.results;
    const bad = results.find((r) => r.status !== 'success');
    if (bad) throw new Error(`simulated call reverted: ${bad.error?.message?.split('\n')[0] ?? 'unknown'}`);
    console.log(`PASS  ${'Staking: approve + createPool simulation'.padEnd(42)} ${Date.now() - t}ms  steps=${steps.map((s) => s.functionName).join('+')} pool=${String(results[results.length - 1].result)}`);
  } catch (e) { fails++; console.log(`FAIL  Staking createPool simulation: ${(e as Error).message.split('\n')[0]}`); }
}

// Staking page: routes + API numbers for the live 1M POLYDASH pool, then approve+stake, withdraw, claim and exit
// simulated in sequence with the page's own ABI (eth_simulateV1; nothing is broadcast).
const LIVE_POOL = '0xb2bbc1752faa5bcfc67571819af30ce2aaf58518' as Address;
const POLYDASH = '0x319525528f42167ef7fc18b77b889958080568e4' as Address;
const POLYDASH_HOLDER = '0x0f5004' as const; // resolved below from the pools API (an existing POLYDASH pool holds tokens)
async function stakePageChecks(client: ReturnType<typeof createPublicClient>) {
  await hit('Stake page (/stake)', '/stake', undefined, (s, b) => s === 200 && b.includes('Stake. Earn every second.'));
  await hit('Stake page token filter', `/stake?token=${POLYDASH}`);
  await hit('Pool detail page (1M POLYDASH pool)', `/stake/${LIVE_POOL}`);
  let holder: Address | undefined;
  await hit('Stake pools API lists 1M pool', '/api/stake/pools', undefined, (s, b) => {
    if (s !== 200) return false;
    const d = JSON.parse(b) as { pools: { address: string; totalRewards: number; featured: boolean; stake: { address: string } }[] };
    holder = d.pools.find((p) => p.address.toLowerCase().startsWith(POLYDASH_HOLDER))?.address as Address | undefined;
    const p = d.pools.find((x) => x.address.toLowerCase() === LIVE_POOL);
    return !!p && p.totalRewards === 1_000_000 && p.featured && p.stake.address.toLowerCase() === POLYDASH;
  });
  await hit('Stake pools API (token filter)', `/api/stake/pools?token=${POLYDASH}`, undefined, (s, b) => s === 200 && b.toLowerCase().includes(LIVE_POOL));
  await hit('Pool detail API (1M pool)', `/api/stake/${LIVE_POOL}`, undefined, (s, b) => s === 200 && b.includes('"series"'));
  await hit('Pool detail API (not a pool) -> 404', `/api/stake/0x0000000000000000000000000000000000000001`, undefined, (s) => s === 404);

  const t = Date.now();
  try {
    if (!holder) throw new Error('no POLYDASH holder found');
    const { stakingPoolAbi, erc20Abi } = await import('../lib/staking/shared');
    const amt = parseEther('1000');
    const half = parseEther('400');
    const pool = { to: LIVE_POOL, abi: stakingPoolAbi };
    const sim = (await client.simulateCalls({
      account: holder,
      calls: [
        { to: POLYDASH, abi: erc20Abi, functionName: 'approve', args: [LIVE_POOL, amt] },
        { ...pool, functionName: 'stake', args: [amt] },
        { ...pool, functionName: 'balanceOf', args: [holder] },
        { ...pool, functionName: 'withdraw', args: [half] },
        { ...pool, functionName: 'claim' },
        { ...pool, functionName: 'exit' },
        { ...pool, functionName: 'balanceOf', args: [holder] },
      ] as never,
    })) as unknown as { results: { status: string; result?: unknown; error?: Error }[] };
    const names = ['approve', 'stake', 'shares', 'withdraw', 'claim', 'exit', 'sharesAfter'];
    const bad = sim.results.findIndex((r) => r.status !== 'success');
    if (bad >= 0) throw new Error(`${names[bad]} reverted: ${sim.results[bad].error?.message?.split('\n')[0] ?? 'unknown'}`);
    const shares = sim.results[2].result as bigint, after = sim.results[6].result as bigint;
    if (shares !== amt || after !== BigInt(0)) throw new Error(`unexpected shares ${shares} / after exit ${after}`);
    console.log(`PASS  ${'1M pool: approve+stake, withdraw, claim, exit'.padEnd(42)} ${Date.now() - t}ms  shares=${shares} after exit=${after}`);
  } catch (e) { fails++; console.log(`FAIL  1M pool stake simulation: ${(e as Error).message.split('\n')[0]}`); }
}

main();
