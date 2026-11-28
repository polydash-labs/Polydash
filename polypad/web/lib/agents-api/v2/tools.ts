/**
 * The tool registry. One definition feeds the REST routes (/api/agents/v2/...), the remote MCP server
 * (/api/mcp), and the stdio MCP schema file. Every tool is either a read or a prepare. No tool signs.
 */
import { getAddress, isAddress } from 'viem';
import { ADDR, API_VERSION, CHAIN_ID, LIMITS, SITE_ORIGIN, WORDING } from './config';
import {
  ApiError, bodyGuard, optAddress, optUint, parseUnits10, reqAddress, reqTxHash, takeLimit, type Ctx, type Meta,
} from './core';
import { getFund, listFunds, listTemplates, prepareFundCreate, prepareFundMint, prepareFundRedeem } from './funds';
import { prepareTokenLaunch } from './launch';
import { launchView, getPlatformTokenLaunch, protectionsFor, resolveLaunch, tokenFeed } from './launches';
import { isPlatformTokenRef } from '../../platform-token';
import { allCollections, listNfts, listNftListings, prepareNftBuy, prepareNftCreate } from './nfts';
import { ethToWei, parseIntent } from './intent';
import { whatCanIDo } from './onboard';
import { portfolioOf } from './portfolio';
import { prepareBuy, prepareSell, quoteTrade } from './trade';
import { prepareSwap } from './prepare-swap';
import { quoteSwap } from './swap-quotes';
import { txStatus } from './status';
import { planCrossChainPayment, toExecutionPackage } from '../../x402/cross-chain';
import { applyWalletBinding, resolveWalletToken } from './wallet-token';
import { agentChat } from './agent-chat';
import {
  getLongbowMarket, getLongbowPosition, isLongbowPrepareTool, listLongbowMarkets, listLongbowVaults,
  longbowPrepareEnabled, planLongbowMultiply, prepareLongbowAddCollateral, prepareLongbowBorrow,
  prepareLongbowClaimRebate, prepareLongbowClose, prepareLongbowMultiply, prepareLongbowRepay,
  prepareLongbowStakeBow, prepareLongbowSupply, prepareLongbowWithdrawCollateral,
} from './longbow';
import { SKILLS } from './skills';

/** Key ids allowed to call the business agent-chat tool, from AGENT_CHAT_KEY_IDS (comma-separated). Empty = nobody. These are key *ids*, not key material. */
const AGENT_CHAT_KEY_IDS = new Set(
  (process.env.AGENT_CHAT_KEY_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

export function isAgentChatAllowed(keyId: string | null | undefined): boolean {
  return !!keyId && AGENT_CHAT_KEY_IDS.has(keyId);
}

type Json = Record<string, unknown>;
export type Tool = {
  name: string;
  title: string;
  description: string;
  kind: 'read' | 'prepare';
  method: 'GET' | 'POST';
  path: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
  handler: (ctx: Ctx, input: Json, meta: Meta) => Promise<Json>;
  /** When true, only a key id in the tool's allowlist may call it (enforced in runTool, so MCP, REST, and nested intent calls all check it). */
  requiresAllowlistedKey?: boolean;
};

const str = (description: string, extra: Json = {}) => ({ type: 'string', description, ...extra });
const int = (description: string, extra: Json = {}) => ({ type: 'integer', description, ...extra });
const bool = (description: string) => ({ type: 'boolean', description });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object' as const, properties, required, additionalProperties: false as const });

const FROM = str('The wallet address that will sign (0x...). Never a private key. Omit it when a walletToken is passed — the wallet is resolved from the token instead.');
const REF = str('Attribution tag for traffic measurement. Default "grok".');
const WALLET_TOKEN = str('A wallet token from /sign?connect=1: connect once, store the token, and pass it instead of from on every prepare call. The wallet is resolved from the token (signature-checked, 90-day expiry). When both are passed they must name the same wallet.');
const RETURN_URL = str('Optional https:// link back to your agent flow. The signing page shows it as a button after the transaction confirms, with ?tx=<hash>&status=confirmed added. Anything that is not an https:// URL is ignored.');
const SLIP = int(`Slippage limit in basis points. Default ${LIMITS.defaultSlippageBps}, maximum ${LIMITS.maxSlippageBps}.`, { minimum: 0, maximum: LIMITS.maxSlippageBps });
const CONFIRM = bool(`Set true only after the user confirmed an amount above ${LIMITS.confirmLargeWei / 10n ** 18n} ETH.`);

function ethOrWei(input: Json, weiField: string, ethField: string, out: string): Json {
  const copy = { ...input };
  if (copy[ethField] !== undefined && copy[ethField] !== '') {
    const wei = ethToWei(String(copy[ethField]));
    if (wei === null) throw new ApiError(400, 'invalid_params', `${ethField} must be a plain decimal number of ETH such as 0.01.`, { field: ethField });
    copy[out] = wei.toString();
  } else if (copy[weiField] !== undefined && copy[weiField] !== '') {
    copy[out] = copy[weiField];
  }
  return copy;
}

function b(v: unknown): boolean | undefined {
  if (v === true || v === 'true' || v === '1') return true;
  if (v === false || v === 'false' || v === '0') return false;
  return undefined;
}

export const TOOLS: Tool[] = [
  {
    name: 'polypad_what_can_i_do',
    title: 'What can I do',
    description: 'Start here. Explains what Polypad on Robinhood Chain can do from chat, example requests, live counts, how signing works, and the guardrails.',
    kind: 'read', method: 'GET', path: 'onboard',
    inputSchema: obj({}),
    handler: async (ctx) => whatCanIDo(ctx),
  },
  {
    name: 'polypad_intent',
    title: 'Understand a request',
    description: 'Turns a plain-language request ("buy 0.01 ETH of POLYCAT", "launch a fund with POLYDASH") into the right tool call. Runs read-only requests directly. For actions that move funds it needs the wallet address in `from`; if details are missing it returns the questions to ask.',
    kind: 'read', method: 'POST', path: 'intent',
    inputSchema: obj({ text: str('What the user said, as written.'), from: FROM, walletToken: WALLET_TOKEN, ref: REF }, ['text']),
    handler: async (ctx, input, meta) => {
      const text = typeof input.text === 'string' ? input.text.slice(0, 600) : '';
      const parsed = parseIntent(text);
      const from = optAddress(input, 'from');
      const token = typeof input.walletToken === 'string' && input.walletToken !== '' ? input.walletToken : undefined;
      const bound = token ? await resolveWalletToken(token) : undefined;
      const wallet = from ?? bound;
      const out: Json = { ok: true, ...parsed };
      if (!parsed.tool) return out;
      if (parsed.missing.length) return out;
      if (parsed.needsWallet && !wallet) {
        out.missing = [{ field: 'from', question: 'Which wallet address will sign? Paste the 0x address, or connect once on polypad.family/sign?connect=1 and pass the wallet token instead.' }];
        return out;
      }
      const tool = TOOLS.find((t) => t.name === parsed.tool);
      if (!tool || tool.name === 'polypad_intent') return out;
      const args: Json = { ...parsed.arguments, ...(wallet ? { from: wallet } : {}), ...(token ? { walletToken: token } : {}), ref: meta.ref };
      if (tool.name === 'polypad_prepare_buy' && args.amountWei) args.amount = args.amountWei;
      try {
        out.result = await runTool(ctx, tool, args, meta, false);
      } catch (e) {
        if (e instanceof ApiError) out.result = { ok: false, error: { code: e.code, message: e.message, ...e.extra } };
        else throw e;
      }
      return out;
    },
  },
  {
    name: 'polypad_list_tokens',
    title: 'Browse tokens',
    description: 'Trending, new, graduating, or high-volume token launches on Polypad, with search. Counts activity from on-chain trades. No price predictions.',
    kind: 'read', method: 'GET', path: 'tokens',
    inputSchema: obj({
      sort: str('trending, new, graduating, volume, or graduated.', { enum: ['trending', 'new', 'graduating', 'volume', 'graduated'] }),
      q: str('Search by name, symbol, or address.'),
      phase: str('Filter by phase.', { enum: ['commit_window', 'trading', 'graduated'] }),
      agentLaunched: bool('Only tokens prepared through the agent API.'),
      limit: int('How many to return, 1 to 50. Default 12.', { minimum: 1, maximum: 50 }),
    }),
    handler: async (ctx, i) => tokenFeed(ctx, { sort: i.sort as string | undefined, q: i.q as string | undefined, phase: i.phase as string | undefined, agentLaunched: b(i.agentLaunched), limit: i.limit === undefined ? undefined : optUint(i.limit, 'limit', 12, 1, 50) }),
  },
  {
    name: 'polypad_get_token',
    title: 'Token details',
    description: 'One token: price reading, bonding-curve progress, creator, fees, and links. Accepts a symbol, name, token address, or launch address. POLYDASH itself works too — it is not a launch, so it has no curve or launch contract.',
    kind: 'read', method: 'GET', path: 'token',
    inputSchema: obj({ token: str('Symbol, name, token address, or launch address.') }, ['token']),
    handler: async (ctx, i) => {
      const ref = String(i.token ?? '');
      try {
        const l = await resolveLaunch(ctx, ref);
        return { ok: true, token: launchView(l), disclaimer: WORDING.notAudited };
      } catch (e) {
        // POLYDASH is not a launch, so the lookup above 404s — answer it
        // from on-chain facts instead. Every other 404 passes through.
        if (e instanceof ApiError && e.code === 'not_found' && isPlatformTokenRef(ref)) {
          const l = await getPlatformTokenLaunch(ctx);
          if (l) return { ok: true, token: launchView(l), disclaimer: WORDING.notAudited };
        }
        throw e;
      }
    },
  },
  {
    name: 'polypad_token_protections',
    title: 'Token protections in plain words',
    description: 'A plain-language read of a token\'s on-chain protections: liquidity, fees, creator holdings, staking pool, vesting lock, bond. It says what is met, what is not, and what it cannot tell you. Not a promise about price.',
    kind: 'read', method: 'GET', path: 'protections',
    inputSchema: obj({ token: str('Symbol, name, token address, or launch address.') }, ['token']),
    handler: async (ctx, i) => protectionsFor(ctx, await resolveLaunch(ctx, String(i.token ?? ''))),
  },
  {
    name: 'polypad_quote_trade',
    title: 'Quote a buy or sell',
    description: 'Quote a buy (ETH in) or sell (token amount in) for a launch token, on the bonding curve or in the Uniswap V4 pool after graduation. Returns expected output, minimum after slippage, and fees. A reading, not a promise.',
    kind: 'read', method: 'GET', path: 'quote',
    inputSchema: obj({
      token: str('Symbol, name, token address, or launch address.'),
      side: str('buy or sell.', { enum: ['buy', 'sell'] }),
      amount: str('Base units as a decimal string: wei of ETH for a buy, token base units (18 decimals) for a sell.'),
      amountEth: str('Buy only: ETH as a decimal such as 0.01. Use instead of amount.'),
      slippageBps: SLIP,
    }, ['token', 'side']),
    handler: async (ctx, i) => quoteTrade(ctx, ethOrWei(i, 'amount', 'amountEth', 'amount')),
  },
  {
    name: 'polypad_quote_swap',
    title: 'Compare swap routes across aggregators',
    description: 'Compares one swap across KyberSwap, Velora, Bitget Wallet, and Uniswap on Robinhood Chain and returns the best route, with each venue\'s expected output. Quote only — it never signs or moves anything; polypad_prepare_swap turns the best route into an unsigned transaction inside the agent wallet limits. A venue that cannot quote reports why instead of failing the call.',
    kind: 'read', method: 'GET', path: 'quote-swap',
    inputSchema: obj({
      tokenIn: str('Token to sell: a token address on Robinhood Chain, or a symbol (ETH, WETH, USDG, POLYDASH).'),
      tokenOut: str('Token to buy: a token address on Robinhood Chain, or a symbol (ETH, WETH, USDG, POLYDASH).'),
      amountIn: str('Amount to sell, in the token\'s smallest units as a decimal string (e.g. 1000000000000000000 = 1 WETH).'),
      slippageBps: SLIP,
    }, ['tokenIn', 'tokenOut', 'amountIn']),
    handler: async (ctx, i) => quoteSwap(ctx, i),
  },
  {
    name: 'polypad_prepare_buy',
    title: 'Prepare a buy',
    description: 'Prepares a buy of a launch token with ETH. Simulates it on-chain before returning. Returns the unsigned transaction (to, data, value, chainId 4663, gas estimate), a plain summary, and a one-tap signing link. Show the summary before the link. Never signs.',
    kind: 'prepare', method: 'POST', path: 'prepare/buy',
    inputSchema: obj({ token: str('Symbol, name, token address, or launch address.'), from: FROM, amountEth: str('ETH to spend, as a decimal such as 0.01.'), amountWei: str('ETH to spend in wei. Use instead of amountEth.'), slippageBps: SLIP, confirmLarge: CONFIRM, ref: REF, returnUrl: RETURN_URL, walletToken: WALLET_TOKEN }, ['token', 'from']),
    handler: async (ctx, i, m) => prepareBuy(ctx, ethOrWei(i, 'amountWei', 'amountEth', 'amount'), m),
  },
  {
    name: 'polypad_prepare_sell',
    title: 'Prepare a sell',
    description: 'Prepares a sale of a launch token for ETH, with the exact-amount approval step if needed. Simulates step 1 on-chain. Returns unsigned transactions, a summary, and a signing link. Accepts an amount or a percent of the wallet balance.',
    kind: 'prepare', method: 'POST', path: 'prepare/sell',
    inputSchema: obj({ token: str('Symbol, name, token address, or launch address.'), from: FROM, amount: str('Token base units (18 decimals) as a decimal string.'), percentOfBalance: int('Percent of the wallet balance, 1 to 100. Use instead of amount.', { minimum: 1, maximum: 100 }), slippageBps: SLIP, ref: REF, returnUrl: RETURN_URL, walletToken: WALLET_TOKEN }, ['token', 'from']),
    handler: async (ctx, i, m) => prepareSell(ctx, i, m),
  },
  {
    name: 'polypad_prepare_swap',
    title: 'Prepare a swap across aggregators',
    description: 'Prepares a swap of any token for any token on Robinhood Chain through the best route across Velora, KyberSwap, Bitget Wallet, and Uniswap — or the venue you name. Re-quotes fresh, builds the unsigned transaction from that venue, adds the exact-amount approval step if needed, and simulates step 1 on-chain. Returns unsigned transactions, a summary, and a signing link. Never signs.',
    kind: 'prepare', method: 'POST', path: 'prepare/swap',
    inputSchema: obj({
      from: FROM,
      tokenIn: str('Token to sell: a token address on Robinhood Chain, or a symbol (ETH, WETH, USDG, POLYDASH).'),
      tokenOut: str('Token to buy: a token address on Robinhood Chain, or a symbol (ETH, WETH, USDG, POLYDASH).'),
      amountIn: str('Amount to sell, in the token\'s smallest units as a decimal string (e.g. 1000000000000000000 = 1 WETH).'),
      slippageBps: SLIP,
      aggregator: str('Which venue to execute through. Omit it to take the best quote.', { enum: ['velora', 'kyberswap', 'bitget', 'uniswap'] }),
      confirmLarge: CONFIRM, ref: REF, returnUrl: RETURN_URL, walletToken: WALLET_TOKEN,
    }, ['from', 'tokenIn', 'tokenOut', 'amountIn']),
    handler: async (ctx, i, m) => prepareSwap(ctx, i, m),
  },
  {
    name: 'polypad_list_nfts',
    title: 'Browse NFT collections',
    description: 'Polypad NFT collections with status (commitment window, public mint, sold out), price, supply, and royalties.',
    kind: 'read', method: 'GET', path: 'nfts',
    inputSchema: obj({ q: str('Search by name, symbol, or address.'), status: str('Filter by status.', { enum: ['commit_window', 'public_mint', 'sold_out'] }), sort: str('newest, minted, or price.', { enum: ['newest', 'minted', 'price'] }), limit: int('1 to 50.', { minimum: 1, maximum: 50 }) }),
    handler: async (ctx, i) => listNfts(ctx, { q: i.q as string | undefined, status: i.status as string | undefined, sort: i.sort as string | undefined, limit: i.limit === undefined ? undefined : optUint(i.limit, 'limit', 12, 1, 50) }),
  },
  {
    name: 'polypad_list_nft_listings',
    title: 'Browse marketplace listings',
    description: 'Active fixed-price NFT listings on the Polypad marketplace, lowest price at the top, optionally for one collection or under a price.',
    kind: 'read', method: 'GET', path: 'nfts/listings',
    inputSchema: obj({ collection: str('Collection address.'), maxPriceEth: str('Only listings at or below this many ETH.'), maxPriceWei: str('Same in wei.'), limit: int('1 to 50.', { minimum: 1, maximum: 50 }) }),
    handler: async (ctx, i) => {
      const w = i.maxPriceEth !== undefined && i.maxPriceEth !== '' ? ethToWei(String(i.maxPriceEth)) : i.maxPriceWei !== undefined && i.maxPriceWei !== '' ? parseUnits10(i.maxPriceWei, 'maxPriceWei') : undefined;
      if (w === null) throw new ApiError(400, 'invalid_params', 'maxPriceEth must be a plain decimal.', { field: 'maxPriceEth' });
      return listNftListings(ctx, { collection: optAddress(i, 'collection'), maxPriceWei: w, limit: i.limit === undefined ? undefined : optUint(i.limit, 'limit', 20, 1, 50) });
    },
  },
  {
    name: 'polypad_prepare_nft_buy',
    title: 'Prepare an NFT buy or mint',
    description: 'Prepares either a marketplace purchase (listingId) or a public mint from a fixed-price collection (collection + quantity). Checks supply, wallet limits, and price, then simulates. Returns unsigned transactions, a summary, and a signing link. Collections still in their commitment window are sent to the collection page instead.',
    kind: 'prepare', method: 'POST', path: 'prepare/nft-buy',
    inputSchema: obj({ from: FROM, listingId: int('Marketplace listing id.', { minimum: 1 }), collection: str('Collection address for a public mint.'), collectionName: str('Collection name, if no address is known.'), quantity: int('How many to mint, 1 to 50. Default 1.', { minimum: 1, maximum: 50 }), confirmLarge: CONFIRM, ref: REF, returnUrl: RETURN_URL, walletToken: WALLET_TOKEN }, ['from']),
    handler: async (ctx, i, m) => {
      const copy = { ...i };
      if (!copy.collection && typeof copy.collectionName === 'string') {
        const q = copy.collectionName.trim().toLowerCase();
        const hits = (await allCollections(ctx)).filter((c) => c.name.toLowerCase() === q || c.symbol.toLowerCase() === q || c.name.toLowerCase().startsWith(q));
        if (hits.length === 0) throw new ApiError(404, 'not_found', `No NFT collection matches "${copy.collectionName}".`);
        if (hits.length > 1) throw new ApiError(409, 'ambiguous_collection', 'More than one collection matches. Use the address.', { matches: hits.map((c) => ({ name: c.name, collection: c.address })) });
        copy.collection = hits[0].address;
      }
      delete copy.collectionName;
      return prepareNftBuy(ctx, copy, m);
    },
  },
  {
    name: 'polypad_prepare_nft_create',
    title: 'Prepare an NFT collection creation',
    description: 'Creates a fixed-price NFT collection on the Polypad NFT factory: name, symbol, artwork, max supply, mint price, and creator royalty. The caller signs once in their own wallet and pays gas only — creating a collection costs no ETH beyond gas. Only allowlisted business API keys can call it (used by Major League Operator Card Studio). Returns unsigned transactions, a summary, and a signing link.',
    kind: 'prepare', method: 'POST', path: 'prepare/nft-create',
    requiresAllowlistedKey: true,
    inputSchema: obj({ from: FROM, name: str('Collection name, 1 to 64 characters.'), symbol: str('Collection symbol, 1 to 10 characters, uppercased.'), imageUri: str('Artwork URL (https:// or ipfs://). Shown as the collection image.'), description: str('Plain description, up to 500 characters.'), baseURI: str('Metadata base URI (https:// or ipfs://). Optional.'), maxSupply: int('How many editions to mint, 1 to 10000. Default 25.', { minimum: 1, maximum: 10000 }), mintPriceEth: str('Mint price per edition in ETH as a plain decimal, above 0 to 10. Default 0.001. The factory does not allow a zero mint price. Use mintPriceWei instead for raw wei.'), mintPriceWei: str('Mint price per edition in wei. Use instead of mintPriceEth.'), royaltyBps: int('Creator royalty in basis points, 0 to 1500 (10% = 1000). Default 1000. Paid to the creator on every resale.', { minimum: 0, maximum: 1500 }), maxPerWallet: int('Max mints per wallet, 1 to 100. Default 5.', { minimum: 1, maximum: 100 }), commitWindow: int('Commitment window in seconds, 1 hour to 30 days. Default 86400 (24 hours). Buyers commit first, then mint.', { minimum: 3600, maximum: 2592000 }), floorBps: int('Share of mint price kept in the collection floor vault, in basis points, 2000 to 8000. Default 2000 (20%).', { minimum: 2000, maximum: 8000 }), ref: REF, returnUrl: RETURN_URL, walletToken: WALLET_TOKEN }, ['from', 'name', 'symbol', 'imageUri']),
    handler: async (ctx, i, m) => prepareNftCreate(ctx, i, m),
  },
  {
    name: 'polypad_list_fund_templates',
    title: 'Fund templates',
    description: 'The published strategy templates a fund can be created from: allowed assets, position and trade caps, performance fee, drawdown brake, and manager lock.',
    kind: 'read', method: 'GET', path: 'fund-templates',
    inputSchema: obj({}),
    handler: async (ctx) => listTemplates(ctx),
  },
  {
    name: 'polypad_list_funds',
    title: 'Discover funds',
    description: 'Polypad Funds with filters: open for minting, status, template, asset held, manager, factory, search, and sort by newest, raise progress, deadline, or shares.',
    kind: 'read', method: 'GET', path: 'funds',
    inputSchema: obj({
      open: bool('Only funds currently raising and not sold out.'),
      status: str('raising, raise_closed, investing, or failed.', { enum: ['raising', 'raise_closed', 'investing', 'failed'] }),
      templateId: int('Template id.', { minimum: 1 }),
      asset: str('Asset symbol or address the fund may hold, such as POLYDASH.'),
      manager: str('Manager address.'),
      factory: str('phase6, phase3, phase2, phase1a, or v3.', { enum: ['phase6', 'phase3', 'phase2', 'phase1a', 'v3'] }),
      q: str('Search by name, symbol, or address.'),
      sort: str('newest, raise_progress, deadline, or shares.', { enum: ['newest', 'raise_progress', 'deadline', 'shares'] }),
      limit: int('1 to 50.', { minimum: 1, maximum: 50 }),
    }),
    handler: async (ctx, i) => listFunds(ctx, {
      open: b(i.open), status: i.status as string | undefined, templateId: i.templateId === undefined || i.templateId === '' ? undefined : optUint(i.templateId, 'templateId', 1, 1, 1000),
      asset: i.asset as string | undefined, manager: optAddress(i, 'manager'), factory: i.factory as string | undefined, q: i.q as string | undefined, sort: i.sort as string | undefined,
      limit: i.limit === undefined ? undefined : optUint(i.limit, 'limit', 12, 1, 50),
    }),
  },
  {
    name: 'polypad_get_fund',
    title: 'Fund details',
    description: 'One fund: status, raise progress, price per share, fees, assets, template rules, and whether public minting is open.',
    kind: 'read', method: 'GET', path: 'fund',
    inputSchema: obj({ fund: str('Fund name, symbol, or address.') }, ['fund']),
    handler: async (ctx, i) => getFund(ctx, String(i.fund ?? '')),
  },
  {
    name: 'polypad_prepare_fund_create',
    title: 'Prepare a fund launch',
    description: 'Prepares creating a fund from a published template (Phase 6 factory by default). Give templateId, or list the assets wanted and it matches a template, or tells you honestly that none can hold them. Returns the unsigned createFund transaction, what the manager must mint next, and a signing link.',
    kind: 'prepare', method: 'POST', path: 'prepare/fund-create',
    inputSchema: obj({
      from: FROM, templateId: int('Template id from polypad_list_fund_templates.', { minimum: 1 }),
      assets: { type: 'array', items: { type: 'string' }, description: 'Asset symbols the fund should hold, used to match a template.' },
      name: str('Fund name, up to 64 bytes.'), symbol: str('Fund ticker, up to 16 bytes.'),
      mintPriceEth: str('Price per share in ETH, a decimal such as 0.01.'), mintPriceWei: str('Same in wei.'),
      raiseCapEth: str('Raise cap in ETH.'), raiseCapWei: str('Same in wei.'),
      entryFeeBps: int('Manager entry fee in basis points, 0 to 500. Default 0.', { minimum: 0, maximum: 500 }),
      raiseDurationDays: int('Raise length in days, 1 to 30. Default 7.', { minimum: 1, maximum: 30 }),
      minSkinBps: int('Manager skin requirement in basis points. 0 means the 5% default.', { minimum: 0, maximum: 10000 }),
      imageUri: str('https:// or ipfs:// image for the fund.'), factory: str('phase6 (default), phase3, or v3.', { enum: ['phase6', 'phase3', 'v3'] }), ref: REF, returnUrl: RETURN_URL, walletToken: WALLET_TOKEN,
    }, ['from', 'name', 'symbol']),
    handler: async (ctx, i, m) => prepareFundCreate(ctx, ethOrWei(ethOrWei(i, 'mintPriceWei', 'mintPriceEth', 'mintPriceWei'), 'raiseCapWei', 'raiseCapEth', 'raiseCapWei'), m),
  },
  {
    name: 'polypad_prepare_fund_mint',
    title: 'Prepare a fund investment',
    description: 'Prepares minting shares of an open fund. Checks the raise is open, that public minting is open (the manager has to mint the required shares before anyone else), supply, and balance. Simulates, then returns unsigned transactions, a summary, and a signing link.',
    kind: 'prepare', method: 'POST', path: 'prepare/fund-mint',
    inputSchema: obj({ from: FROM, fund: str('Fund address.'), quantity: int('Number of shares. Default 1.', { minimum: 1 }), confirmLarge: CONFIRM, ref: REF, returnUrl: RETURN_URL, walletToken: WALLET_TOKEN }, ['from', 'fund']),
    handler: async (ctx, i, m) => prepareFundMint(ctx, i, m),
  },
  {
    name: 'polypad_prepare_fund_redeem',
    title: 'Prepare a fund exit or refund',
    description: 'Prepares exiting a fund after its raise closes (pro-rata share of the vault) or a refund if the raise failed. Finds the wallet\'s shares on-chain, or takes a quantity or specific ids.',
    kind: 'prepare', method: 'POST', path: 'prepare/fund-redeem',
    inputSchema: obj({ from: FROM, fund: str('Fund address.'), quantity: int('How many shares, starting from the lowest ids. Default all.', { minimum: 1 }), ids: { type: 'array', items: { type: 'string' }, description: 'Specific share ids.' }, ref: REF, returnUrl: RETURN_URL, walletToken: WALLET_TOKEN }, ['from', 'fund']),
    handler: async (ctx, i, m) => prepareFundRedeem(ctx, i, m),
  },
  {
    name: 'polypad_prepare_token_launch',
    title: 'Prepare a token launch',
    description: 'Prepares launching a new token on the Polypad factory, with the Agent-launched label by default. Validates every field, simulates createLaunch, and returns the unsigned transaction, a summary, and a signing link.',
    kind: 'prepare', method: 'POST', path: 'prepare/token-launch',
    inputSchema: obj({
      from: FROM, name: str('Token name, up to 64 bytes.'), symbol: str('Ticker, up to 32 bytes.'), imageUri: str('https:// or ipfs:// logo.'), description: str('Up to 2000 characters.'),
      socialLinks: { type: 'array', items: { type: 'string' }, description: 'https:// links, up to 8.' }, creatorFeeBps: int('Creator fee in basis points, 0 to 500. Required. 0 means 0%.', { minimum: 0, maximum: 500 }),
      devBuyEth: str('Optional buy at launch, in wei.'), launchDelay: str('Seconds before trading opens, 0 to 2592000.'), agentMark: bool('Agent-launched label. Default true.'), repository: str('https://github.com/owner/repo, optional.'), ref: REF, returnUrl: RETURN_URL, walletToken: WALLET_TOKEN,
    }, ['from', 'name', 'symbol', 'creatorFeeBps']),
    handler: async (ctx, i, m) => prepareTokenLaunch(ctx, i, m),
  },
  {
    name: 'polypad_portfolio',
    title: 'Wallet portfolio (read-only)',
    description: 'Read-only view of a wallet: ETH, launch tokens with current exit value, fund shares with net value, and NFTs. Results are in ETH units from on-chain data. No USD value, no forecasts.',
    kind: 'read', method: 'GET', path: 'portfolio',
    inputSchema: obj({ address: str('Wallet address (0x...).') }, ['address']),
    handler: async (ctx, i) => portfolioOf(ctx, reqAddress(i, 'address')),
  },
  {
    name: 'polypad_get_tx_status',
    title: 'Transaction status',
    description: 'Follow up on a transaction: pending, confirmed, or failed, with a plain result (tokens bought, fund created, and so on) and an explorer link.',
    kind: 'read', method: 'GET', path: 'tx/status',
    inputSchema: obj({ hash: str('Transaction hash (0x, 32 bytes).') }, ['hash']),
    handler: async (ctx, i) => txStatus(ctx, reqTxHash(i)),
  },
  {
    name: 'polypad_stats',
    title: 'Agent traffic stats',
    description: 'Counts of actions prepared through the agent API by action and ref tag. Per server process; the on-chain attribution suffix is the durable record.',
    kind: 'read', method: 'GET', path: 'stats',
    inputSchema: obj({}),
    handler: async (ctx) => ({ ok: true, ...ctx.sink.summary(), onchainAttribution: 'Main transactions end with an ERC-8021 schema 0 suffix carrying "polypad,<ref>". Indexers can count it from calldata.' }),
  },
  {
    name: 'x402_cross_chain_quote',
    title: 'Cross-chain x402 quote',
    description: 'Dry-run plan for paying any x402 endpoint from the other chain: fetch the 402, read the wallet\'s balances on Base and Robinhood Chain, and quote the Relay bridge for only the shortfall. Read-only — no key, no signature, nothing moves. Works for the USD stablecoins (USDG on Robinhood Chain, USDC on Base); a POLYDASH-only endpoint cannot cross-chain.',
    kind: 'read', method: 'GET', path: 'x402/cross-chain/quote',
    inputSchema: obj({ url: str('The x402 URL to pay — it must return a 402 payment challenge.'), from: FROM }, ['url', 'from']),
    handler: async (_ctx, i) => ({ ...(await planCrossChainPayment(i)) }),
  },
  {
    name: 'x402_cross_chain_pay',
    title: 'Cross-chain x402 pay',
    description: 'The executable package for paying any x402 endpoint from the other chain: the dry-run plan, the unsigned Relay bridge transactions (approve + deposit, shortfall only), and the EIP-3009 typed data to sign for the settlement. Returns unsigned transactions only — the agent signs the bridge steps on the origin chain, waits for the bridge to land, signs the typed data, and POSTs it to the product URL as an X-PAYMENT header. Never signs, never takes a private key.',
    kind: 'prepare', method: 'POST', path: 'x402/cross-chain/pay',
    inputSchema: obj({ url: str('The x402 URL to pay — it must return a 402 payment challenge.'), from: FROM, ref: REF, returnUrl: RETURN_URL, walletToken: WALLET_TOKEN }, ['url', 'from']),
    handler: async (_ctx, i) => {
      const plan = await planCrossChainPayment(i);
      if (!plan.feasible) return { ...plan };
      return { ...plan, execution: toExecutionPackage(plan) };
    },
  },
  {
    name: 'polypad_agent_chat',
    title: 'Business agent chat',
    description: 'Run a business agent chat completion through Polypad: send a system prompt and messages, get the assistant reply. Only allowlisted business API keys can call it — every call is metered as API usage. The model is fixed (gpt-4o-mini) and the caller never sees the OpenAI key. Prompt and reply content is never logged.',
    kind: 'read', method: 'POST', path: 'agent-chat',
    requiresAllowlistedKey: true,
    inputSchema: obj({
      systemPrompt: str('The system prompt for the business agent, 1 to 12000 characters.'),
      messages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            role: { type: 'string', enum: ['user', 'assistant'] },
            content: { type: 'string' },
          },
          required: ['role', 'content'],
          additionalProperties: false,
        },
        description: 'Chat messages, oldest first. 1 to 20 messages; each content 1 to 12000 characters.',
      },
      temperature: { type: 'number', minimum: 0, maximum: 1, description: 'Sampling temperature. Default 0.7.' },
      maxTokens: int('Max reply tokens, 1 to 2000. Default 600.', { minimum: 1, maximum: 2000 }),
    }, ['systemPrompt', 'messages']),
    handler: async (_ctx, i) => agentChat(i),
  },
  {
    name: 'polypad_longbow_markets',
    title: 'Longbow lending markets',
    description: 'Longbow lending markets on Robinhood Chain (Morpho Blue): collateral, loan token, price, LLTV, oracle, borrow and supply APR, utilization, and whether the market is live. Read-only; Longbow settles on Morpho Blue and its own contracts are not published as audited.',
    kind: 'read', method: 'GET', path: 'longbow/markets',
    inputSchema: obj({
      category: str('Filter by category: Stocks, Memes, RWA, Crypto, or Stables.'),
      oracleType: str('Filter by oracle: chainlink, twap, or api3.', { enum: ['chainlink', 'twap', 'api3'] }),
      liveOnly: bool('Only markets that are live and enabled. Default true.'),
      limit: int('How many to return, 1 to 100. Default 50.', { minimum: 1, maximum: 100 }),
    }),
    handler: async (ctx, i) => listLongbowMarkets(ctx, i),
  },
  {
    name: 'polypad_longbow_market',
    title: 'Longbow market details',
    description: 'One Longbow market: price, LLTV, oracle, rates, utilization, and its on-chain Morpho totals, plus whether it passes the prepare screen (Chainlink-priced, LLTV within the limit). Read-only.',
    kind: 'read', method: 'GET', path: 'longbow/market',
    inputSchema: obj({ market: str('Market key (ETH, NVDA, SPY), symbol, name, or marketId.') }, ['market']),
    handler: async (ctx, i) => getLongbowMarket(ctx, i),
  },
  {
    name: 'polypad_longbow_position',
    title: 'Longbow position',
    description: 'A wallet\u2019s position in one Longbow market: collateral posted, debt, supply and borrow shares, health factor, and liquidation price. Read-only. The health factor uses Longbow\u2019s price and Morpho\u2019s stored totals, which are stale since the market\u2019s last interaction.',
    kind: 'read', method: 'GET', path: 'longbow/position',
    inputSchema: obj({ market: str('Market key (ETH, NVDA, SPY), symbol, name, or marketId.'), address: str('Wallet address (0x...).') }, ['market', 'address']),
    handler: async (ctx, i) => getLongbowPosition(ctx, i),
  },
  {
    name: 'polypad_longbow_vaults',
    title: 'Longbow vaults',
    description: 'Longbow\u2019s three ERC-4626 vaults (Core, Frontier, ETH): asset, TVL, APY, risk, performance fee, and the markets each one supplies. Read-only. APY is a reading, not a promise.',
    kind: 'read', method: 'GET', path: 'longbow/vaults',
    inputSchema: obj({}),
    handler: async (ctx) => listLongbowVaults(ctx, {}),
  },
  {
    name: 'polypad_longbow_plan_multiply',
    title: 'Plan a Longbow multiply',
    description: 'Leverage analysis for a Longbow multiply: borrow USDG against WETH collateral, swap it for more WETH on Uniswap V4, post it as collateral — one atomic bundle, no flash loan. Returns whether it is feasible at the 1.15 health-factor floor, the maximum borrow, the swap quote, the resulting health factor, liquidation price, and leverage. Read-only; the prepare tool is gated until the legal review is complete.',
    kind: 'read', method: 'GET', path: 'longbow/plan-multiply',
    inputSchema: obj({
      market: str('Market key (ETH, NVDA, SPY), symbol, name, or marketId. Multiply needs a WETH-collateral market.'),
      collateralAmountEth: str('New WETH collateral to post, as a decimal such as 0.1. Omit it to borrow against collateral already posted.'),
      collateralAmount: str('Same in WETH base units (18 decimals). Use instead of collateralAmountEth.'),
      borrowAmountUsdg: str('USDG to borrow, as a decimal such as 100.'),
      amount: str('Same in USDG base units (6 decimals). Use instead of borrowAmountUsdg.'),
      address: str('Wallet address, to include its existing collateral and debt in the plan.'),
      slippageBps: SLIP,
    }, ['market']),
    handler: async (ctx, i) => planLongbowMultiply(ctx, i),
  },
  {
    name: 'polypad_prepare_longbow_supply',
    title: 'Prepare a Longbow vault deposit',
    description: 'Prepares depositing USDG (Core / Frontier vault) or WETH (ETH vault) into a Longbow ERC-4626 vault. Adds the exact-amount approval step if needed, simulates step 1, and returns unsigned transactions, a summary, and a signing link. Never signs. Built but gated: it refuses until LONGBOW_PREPARE_ENABLED is on.',
    kind: 'prepare', method: 'POST', path: 'prepare/longbow-supply',
    inputSchema: obj({ from: FROM, vault: str('Vault key: core, frontier, or eth (or the vault address).'), amountUsdg: str('USDG to supply, as a decimal such as 100. USDG vaults only.'), amountEth: str('WETH to supply, as a decimal such as 0.1. ETH vault only.'), amount: str('Same in base units (6 decimals for USDG, 18 for WETH). Use instead of amountUsdg / amountEth.'), confirmLarge: CONFIRM, ref: REF, returnUrl: RETURN_URL, walletToken: WALLET_TOKEN }, ['from', 'vault']),
    handler: async (ctx, i, m) => prepareLongbowSupply(ctx, i, m),
  },
  {
    name: 'polypad_prepare_longbow_borrow',
    title: 'Prepare a Longbow borrow',
    description: 'Prepares borrowing USDG against collateral in a Longbow market, optionally posting new collateral in the same action. Refuses when the market fails the screen (Chainlink-priced, LLTV within the limit) or the resulting health factor would fall below 1.15. Returns unsigned transactions, the resulting health factor and liquidation price, and a signing link. Never signs. Built but gated: it refuses until LONGBOW_PREPARE_ENABLED is on.',
    kind: 'prepare', method: 'POST', path: 'prepare/longbow-borrow',
    inputSchema: obj({ from: FROM, market: str('Market key (ETH, NVDA, SPY), symbol, name, or marketId.'), amountUsdg: str('USDG to borrow, as a decimal such as 100.'), amount: str('Same in USDG base units (6 decimals). Use instead of amountUsdg.'), collateralAmountEth: str('New WETH collateral to post, as a decimal such as 0.1. WETH-collateral markets only.'), collateralAmount: str('New collateral in base units. Use instead of collateralAmountEth.'), confirmLarge: CONFIRM, ref: REF, returnUrl: RETURN_URL, walletToken: WALLET_TOKEN }, ['from', 'market']),
    handler: async (ctx, i, m) => prepareLongbowBorrow(ctx, i, m),
  },
  {
    name: 'polypad_prepare_longbow_repay',
    title: 'Prepare a Longbow repayment',
    description: 'Prepares repaying USDG debt in a Longbow market, in part or in full (all: true burns the borrow shares, so it stays correct as interest accrues). Returns unsigned transactions, the debt left after, and a signing link. Never signs. Built but gated: it refuses until LONGBOW_PREPARE_ENABLED is on.',
    kind: 'prepare', method: 'POST', path: 'prepare/longbow-repay',
    inputSchema: obj({ from: FROM, market: str('Market key (ETH, NVDA, SPY), symbol, name, or marketId.'), amountUsdg: str('USDG to repay, as a decimal such as 100.'), amount: str('Same in USDG base units (6 decimals). Use instead of amountUsdg.'), all: bool('Repay the whole debt. Use instead of an amount.'), confirmLarge: CONFIRM, ref: REF, returnUrl: RETURN_URL, walletToken: WALLET_TOKEN }, ['from', 'market']),
    handler: async (ctx, i, m) => prepareLongbowRepay(ctx, i, m),
  },
  {
    name: 'polypad_prepare_longbow_add_collateral',
    title: 'Prepare adding Longbow collateral',
    description: 'Prepares posting more collateral in a Longbow market. Adds the exact-amount approval step if needed, simulates step 1, and returns unsigned transactions, the health factor after, and a signing link. Never signs. Built but gated: it refuses until LONGBOW_PREPARE_ENABLED is on.',
    kind: 'prepare', method: 'POST', path: 'prepare/longbow-add-collateral',
    inputSchema: obj({ from: FROM, market: str('Market key (ETH, NVDA, SPY), symbol, name, or marketId.'), amountEth: str('Collateral to post, as a decimal such as 0.1. WETH-collateral markets only.'), amount: str('Same in base units. Use instead of amountEth.'), confirmLarge: CONFIRM, ref: REF, returnUrl: RETURN_URL, walletToken: WALLET_TOKEN }, ['from', 'market']),
    handler: async (ctx, i, m) => prepareLongbowAddCollateral(ctx, i, m),
  },
  {
    name: 'polypad_prepare_longbow_withdraw_collateral',
    title: 'Prepare withdrawing Longbow collateral',
    description: 'Prepares withdrawing collateral from a Longbow market, in part or in full (all: true). Refuses when the health factor after would fall below 1.15. Returns the unsigned transaction, the health factor after, and a signing link. Never signs. Built but gated: it refuses until LONGBOW_PREPARE_ENABLED is on.',
    kind: 'prepare', method: 'POST', path: 'prepare/longbow-withdraw-collateral',
    inputSchema: obj({ from: FROM, market: str('Market key (ETH, NVDA, SPY), symbol, name, or marketId.'), amountEth: str('Collateral to withdraw, as a decimal such as 0.1. WETH-collateral markets only.'), amount: str('Same in base units. Use instead of amountEth.'), all: bool('Withdraw all posted collateral. Use instead of an amount.'), ref: REF, returnUrl: RETURN_URL, walletToken: WALLET_TOKEN }, ['from', 'market']),
    handler: async (ctx, i, m) => prepareLongbowWithdrawCollateral(ctx, i, m),
  },
  {
    name: 'polypad_prepare_longbow_close',
    title: 'Prepare closing a Longbow position',
    description: 'Prepares closing a Longbow position: repays the whole debt (by burning the borrow shares) and withdraws all posted collateral. Returns unsigned transactions and a signing link. Never signs. Built but gated: it refuses until LONGBOW_PREPARE_ENABLED is on.',
    kind: 'prepare', method: 'POST', path: 'prepare/longbow-close',
    inputSchema: obj({ from: FROM, market: str('Market key (ETH, NVDA, SPY), symbol, name, or marketId.'), ref: REF, returnUrl: RETURN_URL, walletToken: WALLET_TOKEN }, ['from', 'market']),
    handler: async (ctx, i, m) => prepareLongbowClose(ctx, i, m),
  },
  {
    name: 'polypad_prepare_longbow_multiply',
    title: 'Prepare a Longbow multiply',
    description: 'Prepares a Longbow multiply in one atomic Bundler3 bundle: borrow USDG against WETH collateral, swap it for more WETH on Uniswap V4, post the WETH as more collateral. No flash loan — the borrow is sized so the position stays above the 1.15 health-factor floor before the swap. WETH-collateral markets only. Returns unsigned transactions, the resulting health factor, liquidation price, and leverage, and a signing link. Never signs. Built but gated: it refuses until LONGBOW_PREPARE_ENABLED is on.',
    kind: 'prepare', method: 'POST', path: 'prepare/longbow-multiply',
    inputSchema: obj({ from: FROM, market: str('Market key (ETH, NVDA, SPY), symbol, name, or marketId. WETH-collateral markets only.'), borrowAmountUsdg: str('USDG to borrow, as a decimal such as 100.'), amount: str('Same in USDG base units (6 decimals). Use instead of borrowAmountUsdg.'), collateralAmountEth: str('New WETH collateral to post, as a decimal such as 0.1. Omit it to borrow against collateral already posted.'), collateralAmount: str('Same in WETH base units (18 decimals). Use instead of collateralAmountEth.'), slippageBps: SLIP, confirmLarge: CONFIRM, ref: REF, returnUrl: RETURN_URL, walletToken: WALLET_TOKEN }, ['from', 'market']),
    handler: async (ctx, i, m) => prepareLongbowMultiply(ctx, i, m),
  },
  {
    name: 'polypad_prepare_longbow_stake_bow',
    title: 'Prepare staking BOW',
    description: 'Prepares staking BOW in Longbow\u2019s staking contract to earn USDG (borrower interest and a share of BOW trading fees, streamed per second). No lock, no cooldown. Adds the exact-amount approval step if needed, simulates step 1, and returns unsigned transactions, a summary, and a signing link. Never signs. Built but gated: it refuses until LONGBOW_PREPARE_ENABLED is on.',
    kind: 'prepare', method: 'POST', path: 'prepare/longbow-stake-bow',
    inputSchema: obj({ from: FROM, amountBow: str('BOW to stake, as a decimal such as 100.'), amount: str('Same in BOW base units (18 decimals). Use instead of amountBow.'), confirmLarge: CONFIRM, ref: REF, returnUrl: RETURN_URL, walletToken: WALLET_TOKEN }, ['from']),
    handler: async (ctx, i, m) => prepareLongbowStakeBow(ctx, i, m),
  },
  {
    name: 'polypad_prepare_longbow_claim_rebate',
    title: 'Prepare claiming a Longbow borrow rebate',
    description: 'Claims a Longbow borrow rebate for one epoch from the Merkle distributor. Currently refuses: the distributor is verified on-chain, but the exact claim function and the per-epoch Merkle proof source are not, so no claim transaction can be built correctly yet. Claim from Longbow\u2019s staking page until this tool is completed. Built but gated: it refuses until LONGBOW_PREPARE_ENABLED is on.',
    kind: 'prepare', method: 'POST', path: 'prepare/longbow-claim-rebate',
    inputSchema: obj({ from: FROM, epoch: int('The rebate epoch to claim.', { minimum: 1 }), ref: REF, returnUrl: RETURN_URL, walletToken: WALLET_TOKEN }, ['from', 'epoch']),
    handler: async (ctx, i, m) => prepareLongbowClaimRebate(ctx, i, m),
  },
];

/** Tools visible in the index and in tools/list. Phase 2 Longbow prepares stay hidden until LONGBOW_PREPARE_ENABLED is on. The registry itself (and tools_v2.json) always lists all of them. */
function visibleTools(): Tool[] {
  return longbowPrepareEnabled() ? TOOLS : TOOLS.filter((t) => !isLongbowPrepareTool(t.name));
}

export function indexBody(): Json {
  const shown = visibleTools();
  return {
    ok: true,
    name: 'Polypad agent API',
    version: API_VERSION,
    chainId: CHAIN_ID,
    chain: 'Robinhood Chain',
    custody: 'non-custodial',
    description: 'Browse launches, funds, and NFTs. Prepare buys, sells, NFT purchases, fund launches and investments, and token launches. Every write returns an unsigned transaction, a summary, and a signing link. Polypad never holds or accepts keys.',
    mcp: { url: `${SITE_ORIGIN}/api/mcp`, transport: 'streamable-http, stateless', auth: 'none', tools: shown.map((t) => t.name), skills: SKILLS.map((s) => s.name), skillsExtension: 'io.modelcontextprotocol/skills' },
    rateLimits: { read: `${LIMITS.rate.read.limit}/min/ip`, prepare: `${LIMITS.rate.prepare.limit}/min/ip and ${LIMITS.rate.perWalletPrepare.limit}/min/wallet`, intent: `${LIMITS.rate.intent.limit}/min/ip` },
    limits: { defaultSlippageBps: LIMITS.defaultSlippageBps, maxSlippageBps: LIMITS.maxSlippageBps, confirmAboveEth: Number(LIMITS.confirmLargeWei / 10n ** 18n), maxActionEth: Number(LIMITS.maxActionWei / 10n ** 18n) },
    headers: { 'x-polypad-client': 'Optional client name, 1 to 64 characters, for traffic measurement.' },
    endpoints: shown.map((t) => ({ tool: t.name, method: t.method, path: `/api/agents/v2/${t.path}`, kind: t.kind, summary: t.title })),
    v1: '/api/agents/v1',
    factories: { launch: ADDR.launchFactories[0].factory, fundsPhase6: ADDR.fundFactories[0].factory },
    disclaimer: WORDING.notAudited,
  };
}

/** Run a tool with rate limiting, key guard, and error mapping done by the caller. */
export async function runTool(ctx: Ctx, tool: Tool, input: Json, meta: Meta, limit = true): Promise<Json> {
  // The /sign page is Polypad's own first-party client: it rebuilds an action
  // for the wallet the user connected, and the user signs it and pays their
  // own gas. The action's link was minted by an allowlisted caller, so the
  // API-key allowlist — which gates the metered API/MCP surface — does not
  // apply to this signing flow. Scoped to prepare tools only: agent chat
  // (metered OpenAI, kind 'read') stays gated.
  const signPagePrepare = meta.client === 'sign-page' && tool.kind === 'prepare';
  if (tool.requiresAllowlistedKey && !isAgentChatAllowed(meta.keyId) && !signPagePrepare) {
    // Status-only log: never the key or the key id.
    console.warn('[agent-chat] key not allowlisted');
    throw new ApiError(403, 'tool_not_available', 'This tool is only available to allowlisted business API keys.');
  }
  // Longbow Phase 2 prepares are built but gated: they refuse (MCP, REST,
  // and nested intent calls all go through here) until the legal memo clears
  // LONGBOW_PREPARE_ENABLED. The read tools are unaffected.
  if (isLongbowPrepareTool(tool.name) && !longbowPrepareEnabled()) {
    throw new ApiError(409, 'longbow_prepare_disabled', 'Longbow prepare tools are built but not enabled yet. They stay off until the legal review is complete (LONGBOW_PREPARE_ENABLED). The Longbow read tools work now.');
  }
  if (tool.kind === 'prepare' || tool.name === 'polypad_intent') bodyGuard(input);
  // A wallet token resolves `from` before the per-wallet limit is counted, so the bound wallet —
  // not a missing address — is what the limit sees. A bad token or a token/`from` mismatch fails here.
  if (tool.kind === 'prepare') await applyWalletBinding(input);
  if (limit) {
    const wallet = typeof input.from === 'string' && isAddress(input.from, { strict: false }) ? getAddress(input.from) : null;
    takeLimit(ctx, tool.kind === 'prepare' ? 'prepare' : tool.name === 'polypad_intent' ? 'intent' : 'read', meta, wallet);
  }
  return tool.handler(ctx, input, meta);
}
