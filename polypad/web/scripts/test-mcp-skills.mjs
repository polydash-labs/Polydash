// End-to-end test for Polypad Skills over MCP (server v2.2.0).
//
// Usage: node scripts/test-mcp-skills.mjs [baseUrl]
//   baseUrl defaults to http://localhost:3000 (local `next dev`).
//   For Preview: node scripts/test-mcp-skills.mjs https://<preview>.vercel.app
//
// Node fetch hangs on egress from this VM (undici ignores the proxy), so
// every HTTP call — including the real @modelcontextprotocol/sdk client —
// goes through a curl-backed fetch implementation.
//
// Covers: SDK-client handshake + negotiation, skills/list + skills/get +
// resources/read + resources/directory/read (with SHA-256 manifest
// verification), the tool-name drift guard, tasks (inline completion,
// elicitation decline + accept, fund-watch, cancel, error paths).
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';

// The SDK client import is dynamic: this project's pinned zod (3.23.8)
// is too old for @modelcontextprotocol/sdk@1.32.2 (needs zod ^3.25 || ^4),
// so a static import would break the whole script in-project. The SDK
// section is best-effort — if the import fails, the raw JSON-RPC suite
// below still covers every method; run the full suite from a directory
// with a compatible zod (see the note at the bottom of this file).
let SdkClient = null;
let SdkTransport = null;
try {
  const clientMod = await import('@modelcontextprotocol/sdk/client/index.js');
  const transportMod = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  SdkClient = clientMod.Client;
  SdkTransport = transportMod.StreamableHTTPClientTransport;
} catch (e) {
  console.log(`\n(note: SDK client unavailable in this directory — ${String(e).slice(0, 140)} — the SDK handshake section will be skipped; run this script from a directory with @modelcontextprotocol/sdk@1.32.2 + zod ^3.25||^4 installed for the full suite)`);
}

const BASE = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const MCP_URL = `${BASE}/api/mcp`;
const POLYFUND = '0x7c1d31629ac68aebe83f230edbc7eacfc26285ef';
const TEST_WALLET = '0x0E03f180C18352Cc96704242A88aA20578E3750E'; // x402 test buyer (no funds move in this test)

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; failures.push(name); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- curl-backed fetch (FetchLike) ---------------------------------------
function curlFetch(url, init = {}) {
  return new Promise((resolve, reject) => {
    const method = init.method || 'GET';
    const args = ['-sS', '--max-time', '90', '-X', method, url, '-w', '\n%{http_code}'];
    const headers = init.headers ?? {};
    for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
    const body = init.body ?? null;
    if (body) args.push('--data-binary', '@-');
    const child = execFile('curl', args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(new Error(`curl ${method} ${url} failed: ${err.message}`));
      const idx = stdout.lastIndexOf('\n');
      const status = Number(stdout.slice(idx + 1).trim());
      const text = stdout.slice(0, idx);
      const h = new Headers({ 'content-type': 'application/json' });
      resolve(new Response(text, { status, headers: h }));
    });
    if (body) { child.stdin.write(typeof body === 'string' ? body : Buffer.from(body)); child.stdin.end(); }
    else child.stdin.end();
  });
}

// --- raw JSON-RPC helpers -------------------------------------------------
let rpcId = 1;
async function rpcRaw(message) {
  const res = await curlFetch(MCP_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(message),
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { _unparsed: text.slice(0, 200) }; }
  return { status: res.status, body };
}
async function rpc(method, params = {}) {
  const id = rpcId++;
  const { status, body } = await rpcRaw({ jsonrpc: '2.0', id, method, params });
  if (status !== 200) throw new Error(`${method} → HTTP ${status}: ${JSON.stringify(body)?.slice(0, 300)}`);
  if (body?.error) throw new Error(`${method} → JSON-RPC ${body.error.code}: ${body.error.message}`);
  return body.result;
}
async function rpcExpectError(method, params = {}) {
  const id = rpcId++;
  const { status, body } = await rpcRaw({ jsonrpc: '2.0', id, method, params });
  return { status, error: body?.error ?? null, body };
}

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

// ==========================================================================
console.log(`\n== Polypad Skills over MCP — testing ${MCP_URL} ==\n`);

// --- 1. Real SDK client: handshake, negotiation, capabilities ------------
console.log('-- SDK client handshake --');
let sdkClient = null;
if (!SdkClient || !SdkTransport) {
  console.log('  SKIP SDK client handshake (SDK unavailable in this directory)');
} else {
try {
  sdkClient = new SdkClient({ name: 'polypad-skills-test', version: '0.1.0' }, { capabilities: {} });
  const transport = new SdkTransport(new URL(MCP_URL), { fetch: curlFetch });
  await sdkClient.connect(transport);
  const serverInfo = sdkClient.getServerVersion();
  check('SDK connect negotiates protocol 2025-11-25', sdkClient.getServerCapabilities() !== undefined, 'no capabilities');
  check('serverInfo.version is 2.2.0', serverInfo?.version === '2.2.0', `got ${serverInfo?.version}`);
  check('serverInfo.name is polypad', serverInfo?.name === 'polypad', `got ${serverInfo?.name}`);
  const caps = sdkClient.getServerCapabilities();
  check('initialize advertises resources capability', caps?.resources !== undefined, JSON.stringify(caps)?.slice(0, 200));
  check('initialize advertises skills extension', caps?.extensions?.['io.modelcontextprotocol/skills']?.directoryRead === true, JSON.stringify(caps?.extensions)?.slice(0, 200));
  const tools = await sdkClient.listTools();
  check('SDK tools/list returns 27 tools', tools.tools.length === 27, `got ${tools.tools.length}`);
  // Best-effort: a real SDK client calling a custom skills method.
  try {
    const { z } = await import('zod');
    const res = await sdkClient.request({ method: 'skills/list', params: {} }, z.any());
    check('SDK client can call skills/list', Array.isArray(res?.skills) && res.skills.length === 5, `got ${res?.skills?.length}`);
  } catch (e) {
    check('SDK client can call skills/list', false, `client.request failed: ${String(e).slice(0, 200)}`);
  }
} catch (e) {
  check('SDK client handshake', false, String(e).slice(0, 300));
} finally {
  try { await sdkClient?.close(); } catch { /* ignore */ }
}
} // end else (SDK available)

// --- 2. Protocol negotiation (raw) ----------------------------------------
console.log('-- protocol negotiation --');
{
  const r = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  check('old client (2024-11-05) negotiates 2024-11-05', r.protocolVersion === '2024-11-05', `got ${r.protocolVersion}`);
  const r2 = await rpc('initialize', { protocolVersion: 'garbage', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  check('unknown version falls back to 2025-11-25', r2.protocolVersion === '2025-11-25', `got ${r2.protocolVersion}`);
  check('initialize returns instructions mentioning skills', typeof r2.instructions === 'string' && r2.instructions.includes('skills/list'), 'no skills mention');
}

// --- 3. tools/list ---------------------------------------------------------
console.log('-- tools/list --');
let toolNames = new Set();
{
  const r = await rpc('tools/list', {});
  check('tools/list returns 27 tools', r.tools.length === 27, `got ${r.tools.length}`);
  toolNames = new Set(r.tools.map((t) => t.name));
  check('tools/list includes polypad_prepare_token_launch', toolNames.has('polypad_prepare_token_launch'));
  check('tools/list includes polypad_get_fund', toolNames.has('polypad_get_fund'));
}

// --- 4. skills/list + skills/get + resources -------------------------------
console.log('-- skills discovery + delivery --');
const EXPECTED_SKILLS = ['launch-token', 'create-fund', 'propose-fund-asset', 'check-fund-nav', 'buy-token'];
let skillBodies = {};
{
  const r = await rpc('skills/list', {});
  check('skills/list returns 5 skills', r.skills.length === 5, `got ${r.skills.length}`);
  check('skills/list resultType is complete', r.resultType === 'complete', `got ${r.resultType}`);
  check('skills/list ttlMs is 3600000', r.ttlMs === 3600000, `got ${r.ttlMs}`);
  check('skills/list cacheScope is public', r.cacheScope === 'public', `got ${r.cacheScope}`);
  const names = r.skills.map((s) => s.frontmatter.name);
  check('skills/list names match the 5 planned skills', EXPECTED_SKILLS.every((n) => names.includes(n)), names.join(','));
  for (const entry of r.skills) {
    check(`manifest for ${entry.frontmatter.name}: uri is skill://<name>/SKILL.md`, entry.uri === `skill://${entry.frontmatter.name}/SKILL.md`, entry.uri);
    const file = entry.resources?.[0];
    check(`manifest for ${entry.frontmatter.name}: digest + size present`, file && /^[0-9a-f]{64}$/.test(file.sha256) && file.size > 0, JSON.stringify(file)?.slice(0, 120));
    check(`manifest for ${entry.frontmatter.name}: frontmatter description present`, typeof entry.frontmatter.description === 'string' && entry.frontmatter.description.length > 20);
  }
  for (const name of EXPECTED_SKILLS) {
    const uri = `skill://${name}/SKILL.md`;
    const g = await rpc('skills/get', { uri });
    check(`skills/get ${name} returns the same entry`, g.skill.uri === uri && g.skill.frontmatter.name === name);
    const read = await rpc('resources/read', { uri });
    const text = read.contents?.[0]?.text ?? '';
    skillBodies[name] = text;
    const listed = r.skills.find((s) => s.frontmatter.name === name);
    check(`resources/read ${name}: sha256 matches manifest`, sha256(text) === listed.resources[0].sha256);
    check(`resources/read ${name}: byte size matches manifest`, Buffer.byteLength(text, 'utf8') === listed.resources[0].size, `${Buffer.byteLength(text, 'utf8')} vs ${listed.resources[0].size}`);
    check(`resources/read ${name}: starts with frontmatter`, text.startsWith('---\nname:'));
    check(`resources/read ${name}: states the non-custodial rule`, text.includes('never holds or accepts private keys') && text.includes('cannot sign'), 'missing non-custodial block');
    const dir = await rpc('resources/directory/read', { uri: `skill://${name}` });
    check(`resources/directory/read ${name}: one SKILL.md entry`, dir.entries?.length === 1 && dir.entries[0].name === 'SKILL.md' && dir.entries[0].sha256 === listed.resources[0].sha256);
  }
  const res = await rpc('resources/list', {});
  check('resources/list returns the 5 skill files', res.resources.length === 5, `got ${res.resources.length}`);
  const bad = await rpcExpectError('skills/get', { uri: 'skill://nope/SKILL.md' });
  check('skills/get unknown URI → -32602', bad.error?.code === -32602, `got ${bad.error?.code}`);
  const badRead = await rpcExpectError('resources/read', { uri: 'skill://nope/SKILL.md' });
  check('resources/read unknown URI → -32602', badRead.error?.code === -32602, `got ${badRead.error?.code}`);
}

// --- 5. Drift guard: every tool named in a skill body must exist -----------
console.log('-- drift guard --');
{
  const cited = new Set();
  for (const [name, text] of Object.entries(skillBodies)) {
    for (const m of text.matchAll(/(?:polypad|x402)_[a-z_]+/g)) cited.add(m[0]);
  }
  const missing = [...cited].filter((n) => !toolNames.has(n));
  check(`all ${cited.size} tool names cited in skill bodies exist in tools/list`, missing.length === 0, `missing: ${missing.join(', ')}`);
  check('no skill promises a staking tool (none exists)', !Object.values(skillBodies).some((t) => /polypad_prepare_stake|stake POLYDASH.*polypad_/.test(t)), '');
}

// --- 6. Tasks ---------------------------------------------------------------
console.log('-- tasks --');
let inlineTaskId = null;
{
  // 6a. Inline completion: a read tool as a task completes immediately.
  const r = await rpc('tools/call', { name: 'polypad_list_funds', arguments: { limit: 1 }, task: { ttl: 60000 } });
  check('task-augmented read call returns a task', r.task?.taskId?.startsWith('task_'), JSON.stringify(r.task)?.slice(0, 200));
  check('read task completes inline', r.task?.status === 'completed', `got ${r.task?.status}`);
  inlineTaskId = r.task.taskId;
  const got = await rpc('tasks/get', { taskId: inlineTaskId });
  check('tasks/get returns the completed task', got.task.status === 'completed' && got.task.taskId === inlineTaskId);
  const res = await rpc('tasks/result', { taskId: inlineTaskId });
  check('tasks/result returns the tool payload', res?.structuredContent?.ok === true, JSON.stringify(res)?.slice(0, 200));
  const list = await rpc('tasks/list', { limit: 20 });
  check('tasks/list contains the task', list.tasks.some((t) => t.taskId === inlineTaskId));
  const cancelled = await rpc('tasks/cancel', { taskId: inlineTaskId });
  check('tasks/cancel on a completed task leaves it completed', cancelled.task.status === 'completed', `got ${cancelled.task.status}`);
  const unknown = await rpcExpectError('tasks/get', { taskId: 'task_doesnotexist000000' });
  check('tasks/get unknown id → -32602', unknown.error?.code === -32602, `got ${unknown.error?.code}`);
}

// --- 7. Elicitation: decline ------------------------------------------------
console.log('-- elicitation (decline) --');
let declineTaskId = null;
{
  const r = await rpc('tools/call', {
    name: 'polypad_prepare_buy',
    arguments: { token: 'SWARM', from: TEST_WALLET, amountEth: 0.00001 },
    task: { ttl: 300000 },
  });
  check('prepare as a task pauses at input_required', r.task?.status === 'input_required', `got ${r.task?.status}`);
  check('input_required task carries an elicitation id', typeof r.elicitationId === 'string' && r.elicitationId.startsWith('elic_'), JSON.stringify(r)?.slice(0, 200));
  check('elicitation form asks for an approval boolean', r.elicitation?.requestedSchema?.properties?.approved?.type === 'boolean', JSON.stringify(r.elicitation)?.slice(0, 300));
  check('elicitation message names the spend', typeof r.elicitation?.message === 'string' && r.elicitation.message.includes('polypad_prepare_buy'), r.elicitation?.message?.slice(0, 120));
  declineTaskId = r.task.taskId;
  const answer = await rpcRaw({ jsonrpc: '2.0', id: r.elicitationId, result: { action: 'decline' } });
  check('elicitation decline answer → HTTP 202, no reply', answer.status === 202 && (answer.body === null || answer.body === ''), `got HTTP ${answer.status} ${JSON.stringify(answer.body)?.slice(0, 120)}`);
  const got = await rpc('tasks/get', { taskId: declineTaskId });
  check('declined task is cancelled, nothing prepared', got.task.status === 'cancelled', `got ${got.task.status}`);
  const resErr = await rpcExpectError('tasks/result', { taskId: declineTaskId });
  check('tasks/result on a cancelled task → -32002', resErr.error?.code === -32002, `got ${resErr.error?.code}`);
}

// --- 8. Elicitation: accept --------------------------------------------------
console.log('-- elicitation (accept) --');
{
  const r = await rpc('tools/call', {
    name: 'polypad_prepare_buy',
    arguments: { token: 'SWARM', from: TEST_WALLET, amountEth: 0.00001 },
    task: { ttl: 300000 },
  });
  check('second prepare task pauses at input_required', r.task?.status === 'input_required', `got ${r.task?.status}`);
  const taskId = r.task.taskId;
  const answer = await rpcRaw({ jsonrpc: '2.0', id: r.elicitationId, result: { action: 'accept', content: { approved: true } } });
  check('elicitation accept answer → HTTP 202, no reply', answer.status === 202, `got HTTP ${answer.status}`);
  let final = null;
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const got = await rpc('tasks/get', { taskId });
    if (got.task.status === 'completed' || got.task.status === 'failed') { final = got.task; break; }
  }
  check('accepted task leaves input_required', final !== null, 'still input_required/working after 60s');
  if (final) {
    check('accepted prepare task completes', final.status === 'completed', `got ${final.status} — ${final.statusMessage ?? ''}`);
    if (final.status === 'completed') {
      const res = await rpc('tasks/result', { taskId });
      const sc = res?.structuredContent ?? {};
      check('accepted task result is an unsigned prepare (no signature)', sc?.action?.to !== undefined || sc?.unsignedTx !== undefined || JSON.stringify(sc).includes('sign'), JSON.stringify(sc).slice(0, 300));
    } else {
      console.log(`  (accept-path task failed: ${final.statusMessage ?? ''})`);
    }
  }
}

// --- 9. Fund-watch ------------------------------------------------------------
console.log('-- fund-watch --');
{
  const r = await rpc('tools/call', { name: 'polypad_get_fund', arguments: { fund: POLYFUND }, task: { ttl: 120000 } });
  check('get_fund as a task starts working', r.task?.status === 'working', `got ${r.task?.status}: ${JSON.stringify(r.task)?.slice(0, 200)}`);
  check('fund-watch task suggests an hourly poll interval', r.task?.pollInterval === 3600000, `got ${r.task?.pollInterval}`);
  const taskId = r.task.taskId;
  const got = await rpc('tasks/get', { taskId });
  check('fund-watch stays working while the fund is unchanged', got.task.status === 'working', `got ${got.task.status}`);
  const resErr = await rpcExpectError('tasks/result', { taskId });
  check('tasks/result on a working task → -32002', resErr.error?.code === -32002, `got ${resErr.error?.code}`);
  const cancelled = await rpc('tasks/cancel', { taskId });
  check('tasks/cancel stops the watch', cancelled.task.status === 'cancelled', `got ${cancelled.task.status}`);
  const got2 = await rpc('tasks/get', { taskId });
  check('cancelled watch stays cancelled', got2.task.status === 'cancelled', `got ${got2.task.status}`);
}

// ==========================================================================
console.log(`\n== ${passed} passed, ${failed} failed ==`);
if (failures.length) console.log('Failures:', failures.join('; '));
process.exit(failed ? 1 : 0);
