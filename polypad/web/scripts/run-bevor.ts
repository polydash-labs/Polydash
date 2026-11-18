// Manual Bevor AI review for launches: yarn tsx --require dotenv/config scripts/run-bevor.ts [launch|SYMBOL ...]
// Advances each audit until it is no longer running (polls every ~2 min, max ~40 min).
import { prisma } from '../lib/db';
import { auditLaunch, getBevorAudit } from '../lib/bevor/audit';
import { bevorItem } from '../lib/bevor/shared';

async function main() {
  const args = process.argv.slice(2);
  const rows = await prisma.tokenCTO.findMany({ select: { launchAddress: true, tokenAddress: true, symbol: true } });
  const picked = args.length ? rows.filter((r) => args.some((a) => a.toLowerCase() === r.launchAddress || a.toUpperCase() === r.symbol.toUpperCase())) : rows;
  for (const r of picked) {
    for (let i = 0; i < 20; i++) {
      await auditLaunch(r.launchAddress, r.tokenAddress);
      const a = await getBevorAudit(r.launchAddress);
      console.log(new Date().toISOString().slice(11, 19), r.symbol, a?.status, a?.target ?? '', JSON.stringify(a && { c: a.critical, h: a.high, m: a.medium, l: a.low, n: a.nFindings }));
      if (a && a.status !== 'running' && a.status !== 'pending') { console.log('item:', bevorItem(a).label, bevorItem(a).ok ? `+${bevorItem(a).earned}` : '0'); break; }
      await new Promise((res) => setTimeout(res, 125_000));
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e?.message); process.exit(1); });
