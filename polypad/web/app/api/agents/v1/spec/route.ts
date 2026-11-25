import { AGENT_LAUNCH_MARK } from '@/lib/agent-mark';
import { AGENT_API_VERSION, AGENT_ENDPOINTS, AGENT_RATE_LIMIT, AGENT_RATE_WINDOW_MS, POLYPAD_CHAIN_NAME, chainId, factoryAddress } from '@/lib/agent-launch';
import { DEFAULT_SLIPPAGE_BPS, MAX_SLIPPAGE_BPS, MIN_COMMIT_WEI, SIGNING_NOTE, cors, ok } from '@/lib/agents-api/trade';

export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return new Response(null, { status: 204, headers: cors() });
}

const addr = { type: 'string', format: '0x-prefixed 20-byte address' };
const wei = { type: 'string', format: 'decimal base-unit integer string' };
const txBody = (amount: string | null) => ({
  token: { ...addr, required: true, description: 'Launch or token address.' },
  from: { ...addr, required: true, description: 'Wallet that will sign. Simulation runs from this address.' },
  ...(amount ? { amount: { ...wei, required: true, description: amount } } : {}),
});

/** Machine-readable spec for the Polypad agent API (v1). */
export function GET() {
  const id = chainId();
  return ok({
    ok: true,
    name: 'Polypad agent API',
    version: AGENT_API_VERSION,
    chainId: id,
    chain: POLYPAD_CHAIN_NAME,
    factory: factoryAddress(),
    baseUrl: 'https://polypad.family',
    docs: 'https://polypad.family/docs#agent-launched',
    custody: 'non-custodial',
    signing: SIGNING_NOTE,
    safety: [
      'Polypad never accepts private keys or seed phrases; requests containing them are rejected.',
      'Every write endpoint returns unsigned transactions. The caller signs and broadcasts with its own wallet.',
      'Step 1 of each transaction list is simulated with eth_call from the from address. Later steps (for example sell after approve) are marked simulated:false and must be sent after earlier steps confirm.',
      'Tokens are created by their users, not by Polypad. Security-scanned with Bevor. Not a formal audit. Scans are not audits. Not financial advice.',
    ],
    units: {
      amounts: 'Decimal base-unit strings. ETH in wei; tokens in 18-decimal base units.',
      slippageBps: `Integer basis points, default ${DEFAULT_SLIPPAGE_BPS}, max ${MAX_SLIPPAGE_BPS}. minAmountOut = amountOut x (10000 - slippageBps) / 10000.`,
      displayFields: 'Fields ending in Display are for display only and must not be used in transactions.',
    },
    phases: { 1: 'commit_window', 2: 'processing_commitments', 3: 'trading (bonding curve)', 4: 'graduated (Uniswap V4 pool; curve quotes and tx/buy, tx/sell return 409 not_on_curve)' },
    rateLimits: {
      quoteAndTx: '60 requests per minute per IP (quote and tx/*).',
      launch: `${AGENT_RATE_LIMIT} requests per ${AGENT_RATE_WINDOW_MS / 1000} s per IP (validate, simulate).`,
      launchBuild: '30 simulations per API key per hour, plus per-wallet and per-key launch limits.',
    },
    agentMark: {
      link: AGENT_LAUNCH_MARK,
      description: 'Launches built through the agent API carry this link in their social links. It records how a launch was prepared, not its quality or risk.',
    },
    endpoints: AGENT_ENDPOINTS,
    parameters: {
      tokens: {
        query: {
          q: { type: 'string', description: 'Name, symbol, launch or token address.' },
          phase: { enum: ['all', 'commit', 'trading', 'graduated'], default: 'all' },
          sort: { enum: ['newest', 'progress', 'raised'], default: 'newest' },
          limit: { type: 'integer', min: 1, max: 100, default: 20 },
          agent: { enum: ['1'], description: 'Only agent-launched tokens.' },
        },
      },
      quote: {
        query: {
          token: { ...addr, required: true },
          side: { enum: ['buy', 'sell'], required: true },
          amount: { ...wei, required: true, description: 'buy: ETH in wei. sell: token base units.' },
        },
      },
      'tx/buy': { body: { ...txBody('ETH to spend, in wei. Sent as value.'), slippageBps: { type: 'integer' } } },
      'tx/sell': { body: { ...txBody('Tokens to sell, in base units.'), slippageBps: { type: 'integer' } } },
      'tx/commit': { body: txBody(`ETH to commit, in wei. Minimum ${MIN_COMMIT_WEI.toString()}.`) },
      'tx/uncommit': { body: txBody(null) },
      'tx/withdraw-commitment': { body: txBody(null) },
      'tx/claim-refund': { body: txBody(null) },
      'tx/claim-fees': { body: txBody(null), note: 'from must be the launch creator. After graduation, new creator fees accrue in the hook pool and are claimed from the token page.' },
    },
    responses: {
      tx: {
        ok: 'boolean',
        chainId: 'number',
        action: 'string',
        token: 'token summary',
        transactions: '[{step, kind, description, chainId, from, to, data, value (wei string), gas (string|null, estimate x1.2), simulated}]',
        quote: '{amountIn, amountOut, minAmountOut, slippageBps, fees{platformWei, creatorWei, taxWei, totalWei}} (buy and sell)',
        simulation: '{success, gas} or {success:false, reason}',
        signing: 'string',
        custody: 'non-custodial',
      },
      errors: {
        shape: '{error, message, ...details}',
        codes: {
          400: 'invalid_params, invalid_json, key_material_rejected',
          403: 'not_creator',
          404: 'not_found, unknown_action',
          409: 'not_on_curve, not_in_commit_window, nothing_committed, nothing_to_claim, insufficient_balance',
          422: 'simulation_reverted (unsigned transactions are still returned for inspection)',
          429: 'rate_limited',
          503: 'unavailable, rpc_unavailable',
        },
      },
    },
  }, 200, { 'cache-control': 'public, max-age=300' });
}
