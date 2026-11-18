// Manual check: resolve first-funding for a few wallets via X-ray's Blockscout client.
// Usage: yarn tsx --require dotenv/config scripts/xray-funding-probe.ts <addr> [addr...]
import { getFunding } from '../lib/xray/blockscout';

(async () => {
  for (const a of process.argv.slice(2)) {
    const t = Date.now();
    try { console.log(a, JSON.stringify(await getFunding(a)), `${Date.now() - t}ms`); }
    catch (e) { console.log(a, 'ERROR', (e as Error).message, `${Date.now() - t}ms`); }
  }
  process.exit(0);
})();
