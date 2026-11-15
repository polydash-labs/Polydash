/**
 * Writes agents/polypad-mcp/schemas/tools_v2.json from the TypeScript tool registry, so the stdio MCP server
 * and the remote MCP server cannot drift. Run: npm run gen:agent-tools
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LIMITS } from './config';
import { TOOLS } from './tools';

export function schemaDocument() {
  return {
    version: 2,
    note: 'Generated from polypad/web/lib/agents-api/v2/tools.ts by npm run gen:agent-tools. Do not edit by hand.',
    limits: {
      defaultSlippageBps: LIMITS.defaultSlippageBps,
      maxSlippageBps: LIMITS.maxSlippageBps,
      confirmLargeWei: LIMITS.confirmLargeWei.toString(),
      maxActionWei: LIMITS.maxActionWei.toString(),
      maxBodyBytes: LIMITS.maxBodyBytes,
      rate: {
        read: LIMITS.rate.read.limit,
        prepare: LIMITS.rate.prepare.limit,
        perWalletPrepare: LIMITS.rate.perWalletPrepare.limit,
        intent: LIMITS.rate.intent.limit,
      },
    },
    tools: TOOLS.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      'x-method': t.method,
      'x-path': t.path,
      'x-kind': t.kind,
    })),
  };
}

if (process.argv[1] && process.argv[1].endsWith('export-schemas.ts')) {
  const out = resolve(process.cwd(), '../../agents/polypad-mcp/schemas/tools_v2.json');
  writeFileSync(out, JSON.stringify(schemaDocument(), null, 2) + '\n');
  console.log('wrote', out);
}
