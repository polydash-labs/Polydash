import { handleV2 } from './router';
async function main() {
  const p = process.argv[2];
  const method = process.argv[3] ?? 'GET';
  const body = process.argv[4];
  const r = await handleV2(new Request('http://x/api/agents/v2/' + p, { method, body, headers: { 'content-type': 'application/json' } }), p.split('?')[0].split('/').filter(Boolean));
  console.log(r.status, JSON.stringify(r.body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 1).slice(0, 6000));
}
main();
