// Warden queue admin — run by Atlas/Warden from this VM, no human in the loop.
//   node scripts/warden-audit-update.mjs --id <cuid> [--status queued|in_review|reviewed] [--verdict green|yellow|red] [--report-url <url>]
//   node scripts/warden-audit-update.mjs --id <cuid> --delete
// Marking a request reviewed requires a verdict; reviewedAt is set
// automatically. --delete removes the row (test cleanup / withdrawn request).
// Uses the @neondatabase/serverless HTTPS driver (same as apply-neon-ddl.mjs):
// this VM cannot complete a direct Postgres TLS handshake (egress proxy), so
// Prisma cannot run here. Reads DATABASE_URL_UNPOOLED from .env.local; the
// connection string is never printed.
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const STATUSES = ['queued', 'in_review', 'reviewed'];
const VERDICTS = ['green', 'yellow', 'red'];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function getSql() {
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  const match = env.match(/^DATABASE_URL_UNPOOLED=(.+)$/m);
  if (!match) {
    console.error('DATABASE_URL_UNPOOLED not found in .env.local');
    process.exit(1);
  }
  const connStr = match[1].trim().replace(/^"|"$/g, '').replace(/&channel_binding=require/, '');
  return neon(connStr);
}

async function main() {
  const id = arg('id');
  if (!id) {
    console.error('Usage: warden-audit-update.mjs --id <cuid> [--status ...] [--verdict ...] [--report-url ...] | --delete');
    process.exit(1);
  }
  const sql = getSql();

  const rows = await sql`SELECT id, "projectName", status, verdict FROM "WardenAuditRequest" WHERE id = ${id}`;
  const row = rows[0];
  if (!row) {
    console.error(`No audit request with id ${id}`);
    process.exit(1);
  }

  if (process.argv.includes('--delete')) {
    await sql`DELETE FROM "WardenAuditRequest" WHERE id = ${id}`;
    console.log(`Deleted audit request: ${row.projectName} (${id})`);
    process.exit(0);
  }

  const status = arg('status');
  const verdict = arg('verdict');
  const reportUrl = arg('report-url');

  if (status && !STATUSES.includes(status)) {
    console.error(`Bad status: ${status}. Use one of: ${STATUSES.join(', ')}`);
    process.exit(1);
  }
  if (verdict && !VERDICTS.includes(verdict)) {
    console.error(`Bad verdict: ${verdict}. Use one of: ${VERDICTS.join(', ')}`);
    process.exit(1);
  }
  if (status === 'reviewed' && !verdict && !row.verdict) {
    console.error('Marking a request reviewed requires --verdict green|yellow|red.');
    process.exit(1);
  }
  if (reportUrl !== undefined) {
    try {
      new URL(reportUrl);
    } catch {
      console.error('report-url must be a full URL.');
      process.exit(1);
    }
  }

  const sets = [];
  if (status) sets.push(`"status" = '${status}'`);
  if (verdict) sets.push(`"verdict" = '${verdict}'`);
  if (reportUrl !== undefined) sets.push(`"reportUrl" = '${reportUrl.replace(/'/g, "''")}'`);
  if (status === 'reviewed') sets.push(`"reviewedAt" = now()`);
  if (sets.length === 0) {
    console.log(`Nothing to update for ${row.projectName} (${id}) — status=${row.status} verdict=${row.verdict ?? '—'}`);
    process.exit(0);
  }
  await sql.query(`UPDATE "WardenAuditRequest" SET ${sets.join(', ')} WHERE id = '${id.replace(/'/g, "''")}'`);
  const updated = (await sql`SELECT "projectName", status, verdict, "reportUrl" FROM "WardenAuditRequest" WHERE id = ${id}`)[0];
  console.log(`Updated: ${updated.projectName} — status=${updated.status} verdict=${updated.verdict ?? '—'} report=${updated.reportUrl ?? '—'}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('warden-audit-update failed:', e?.message ?? e);
  process.exit(1);
});
