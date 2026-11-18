// List X-ray results (level, partial, pending funding count). Run: yarn tsx --require dotenv/config scripts/xray-status.ts
import { prisma } from '../lib/db';

(async () => {
  const rows = await prisma.xrayResult.findMany({ select: { launchAddress: true, level: true, partial: true, earlyWindowFrozen: true, state: true, stats: true } });
  for (const r of rows) {
    const f = ((r.state as any)?.funding ?? {}) as Record<string, unknown>;
    const vals = Object.values(f);
    console.log(r.launchAddress, r.level, 'partial', r.partial, 'frozen', r.earlyWindowFrozen, 'funding', vals.length, 'pending', vals.filter((v) => v === 'pending').length, 'clusters', (r.stats as any)?.clusterCount ?? '?');
  }
  console.log('funding cache rows', await prisma.xrayFunding.count());
  process.exit(0);
})();
