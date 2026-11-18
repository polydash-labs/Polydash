// Holder Protections tier self-test: pure mocks + one live factory read for MOON.
// Run: yarn tsx --require dotenv/config scripts/test-hp-tier.ts
import { evaluateHolderProtections, readCreatorFactors, type HpInputs } from '@/lib/holder-protections';
import { STATUS_SLASHED } from '@/lib/bond';

const MOON_TOKEN = '0x196784337bE954268c7d793D20b4b572a4126049';
const A = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
const NOW = new Date('2026-11-01T12:00:00Z');
const now = Math.floor(NOW.getTime() / 1000);
const DAY = 86_400;
const ETH = BigInt(10) ** BigInt(18);

const base: HpInputs = {
  launch: { launchAddress: A(1), tokenAddress: A(2), graduated: false },
  staking: { state: 'none', pools: [] },
  review: { status: 'completed', target: A(2), critical: 0, high: 0, medium: 0 },
  source: { verified: true, known: true, via: 'blockscout', address: A(2), url: 'https://example.invalid/a' } as any,
  vesting: { vaults: [], totalSupply: BigInt(1_000_000) * ETH },
  bond: { bonds: [] },
};
const creatorPool = { state: 'committed' as const, pools: [{ pool: A(9), creator: A(3), byCreator: true, endTime: now + 30 * DAY, active: true }] };
const vault = { vaults: [{ address: A(10), meets: true, locked: BigInt(50_000) * ETH, cliffEnd: now + 30 * DAY, endTime: now + 180 * DAY }], totalSupply: BigInt(1_000_000) * ETH };
const goodBond = { bonds: [{ address: A(11), status: 1, amount: ETH / BigInt(10), duration: 90 * DAY, endTime: now + 90 * DAY }] };
const brokenBond = { bonds: [{ address: A(12), status: STATUS_SLASHED, amount: ETH, duration: 90 * DAY, endTime: now + 60 * DAY }] };

const cases: [string, HpInputs, string | null, string?][] = [
  ['security only (MOON shape)', base, null],
  ['security + creator pool', { ...base, staking: creatorPool }, 'bronze'],
  ['+ graduated + vesting', { ...base, staking: creatorPool, launch: { ...base.launch!, graduated: true }, vesting: vault }, 'silver'],
  ['all 5', { ...base, staking: creatorPool, launch: { ...base.launch!, graduated: true }, vesting: vault, bond: goodBond }, 'gold'],
  ['all 5 but staking unknown', { ...base, staking: null, launch: { ...base.launch!, graduated: true }, vesting: vault, bond: goodBond }, null],
  ['all but vesting read error', { ...base, staking: creatorPool, launch: { ...base.launch!, graduated: true }, vesting: 'error', bond: goodBond }, null],
  ['broken bond', { ...base, staking: creatorPool, launch: { ...base.launch!, graduated: true }, vesting: vault, bond: brokenBond }, null, 'Bond broken'],
  ['unverified source', { ...base, staking: creatorPool, launch: { ...base.launch!, graduated: true }, vesting: vault, bond: goodBond, source: { ...(base.source as any), verified: false } }, null],
];

let fails = 0;
for (const [name, input, want, detail] of cases) {
  const hp = evaluateHolderProtections(input, NOW);
  const bondRow = hp.checks.find((c) => c.id === 'creator_bond')!;
  const ok = hp.tier === want && hp.allPassed === (want === 'gold') && hp.total === 5 && hp.checks.length === 5 && (!detail || bondRow.detail === detail);
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: tier=${hp.tier} passed=${hp.passed}/5 [${hp.checks.map((c) => `${c.id}:${c.status}`).join(', ')}]${detail ? ` bond="${bondRow.detail}"` : ''}`);
}

(async () => {
  console.log('\nLive factory read for MOON:');
  const f = await readCreatorFactors([MOON_TOKEN]);
  const r = f.get(MOON_TOKEN.toLowerCase());
  console.log(`MOON vesting=${JSON.stringify(r?.vesting, (_, v) => (typeof v === 'bigint' ? v.toString() : v))} bond=${JSON.stringify(r?.bond)}`);
  if (!r || r.vesting === 'error' || r.bond === 'error') fails++;
  console.log(fails ? `\n${fails} failure(s)` : '\nAll checks passed');
  process.exit(fails ? 1 : 0);
})();
