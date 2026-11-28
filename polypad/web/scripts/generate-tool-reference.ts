/**
 * Generate the tool reference data from the live tool definitions.
 *
 * Reads lib/agents-api/v2/tools.ts (the same source the MCP server and the
 * REST routes serve) and writes lib/agents-api/v2/tools-reference.json.
 * The /docs/tools page renders from that JSON, so the reference can never
 * drift from the code: if a tool changes, re-run this script.
 *
 *   npx tsx scripts/generate-tool-reference.ts
 *
 * Do NOT edit the JSON by hand — edit the tool definitions (or the sample /
 * error maps in this file) and re-run.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS } from '../lib/agents-api/v2/tools';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'lib/agents-api/v2/tools-reference.json');

const MCP_URL = 'https://polypad.family/api/mcp';
const REST_BASE = 'https://polypad.family/api/agents/v2';

/** Groups as shown on /build. */
const GROUPS: Record<string, string> = {
  polypad_quote_trade: 'Trade',
  polypad_quote_swap: 'Trade',
  polypad_prepare_buy: 'Trade',
  polypad_prepare_sell: 'Trade',
  polypad_prepare_swap: 'Trade',
  polypad_list_tokens: 'Launch',
  polypad_get_token: 'Launch',
  polypad_prepare_token_launch: 'Launch',
  polypad_list_fund_templates: 'Tokenized Funds',
  polypad_list_funds: 'Tokenized Funds',
  polypad_get_fund: 'Tokenized Funds',
  polypad_prepare_fund_create: 'Tokenized Funds',
  polypad_prepare_fund_mint: 'Tokenized Funds',
  polypad_prepare_fund_redeem: 'Tokenized Funds',
  polypad_list_nfts: 'NFTs',
  polypad_list_nft_listings: 'NFTs',
  polypad_prepare_nft_buy: 'NFTs',
  polypad_prepare_nft_create: 'NFTs',
  polypad_what_can_i_do: 'Read',
  polypad_intent: 'Read',
  polypad_token_protections: 'Read',
  polypad_portfolio: 'Read',
  polypad_get_tx_status: 'Read',
  polypad_stats: 'Read',
  x402_cross_chain_quote: 'x402',
  x402_cross_chain_pay: 'x402',
  polypad_agent_chat: 'Business',
};

/**
 * Every error code the API can return, with its HTTP status, verified
 * against lib/agents-api/v2 (grep for `new ApiError(`). If the code adds a
 * new error, add it here first — the script fails on unknown codes.
 */
const KNOWN_ERRORS: Record<string, { status: number; meaning: string }> = {
  invalid_json: { status: 400, meaning: 'The request body was not valid JSON, or was not a JSON object.' },
  invalid_params: { status: 400, meaning: 'A field was missing, the wrong type, or out of range (bad address, bad number, bad hash). The error names the field.' },
  key_material_rejected: { status: 400, meaning: 'The request contained a private key or seed phrase. Never send one — Polypad never needs it. Nothing was processed.' },
  amount_too_large: { status: 400, meaning: 'One action is above the 25 ETH cap. Split it into smaller actions.' },
  confirm_large_required: { status: 400, meaning: 'The amount is above 1 ETH. Confirm it with the user first, then resend with "confirmLarge": true.' },
  invalid_api_key: { status: 401, meaning: 'The API key sent was unknown or revoked. Free calls need no key — send no key at all, or get a Pro key from /agents/accounts.' },
  not_found: { status: 404, meaning: 'No token, tokenized fund, collection, listing, or endpoint matched.' },
  tx_not_found: { status: 404, meaning: 'No transaction with that hash on Robinhood Chain yet — it may not have been sent.' },
  unknown_template: { status: 404, meaning: 'No Strategy with that id. List the strategies first.' },
  method_not_allowed: { status: 405, meaning: 'Wrong HTTP method for the endpoint (GET vs POST).' },
  ambiguous_token: { status: 409, meaning: 'More than one token matches. Use the token address.' },
  ambiguous_fund: { status: 409, meaning: 'More than one tokenized fund matches. Use the fund address.' },
  ambiguous_collection: { status: 409, meaning: 'More than one collection matches. Use the collection address.' },
  amount_exceeds_curve: { status: 409, meaning: 'More tokens than the bonding curve can buy back right now. Try a smaller amount.' },
  choose_template: { status: 409, meaning: 'More than one Strategy fits the assets. Ask the user which one.' },
  commit_window_open: { status: 409, meaning: 'The collection is still in its commitment window. Commit from the collection page.' },
  insufficient_balance: { status: 409, meaning: 'The wallet holds less than the amount requested.' },
  listing_not_valid: { status: 409, meaning: 'The listing is sold, cancelled, expired, or no longer backed by the seller.' },
  no_shares: { status: 409, meaning: 'The wallet holds no shares of that tokenized fund.' },
  not_holder: { status: 409, meaning: 'The wallet does not hold the share(s) being redeemed.' },
  not_tradable: { status: 409, meaning: 'The token is in a phase that cannot be traded right now.' },
  own_listing: { status: 409, meaning: 'This wallet is the seller of that listing.' },
  raise_closed: { status: 409, meaning: 'The tokenized fund is not open for minting.' },
  raise_open: { status: 409, meaning: 'The tokenized fund is still raising. Exit opens after the raise closes; a refund opens only if the raise fails.' },
  skin_required: { status: 409, meaning: 'Public minting is not open yet — the manager must mint their required shares first.' },
  sold_out: { status: 409, meaning: 'Sold out (NFT collection, or no shares left).' },
  unsupported_fund: { status: 409, meaning: 'Exits from this fund type are not prepared by the API yet. Open the fund page.' },
  wallet_cap: { status: 409, meaning: 'The collection’s per-wallet mint limit is reached.' },
  payload_too_large: { status: 413, meaning: 'Request body over 16 KB.' },
  no_matching_template: { status: 422, meaning: 'No Strategy can hold the requested assets.' },
  not_a_402: { status: 400, meaning: 'The URL did not return a 402 payment challenge. Cross-chain pay needs an x402 endpoint.' },
  no_stable_requirement: { status: 400, meaning: 'The endpoint only accepts a non-stable asset (such as POLYDASH). Cross-chain pay works for the USD stablecoins — USDG on Robinhood Chain, USDC on Base.' },
  invalid_amount: { status: 400, meaning: 'The 402 requirement has a zero amount.' },
  resource_unreachable: { status: 502, meaning: 'The x402 URL could not be fetched.' },
  timeout: { status: 503, meaning: 'The quote took too long. Try again.' },
  quote_failed: { status: 422, meaning: 'The pool could not quote that amount. Try a smaller amount.' },
  no_swap_route: { status: 409, meaning: 'No aggregator could quote this pair right now. The pair may have no liquid route on Robinhood Chain, or the quote services are briefly down.' },
  aggregator_no_quote: { status: 409, meaning: 'The venue you named could not quote this pair. Pick another route, or leave aggregator out to take the best.' },
  aggregator_not_configured: { status: 409, meaning: 'That venue needs an API key the server does not have yet (Bitget Wallet). The other venues still work.' },
  swap_build_failed: { status: 422, meaning: 'The venue quoted but could not build the transaction. Try again or pick another route.' },
  aggregator_unavailable: { status: 503, meaning: 'The venue did not answer, or rate-limited this server. Try again shortly.' },
  simulation_reverted: { status: 422, meaning: 'The on-chain simulation reverted — the transaction as built would fail. Nothing was sent.' },
  rate_limited: { status: 429, meaning: 'Too many requests from this IP. Wait a minute; the reply says how long (retry-after).' },
  rate_limited_wallet: { status: 429, meaning: 'Too many prepared actions for this wallet. Wait a minute.' },
  quota: { status: 429, meaning: 'The chat service is out of credits. Try again later.' },
  tool_not_available: { status: 403, meaning: 'This tool is only available to allowlisted business API keys.' },
  agent_chat_unavailable: { status: 503, meaning: 'Agent chat is not configured yet, or the chat service did not answer.' },
  internal_error: { status: 500, meaning: 'Unexpected error. Nothing was signed or sent.' },
  unsupported_collection_type: { status: 501, meaning: 'Buys from bonding-curve collections are not prepared by the API yet. Open the collection page.' },
  rpc_unavailable: { status: 503, meaning: 'The chain data source could not be reached. Retry shortly.' },
};

/** Errors every tool can return, whatever it does. */
const UNIVERSAL_ERRORS = ['invalid_params', 'invalid_api_key', 'rate_limited', 'rpc_unavailable', 'internal_error'];

/** Extra error codes per tool, on top of the universal set. */
const TOOL_ERRORS: Record<string, string[]> = {
  polypad_get_token: ['not_found', 'ambiguous_token'],
  polypad_token_protections: ['not_found', 'ambiguous_token'],
  polypad_quote_trade: ['not_found', 'ambiguous_token', 'quote_failed', 'not_tradable'],
  polypad_prepare_buy: ['not_found', 'ambiguous_token', 'amount_too_large', 'confirm_large_required', 'insufficient_balance', 'simulation_reverted', 'not_tradable', 'amount_exceeds_curve', 'payload_too_large', 'key_material_rejected'],
  polypad_prepare_sell: ['not_found', 'ambiguous_token', 'amount_too_large', 'confirm_large_required', 'insufficient_balance', 'simulation_reverted', 'not_tradable', 'payload_too_large', 'key_material_rejected'],
  polypad_prepare_swap: ['no_swap_route', 'aggregator_no_quote', 'aggregator_not_configured', 'aggregator_unavailable', 'swap_build_failed', 'amount_too_large', 'confirm_large_required', 'insufficient_balance', 'simulation_reverted', 'payload_too_large', 'key_material_rejected'],
  polypad_list_nft_listings: ['not_found'],
  polypad_prepare_nft_buy: ['not_found', 'ambiguous_collection', 'amount_too_large', 'confirm_large_required', 'insufficient_balance', 'simulation_reverted', 'sold_out', 'commit_window_open', 'wallet_cap', 'listing_not_valid', 'own_listing', 'unsupported_collection_type', 'payload_too_large', 'key_material_rejected'],
  polypad_get_fund: ['not_found', 'ambiguous_fund'],
  polypad_prepare_fund_create: ['unknown_template', 'no_matching_template', 'choose_template', 'amount_too_large', 'confirm_large_required', 'simulation_reverted', 'payload_too_large', 'key_material_rejected'],
  polypad_prepare_fund_mint: ['not_found', 'ambiguous_fund', 'amount_too_large', 'confirm_large_required', 'insufficient_balance', 'simulation_reverted', 'raise_closed', 'sold_out', 'skin_required', 'payload_too_large', 'key_material_rejected'],
  polypad_prepare_fund_redeem: ['not_found', 'ambiguous_fund', 'simulation_reverted', 'raise_open', 'no_shares', 'not_holder', 'unsupported_fund', 'payload_too_large', 'key_material_rejected'],
  polypad_prepare_token_launch: ['amount_too_large', 'confirm_large_required', 'simulation_reverted', 'payload_too_large', 'key_material_rejected'],
  polypad_portfolio: ['not_found'],
  polypad_get_tx_status: ['tx_not_found'],
  polypad_intent: ['not_found', 'ambiguous_token', 'ambiguous_fund'],
  x402_cross_chain_quote: ['not_a_402', 'no_stable_requirement', 'invalid_amount', 'resource_unreachable', 'timeout'],
  x402_cross_chain_pay: ['not_a_402', 'no_stable_requirement', 'invalid_amount', 'resource_unreachable', 'timeout'],
  polypad_agent_chat: ['tool_not_available', 'quota', 'agent_chat_unavailable'],
};

/** Example values for the fields the tools take. Public addresses only. */
const SWARM_TOKEN = '0x3Da9244DDE38284017fD15e45d1Fdf66D3617B4B';
const POLYFUND = '0x7c1d31629ac68aebe83f230edbc7eacfc26285ef';
const RUGS_LAYERS = '0x359Ec209361bEdC9a09a5e622605481CACb1AD06';
const EXAMPLE_WALLET = '0x1111111111111111111111111111111111111111';
const POLYFUND_CREATE_TX = '0x2a4c03794a3195f7a56120f488978d7d6f3a15e8ced3c964d8d55438f65704be';
const SWARM_IMAGE = 'ipfs://bafybeihk6cgm5ndcrmy6cucrqz44xzqxa3sz3vkqmasj6ubfnpai7rwrkm';

const SAMPLES: Record<string, unknown> = {
  token: SWARM_TOKEN,
  from: EXAMPLE_WALLET,
  address: EXAMPLE_WALLET,
  manager: EXAMPLE_WALLET,
  fund: POLYFUND,
  hash: POLYFUND_CREATE_TX,
  collection: RUGS_LAYERS,
  text: 'What tokens launched today?',
  name: 'Example Token',
  symbol: 'EXMPL',
  description: 'An example token launched through the API.',
  amountEth: '0.01',
  amountWei: '10000000000000000',
  amount: '1000000000000000000',
  mintPriceEth: '0.01',
  mintPriceWei: '10000000000000000',
  raiseCapEth: '2',
  raiseCapWei: '2000000000000000000',
  maxPriceEth: '0.01',
  maxPriceWei: '10000000000000000',
  devBuyEth: '0.001',
  launchDelay: '0',
  q: 'SWARM',
  asset: 'POLYDASH',
  imageUri: SWARM_IMAGE,
  repository: 'https://github.com/polydash-labs/Polydash',
  socialLinks: ['https://x.com/Polydash_'],
  assets: ['POLYDASH'],
  ids: ['1'],
  limit: 12,
  quantity: 1,
  listingId: 1,
  templateId: 6,
  creatorFeeBps: 100,
  entryFeeBps: 0,
  raiseDurationDays: 7,
  minSkinBps: 0,
  slippageBps: 100,
  percentOfBalance: 50,
  agentMark: true,
  ref: 'grok',
  url: 'https://polypad.family/api/x402/products/token-report?address=0x319525528f42167eF7fC18b77b889958080568e4',
  systemPrompt: 'You are a helpful youth baseball sports agent.',
  messages: [{ role: 'user', content: 'What should I work on to get recruited?' }],
  temperature: 0.7,
  maxTokens: 600,
};

function sampleFor(field: string, schema: Record<string, unknown>): unknown {
  if (field in SAMPLES) return SAMPLES[field];
  const s = schema as { enum?: unknown[]; minimum?: number; type?: string };
  if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0];
  if (s.type === 'integer') return s.minimum ?? 1;
  if (s.type === 'boolean') return true;
  if (s.type === 'array') return [];
  return 'example';
}

function main() {
  const tools = TOOLS.map((t) => {
    if (!t.description) throw new Error(`Tool ${t.name} has no description`);
    const group = GROUPS[t.name];
    if (!group) throw new Error(`Tool ${t.name} has no group in GROUPS — add one`);

    const props = (t.inputSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = new Set(t.inputSchema.required ?? []);
    const exampleArgs: Record<string, unknown> = {};
    for (const field of Object.keys(props)) {
      if (required.has(field)) exampleArgs[field] = sampleFor(field, props[field]);
    }

    const errorCodes = [...new Set([...UNIVERSAL_ERRORS, ...(TOOL_ERRORS[t.name] ?? [])])];
    for (const code of errorCodes) {
      if (!(code in KNOWN_ERRORS)) throw new Error(`Tool ${t.name} lists unknown error code "${code}" — add it to KNOWN_ERRORS`);
    }

    const mcpCall = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: t.name, arguments: exampleArgs },
    };
    const exampleMcp = `curl -X POST "${MCP_URL}" -H "content-type: application/json" -d '${JSON.stringify(mcpCall)}'`;
    let exampleCurl: string;
    if (t.method === 'GET') {
      const qs = Object.entries(exampleArgs)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
      exampleCurl = `curl "${REST_BASE}/${t.path}${qs ? `?${qs}` : ''}"`;
    } else {
      exampleCurl = `curl -X POST "${REST_BASE}/${t.path}" -H "content-type: application/json" -d '${JSON.stringify(exampleArgs)}'`;
    }

    return {
      name: t.name,
      title: t.title,
      description: t.description,
      group,
      kind: t.kind,
      method: t.method,
      path: t.path,
      inputs: Object.entries(props).map(([field, schema]) => ({
        field,
        type: typeof schema.type === 'string' ? schema.type : 'value',
        required: required.has(field),
        description: typeof schema.description === 'string' ? schema.description : '',
        ...(Array.isArray((schema as { enum?: unknown[] }).enum) ? { enum: (schema as { enum: unknown[] }).enum } : {}),
      })),
      exampleArgs,
      exampleCurl,
      exampleMcp,
      errors: errorCodes.map((code) => ({ code, status: KNOWN_ERRORS[code].status, meaning: KNOWN_ERRORS[code].meaning })),
    };
  });

  const out = {
    _generated: {
      by: 'scripts/generate-tool-reference.ts',
      source: 'lib/agents-api/v2/tools.ts',
      note: 'Do not edit by hand. Edit the tool definitions (or the sample/error maps in the script) and re-run: npx tsx scripts/generate-tool-reference.ts',
      toolCount: tools.length,
    },
    /** Full error-code table, sorted by HTTP status then code. */
    errors: Object.entries(KNOWN_ERRORS)
      .map(([code, e]) => ({ code, status: e.status, meaning: e.meaning }))
      .sort((a, b) => a.status - b.status || a.code.localeCompare(b.code)),
    tools,
  };
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`Wrote ${OUT} (${tools.length} tools)`);
}

main();
