// Build activity: manual refresh + pure-logic self test.
//   yarn tsx --require dotenv/config scripts/run-build.ts --selftest
//   yarn tsx --require dotenv/config scripts/run-build.ts [launch|token|SYMBOL ...]
import { prisma } from '../lib/db';
import { refreshBuild } from '../lib/buildact/refresh';
import { getBuildView } from '../lib/buildact/view';
import { filterCommits, scoreBuild, type RawCommit } from '../lib/buildact/score';
import { buildItem, buildLine, buildMessage, normaliseValue, parseRepo } from '../lib/buildact/shared';

const DAY = 86_400_000;
let fails = 0;
const check = (name: string, ok: boolean, extra = '') => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, extra); };

function selftest() {
  const now = Date.now();
  const c = (p: Partial<RawCommit>): RawCommit => ({ repo: 'a/b', sha: Math.random().toString(16).slice(2), message: 'Add staking view', author: 'dev', isBot: false, at: now - DAY, parents: 1, url: 'https://github.com/a/b', ahead: true, stats: { total: 20, files: ['src/a.ts'] }, ...p });
  const v = filterCommits([
    c({ message: 'Merge pull request #1 from x' }), c({ author: 'dependabot[bot]' }), c({ message: 'update' }),
    c({ ahead: false }), c({ stats: { total: 2, files: ['src/a.ts'] } }), c({ stats: { total: 40, files: ['README.md', 'yarn.lock'] } }), c({}),
  ]);
  check('filters: merge/bot/trivial/fork/tiny/docs', v.filter((x) => x.counted).length === 1, JSON.stringify(v.map((x) => x.reason)));
  const day = filterCommits(Array.from({ length: 14 }, (_, i) => c({ at: now - DAY + i * 4 * 60_000 })));
  check('cap 10 per author per day', day.filter((x) => x.counted).length === 10);
  const burst = filterCommits(Array.from({ length: 35 }, (_, i) => c({ author: `dev${i}`, at: Math.floor(now / 3_600_000) * 3_600_000 - 3_600_000 + i * 1000 })));
  check('burst >30/hour collapses to 1', burst.filter((x) => x.counted).length === 1);

  const base = { now, hasRepo: true, anyConfirmed: true, youngPostLaunchRepo: false, releases: [] as number[], contracts: [] as { at: number; verified: boolean }[] };
  const many = Array.from({ length: 25 }, (_, i) => ({ at: now - (i % 5) * DAY, author: `d${i % 4}` }));
  const full = scoreBuild({ ...base, commits: many, releases: [now - DAY, now - 2 * DAY, now - 3 * DAY], contracts: [1, 2, 3].map((k) => ({ at: now - k * DAY, verified: true })) });
  check('max 15 when confirmed', full.earned === 15 && full.status === 'shipping', String(full.earned));
  check('signature-only max 10', scoreBuild({ ...base, anyConfirmed: false, commits: many }).earned <= 10);
  check('young post-launch repo max 8', scoreBuild({ ...base, youngPostLaunchRepo: true, commits: many, releases: [now] }).earned <= 8);
  const noRepo = scoreBuild({ ...base, hasRepo: false, commits: [], contracts: [{ at: now - DAY, verified: true }] });
  check('no repo: on-chain only', noRepo.earned === 3 && noRepo.metrics.parts.code === 0, String(noRepo.earned));
  const at60 = scoreBuild({ ...base, commits: [{ at: now - 60 * DAY, author: 'a' }], contracts: [{ at: now - 60 * DAY, verified: true }] });
  check('decay 0.5 at 60d', at60.metrics.parts.decay === 0.5 && at60.status === 'slowing', JSON.stringify(at60.metrics.parts));
  const old = scoreBuild({ ...base, commits: [{ at: now - 200 * DAY, author: 'a' }] });
  check('0 after 180d, quiet, never negative', old.earned === 0 && old.status === 'quiet');
  check('none when nothing shipped', scoreBuild({ ...base, commits: [] }).status === 'none');
  check('pending item = neutral 7', buildItem(null).earned === 7 && buildItem({ pending: true, earned: 0, status: 'pending', metrics: null }).earned === 7);
  check('buildLine format', buildLine({ status: 'shipping', metrics: { lastShipAt: new Date(now - 3 * DAY).toISOString() } as any }) === 'Shipping · last ship 3d ago');
  check('parseRepo url', parseRepo('https://github.com/Foo/bar.git') === 'Foo/bar' && parseRepo('nope') === null);
  check('normaliseValue wallet', normaliseValue('link_wallet', '0xABCDEF0000000000000000000000000000000001') === '0xabcdef0000000000000000000000000000000001');
  const msg = buildMessage({ action: 'link_repo', token: '0xT', launch: '0xL', value: 'a/b', nonce: 'build:1', expires: 'x' });
  check('message has chain 4663 + nonce + repo', /Chain: 4663/.test(msg) && /Nonce: build:1/.test(msg) && /github\.com\/a\/b/.test(msg));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) { selftest(); console.log(fails ? `${fails} FAILED` : 'All build self-tests passed'); process.exit(fails ? 1 : 0); }
  const rows = await prisma.tokenCTO.findMany();
  const picked = rows.filter((r) => args.some((a) => [r.launchAddress, r.tokenAddress.toLowerCase()].includes(a.toLowerCase()) || a.toUpperCase() === r.symbol.toUpperCase()));
  for (const r of picked) {
    const t = Date.now();
    await refreshBuild(r, true);
    const v = await getBuildView(r.launchAddress);
    console.log(r.symbol, r.launchAddress, `${Date.now() - t}ms`, v.status, `earned ${v.earned}`, v.pending ? 'pending' : '', v.partial ? 'partial' : '');
    console.log(' metrics', JSON.stringify(v.metrics), 'flags', v.flags.map((f) => f.id).join(','), 'ships', v.ships.length, 'filtered', v.filteredCount, 'hey', v.heyUrl ?? '-');
    for (const s of v.ships.slice(0, 5)) console.log('  ', s.at.slice(0, 10), s.kind, s.title.slice(0, 70), s.url);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e?.message); process.exit(1); });
