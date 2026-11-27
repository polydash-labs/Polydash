import { neon } from '@neondatabase/serverless';
import fs from 'fs';

const pw = encodeURIComponent(fs.readFileSync('/tmp/neon-pw.txt', 'utf8').trim());
const pooled = `postgresql://neondb_owner:${pw}@ep-orange-unit-bb5htwlw-pooler.c-15.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require`;
const direct = `postgresql://neondb_owner:${pw}@ep-orange-unit-bb5htwlw.c-15.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require`;

async function test(label, url) {
  try {
    const sql = neon(url);
    const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`;
    console.log(label, 'connected. tables:', tables.map((t) => t.table_name).join(', '));
    for (const t of ['AgentApiKey', 'ApiKeyUsage']) {
      try {
        const r = await sql.query(`SELECT COUNT(*)::int AS c FROM "${t}"`);
        console.log(label, ` ${t}:`, r[0].c, 'rows');
      } catch (e) {
        console.log(label, ` ${t}: query failed:`, String(e).split('\n')[0].slice(0, 120));
      }
    }
  } catch (e) {
    console.log(label, 'FAILED:', String(e).split('\n')[0].slice(0, 200));
  }
}

await test('pooled', pooled);
await test('direct', direct);
