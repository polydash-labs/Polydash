// Force an X-ray scan of every indexed launch (sequential) and print a one-line result each.
// Run: yarn tsx --require dotenv/config scripts/xray-scan-all.ts [max]
import { prisma } from '../lib/db';
import { scanLaunchXray, getXray } from '../lib/xray/scan';
import { ensureCto, FACTORIES } from '../lib/cto/chain';
import { publicClient } from '../lib/agents/tools';
import { PolydashFactoryABI } from '../lib/contracts/abis';

(async () => {
  const max = Number(process.argv[2] ?? 50);
  for (const f of FACTORIES) {
    const n = Number(await publicClient.readContract({ address: f, abi: PolydashFactoryABI, functionName: 'allLaunchesLength' }));
    for (let i = 0; i < n; i++) {
      const a = await publicClient.readContract({ address: f, abi: PolydashFactoryABI, functionName: 'allLaunches', args: [BigInt(i)] });
      await ensureCto(a as string).catch(() => null);
    }
    console.log('factory', f, 'launches', n);
  }
  const rows = await prisma.tokenCTO.findMany({ select: { launchAddress: true, symbol: true }, orderBy: { createdBlock: 'desc' }, take: max });
  console.log('launches', rows.length);
  for (const r of rows) {
    const t = Date.now();
    try {
      await scanLaunchXray(r.launchAddress, true);
      const x = await getXray(r.launchAddress);
      const st = await prisma.xrayResult.findUnique({ where: { launchAddress: r.launchAddress }, select: { state: true } });
      const f = Object.values(((st?.state as any)?.funding ?? {}) as Record<string, unknown>);
      console.log(r.symbol.padEnd(10), r.launchAddress, x?.level, 'partial', x?.partial, 'clusters', x?.clusters?.length ?? 0, 'funding', f.length, 'pending', f.filter((v) => v === 'pending').length, `${Date.now() - t}ms`);
    } catch (e) { console.log(r.symbol, r.launchAddress, 'ERROR', (e as Error).message); }
  }
  process.exit(0);
})();
