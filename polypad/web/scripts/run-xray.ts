// Manual X-ray scan for one launch: yarn tsx --require dotenv/config scripts/run-xray.ts [launch]
import { scanLaunchXray, getXray } from '../lib/xray/scan';

async function main() {
  const launch = (process.argv[2] ?? '0xb023689bc81a4a54026441842346cc29c3f10527').toLowerCase();
  const t = Date.now();
  await scanLaunchXray(launch, true);
  console.log('scan ms', Date.now() - t);
  const x = await getXray(launch);
  console.log(JSON.stringify({ ...x, clusters: x?.clusters?.map((c) => ({ ...c, wallets: c.wallets.slice(0, 3) })) }, null, 2).slice(0, 6000));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
