/**
 * Polypad agent launch API.
 *
 * Validates `createLaunch` parameters, simulates the call with eth_call, and
 * returns an unsigned transaction. The caller signs and broadcasts it.
 * This module never reads a private key.
 */

import {
  BaseError,
  createPublicClient,
  decodeErrorResult,
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  zeroAddress,
  type Hex,
  type PublicClient,
} from 'viem';
import { robinhoodChain } from './chain';
import { createRateLimiter, clientIp } from './logo-upload';
import {
  AGENT_LAUNCH_MARK,
  MAX_SOCIAL_LINKS,
  applyAgentMark,
  isAgentLaunchMark,
  normalizeRepository,
} from './agent-mark';

export const AGENT_API_VERSION = 'v1';
export const POLYPAD_CHAIN_ID = 4663;
export const POLYPAD_CHAIN_NAME = 'Robinhood Chain';
export const POLYPAD_FACTORY = '0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2' as const;

export const MAX_CREATOR_FEE_BPS = 500;
export const MAX_NAME_BYTES = 64;
export const MAX_SYMBOL_BYTES = 32;
export const MAX_DESCRIPTION_CHARS = 2000;
export const MAX_IMAGE_CHARS = 512;
export const MAX_LINK_CHARS = 256;
export const MAX_LAUNCH_DELAY_SECONDS = 2592000;
export const MIN_TOTAL_SUPPLY_WEI = 1_000_000n * 10n ** 18n;
export const MAX_TOTAL_SUPPLY_WEI = 1_000_000_000_000n * 10n ** 18n;
export const MIN_VIRTUAL_ETH_WEI = 10n ** 16n;
export const MAX_VIRTUAL_ETH_WEI = 1000n * 10n ** 18n;
export const MAX_BODY_BYTES = 16_384;

export const AGENT_RATE_LIMIT = 20;
export const AGENT_RATE_WINDOW_MS = 600000;

/** Factory errors the simulator knows how to name. The ABI fragment is not the deployed source. */
export const CREATE_LAUNCH_ABI = [
  {
    type: 'function',
    name: 'createLaunch',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'p',
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'symbol', type: 'string' },
          { name: 'imageUri', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'socialLinks', type: 'string[]' },
          { name: 'creatorFeeBps', type: 'uint256' },
          { name: 'creatorPayoutWallet', type: 'address' },
          { name: 'devBuyEth', type: 'uint256' },
          { name: 'totalSupply', type: 'uint256' },
          { name: 'virtualEthReserve', type: 'uint256' },
          { name: 'launchDelay', type: 'uint256' },
        ],
      },
    ],
    outputs: [
      { name: 'launch', type: 'address' },
      { name: 'token', type: 'address' },
    ],
  },
  { type: 'error', name: 'InvalidParams', inputs: [] },
  { type: 'error', name: 'HookNotSet', inputs: [] },
  { type: 'error', name: 'UnexpectedEth', inputs: [] },
  { type: 'error', name: 'NotLaunch', inputs: [] },
  { type: 'error', name: 'EthTransferFailed', inputs: [] },
  { type: 'error', name: 'Error', inputs: [{ name: 'message', type: 'string' }] },
  { type: 'error', name: 'Panic', inputs: [{ name: 'code', type: 'uint256' }] },
] as const;

export type RateLimiter = { allow: (key: string) => boolean };

export const agentRateLimiter = createRateLimiter(AGENT_RATE_LIMIT, AGENT_RATE_WINDOW_MS);

export type FieldErrors = Record<string, string>;

export type NormalizedLaunch = {
  from?: `0x${string}`;
  name: string;
  symbol: string;
  imageUri: string;
  description: string;
  socialLinks: string[];
  creatorFeeBps: number;
  creatorPayoutWallet: `0x${string}`;
  devBuyEth: bigint;
  totalSupply: bigint;
  virtualEthReserve: bigint;
  launchDelay: bigint;
  agentLaunched: boolean;
  repository: string | null;
};

export type EthCallRequest = {
  from: `0x${string}`;
  to: `0x${string}`;
  data: Hex;
  value: bigint;
};

export type EthCallOutcome =
  | { ok: true; data: Hex; gas?: bigint }
  | { ok: false; kind: 'revert'; data?: Hex }
  | { ok: false; kind: 'rpc' };

export type AgentHttpResult = {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
};

export type AgentLaunchDeps = {
  limiter?: RateLimiter;
  ethCall?: (req: EthCallRequest) => Promise<EthCallOutcome>;
  factory?: `0x${string}`;
  chainId?: number;
  now?: () => number;
  randomId?: () => string;
};

type MarkRecord = {
  id: string;
  from: string;
  name: string;
  symbol: string;
  client: string | null;
  at: number;
  simulated: boolean;
};

const launchLog: MarkRecord[] = [];

export function clearAgentLaunchLog(): void {
  launchLog.length = 0;
}

export function rememberAgentLaunch(record: MarkRecord): void {
  launchLog.push(record);
  if (launchLog.length > 200) launchLog.splice(0, launchLog.length - 200);
}

export function listAgentLaunches(from: string): MarkRecord[] {
  const key = from.toLowerCase();
  return launchLog.filter((row) => row.from.toLowerCase() === key).slice(-50).reverse();
}

export function factoryAddress(): `0x${string}` {
  const env = process.env.NEXT_PUBLIC_FACTORY_ADDRESS?.trim();
  if (env && isAddress(env, { strict: false }) && getAddress(env) !== zeroAddress) return getAddress(env);
  return POLYPAD_FACTORY;
}

export function chainId(): number {
  const raw = process.env.NEXT_PUBLIC_CHAIN_ID?.trim();
  const parsed = raw ? Number(raw) : POLYPAD_CHAIN_ID;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : POLYPAD_CHAIN_ID;
}

export function agentCorsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-polypad-client',
    'access-control-max-age': '86400',
    'cache-control': 'no-store',
  };
}

export function agentIndexBody(factory = factoryAddress(), id = chainId()): Record<string, unknown> {
  return {
    ok: true,
    name: 'Polypad agent launch API',
    version: AGENT_API_VERSION,
    description:
      'Validates createLaunch parameters, simulates the call with eth_call, and returns an unsigned transaction. The caller signs and broadcasts it. Polypad does not accept private keys.',
    chainId: id,
    chain: POLYPAD_CHAIN_NAME,
    factory,
    custody: 'non-custodial',
    docs: 'https://polypad.family/docs#agent-launched',
    agentMark: AGENT_LAUNCH_MARK,
    rateLimit: { limit: AGENT_RATE_LIMIT, windowSeconds: AGENT_RATE_WINDOW_MS / 1000, key: 'client ip' },
    endpoints: {
      validate: { method: 'POST', path: '/api/agents/v1/validate' },
      simulate: { method: 'POST', path: '/api/agents/v1/simulate' },
      marks: { method: 'GET', path: '/api/agents/v1/marks' },
    },
  };
}

let rpcClient: PublicClient | undefined;

function getRpcClient(): PublicClient {
  if (!rpcClient) {
    rpcClient = createPublicClient({
      chain: robinhoodChain,
      transport: http(process.env.NEXT_PUBLIC_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'),
    });
  }
  return rpcClient;
}

function revertDataOf(err: unknown): Hex | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const found = err.walk((item) => {
    const data = (item as { data?: unknown }).data;
    return typeof data === 'string' && data.startsWith('0x');
  }) as { data?: string } | null;
  return found && typeof found.data === 'string' ? (found.data as Hex) : undefined;
}

export async function defaultEthCall(req: EthCallRequest): Promise<EthCallOutcome> {
  const client = getRpcClient();
  try {
    const res = await client.call({
      account: req.from,
      to: req.to,
      data: req.data,
      value: req.value,
      gas: 6_000_000n,
    });
    let gas: bigint | undefined;
    try {
      gas = await client.estimateGas({
        account: req.from,
        to: req.to,
        data: req.data,
        value: req.value,
      });
    } catch {
      gas = undefined;
    }
    return { ok: true, data: res.data ?? '0x', gas };
  } catch (err) {
    const data = revertDataOf(err);
    if (data !== undefined) return { ok: false, kind: 'revert', data };
    return { ok: false, kind: 'rpc' };
  }
}

export function decodeRevert(data: Hex | undefined): string {
  if (!data || data === '0x') return 'execution reverted';
  try {
    const decoded = decodeErrorResult({ abi: CREATE_LAUNCH_ABI, data });
    if (decoded.errorName === 'Error') return String(decoded.args[0] ?? 'execution reverted');
    if (decoded.errorName === 'Panic') return `Panic(${String(decoded.args[0])})`;
    return decoded.errorName;
  } catch {
    return 'execution reverted';
  }
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

function hasControl(value: string, allowWhitespace: boolean): boolean {
  if (allowWhitespace) return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
  return /[\u0000-\u001F\u007F]/.test(value);
}

function isKeyField(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z]/g, '');
  return normalized.includes('privatekey') || normalized === 'mnemonic' || normalized === 'seed' || normalized.includes('seedphrase');
}

export function containsKeyMaterial(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => containsKeyMaterial(item));
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => isKeyField(key) || containsKeyMaterial(child));
}

function parseUint(value: unknown, field: string, errors: FieldErrors): bigint | undefined {
  if (value === undefined || value === null || value === '') return 0n;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      errors[field] = 'Use a non-negative base-10 integer string. Floating point is not accepted.';
      return undefined;
    }
    return BigInt(value);
  }
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) {
    errors[field] = 'Use a non-negative base-10 integer string (wei for ETH and token amounts).';
    return undefined;
  }
  const parsed = BigInt(value);
  if (parsed > 2n ** 256n - 1n) {
    errors[field] = 'Exceeds uint256.';
    return undefined;
  }
  return parsed;
}

function parseAddress(
  value: unknown,
  field: string,
  errors: FieldErrors,
  allowZero: boolean,
): `0x${string}` | undefined {
  if (typeof value !== 'string' || !isAddress(value, { strict: false })) {
    errors[field] = 'Expected a 20-byte hex address.';
    return undefined;
  }
  const address = getAddress(value);
  if (!allowZero && address === zeroAddress) {
    errors[field] = 'The zero address cannot sign the transaction.';
    return undefined;
  }
  return address;
}

function pushLink(links: string[], link: string, errors: FieldErrors): void {
  if (links.length >= MAX_SOCIAL_LINKS) {
    errors.socialLinks = `At most ${MAX_SOCIAL_LINKS} social links, including the agent mark and repository.`;
    return;
  }
  if (link.length > MAX_LINK_CHARS || /\s/.test(link)) {
    errors.socialLinks = `Each social link must be a single token of at most ${MAX_LINK_CHARS} characters.`;
    return;
  }
  const allowed = link.startsWith('https://') || link.startsWith('ipfs://') || isAgentLaunchMark(link);
  if (!allowed) {
    errors.socialLinks = 'Social links must be https://, ipfs://, or the documented agent mark.';
    return;
  }
  if (links.includes(link)) {
    errors.socialLinks = 'Duplicate social links are not accepted.';
    return;
  }
  links.push(link);
}

export function validateLaunchBody(
  body: unknown,
  options: { requireFrom: boolean },
): { ok: true; value: NormalizedLaunch } | { ok: false; fields: FieldErrors } {
  const errors: FieldErrors = {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, fields: { body: 'Expected a JSON object.' } };
  }
  const input = body as Record<string, unknown>;

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || hasControl(name, false) || utf8Length(name) > MAX_NAME_BYTES) {
    errors.name = `Required. At most ${MAX_NAME_BYTES} UTF-8 bytes, with no control characters.`;
  }
  const symbol = typeof input.symbol === 'string' ? input.symbol.trim() : '';
  if (!symbol || hasControl(symbol, false) || utf8Length(symbol) > MAX_SYMBOL_BYTES) {
    errors.symbol = `Required. At most ${MAX_SYMBOL_BYTES} UTF-8 bytes, with no control characters.`;
  }

  const imageUri = typeof input.imageUri === 'string' ? input.imageUri.trim() : '';
  if (input.imageUri !== undefined && typeof input.imageUri !== 'string') {
    errors.imageUri = 'Expected a string.';
  } else if (imageUri && (imageUri.length > MAX_IMAGE_CHARS || /\s/.test(imageUri) || !(imageUri.startsWith('https://') || imageUri.startsWith('ipfs://')))) {
    errors.imageUri = 'Use an https:// or ipfs:// URL, or omit it.';
  }

  let description = '';
  if (input.description !== undefined && input.description !== null) {
    if (typeof input.description !== 'string') errors.description = 'Expected a string.';
    else if (input.description.length > MAX_DESCRIPTION_CHARS || hasControl(input.description, true)) {
      errors.description = `At most ${MAX_DESCRIPTION_CHARS} characters.`;
    } else description = input.description.trim();
  }

  const links: string[] = [];
  if (input.socialLinks !== undefined) {
    if (!Array.isArray(input.socialLinks)) errors.socialLinks = 'Expected an array of strings.';
    else {
      for (const entry of input.socialLinks) {
        if (typeof entry !== 'string') {
          errors.socialLinks = 'Expected an array of strings.';
          break;
        }
        const trimmed = entry.trim();
        if (!trimmed) continue;
        pushLink(links, trimmed, errors);
        if (errors.socialLinks) break;
      }
    }
  }

  let repository: string | null = null;
  if (input.repository !== undefined && input.repository !== null && input.repository !== '') {
    if (typeof input.repository !== 'string') errors.repository = 'Expected an https://github.com/owner/repo URL.';
    else {
      repository = normalizeRepository(input.repository);
      if (!repository) errors.repository = 'Expected https://github.com/owner/repo with no extra path.';
      else if (!errors.socialLinks && !links.includes(repository)) pushLink(links, repository, errors);
    }
  }

  let agentLaunched = true;
  if (input.agentMark !== undefined) {
    if (typeof input.agentMark !== 'boolean') errors.agentMark = 'Expected a boolean. Omit it to mark the launch.';
    else agentLaunched = input.agentMark;
  }
  if (!errors.socialLinks) {
    const explicitMark = links.some((link) => isAgentLaunchMark(link));
    const withoutMark = links.filter((link) => !isAgentLaunchMark(link));
    const marked = applyAgentMark(withoutMark, agentLaunched || explicitMark);
    if (marked.error) errors.socialLinks = marked.error;
    else {
      links.length = 0;
      links.push(...marked.links);
    }
  }

  let creatorFeeBps: bigint | undefined;
  if (input.creatorFeeBps === undefined || input.creatorFeeBps === null || input.creatorFeeBps === '') {
    errors.creatorFeeBps = `Required. An integer from 0 to ${MAX_CREATOR_FEE_BPS}. 0 means 0%, not the factory default.`;
  } else {
    creatorFeeBps = parseUint(input.creatorFeeBps, 'creatorFeeBps', errors);
    if (creatorFeeBps !== undefined && creatorFeeBps > BigInt(MAX_CREATOR_FEE_BPS)) {
      errors.creatorFeeBps = `Must be an integer from 0 to ${MAX_CREATOR_FEE_BPS}. 0 means 0%, not the factory default.`;
    }
  }

  let creatorPayoutWallet: `0x${string}` = zeroAddress;
  if (input.creatorPayoutWallet !== undefined && input.creatorPayoutWallet !== null && input.creatorPayoutWallet !== '') {
    const parsed = parseAddress(input.creatorPayoutWallet, 'creatorPayoutWallet', errors, true);
    if (parsed) creatorPayoutWallet = parsed;
  }

  const devBuyEth = parseUint(input.devBuyEth, 'devBuyEth', errors);
  const totalSupply = parseUint(input.totalSupply, 'totalSupply', errors);
  if (totalSupply !== undefined && totalSupply !== 0n && (totalSupply < MIN_TOTAL_SUPPLY_WEI || totalSupply > MAX_TOTAL_SUPPLY_WEI)) {
    errors.totalSupply = 'Use 0 for the factory default (1,000,000,000 tokens, 18 decimals), or a supply from 1,000,000 to 1,000,000,000,000 tokens.';
  }
  const virtualEthReserve = parseUint(input.virtualEthReserve, 'virtualEthReserve', errors);
  if (
    virtualEthReserve !== undefined
    && virtualEthReserve !== 0n
    && (virtualEthReserve < MIN_VIRTUAL_ETH_WEI || virtualEthReserve > MAX_VIRTUAL_ETH_WEI)
  ) {
    errors.virtualEthReserve = 'Use 0 for the factory default (1.5 ETH), or a value from 0.01 ETH to 1,000 ETH, in wei.';
  }
  const launchDelay = parseUint(input.launchDelay, 'launchDelay', errors);
  if (launchDelay !== undefined && launchDelay > BigInt(MAX_LAUNCH_DELAY_SECONDS)) {
    errors.launchDelay = 'Must be from 0 to 2592000 seconds (30 days). 0 opens trading immediately.';
  }

  let from: `0x${string}` | undefined;
  if (input.from !== undefined && input.from !== null && input.from !== '') {
    from = parseAddress(input.from, 'from', errors, false);
  } else if (options.requireFrom) {
    errors.from = 'The address that will sign the transaction is required. Do not send a private key.';
  }

  if (Object.keys(errors).length > 0 || creatorFeeBps === undefined || devBuyEth === undefined || totalSupply === undefined || virtualEthReserve === undefined || launchDelay === undefined) {
    return { ok: false, fields: errors };
  }

  return {
    ok: true,
    value: {
      from,
      name,
      symbol,
      imageUri,
      description,
      socialLinks: links,
      creatorFeeBps: Number(creatorFeeBps),
      creatorPayoutWallet,
      devBuyEth,
      totalSupply,
      virtualEthReserve,
      launchDelay,
      agentLaunched: links.some((link) => isAgentLaunchMark(link)),
      repository,
    },
  };
}

export function encodeCreateLaunch(value: NormalizedLaunch): Hex {
  return encodeFunctionData({
    abi: CREATE_LAUNCH_ABI,
    functionName: 'createLaunch',
    args: [
      {
        name: value.name,
        symbol: value.symbol,
        imageUri: value.imageUri,
        description: value.description,
        socialLinks: value.socialLinks,
        creatorFeeBps: BigInt(value.creatorFeeBps),
        creatorPayoutWallet: value.creatorPayoutWallet,
        devBuyEth: value.devBuyEth,
        totalSupply: value.totalSupply,
        virtualEthReserve: value.virtualEthReserve,
        launchDelay: value.launchDelay,
      },
    ],
  });
}

export function unsignedCreateLaunch(value: NormalizedLaunch, to: `0x${string}`, id: number) {
  const data = encodeCreateLaunch(value);
  return {
    from: value.from,
    to,
    data,
    value: value.devBuyEth.toString(),
    valueHex: `0x${value.devBuyEth.toString(16)}`,
    chainId: id,
  };
}

function serializedParams(value: NormalizedLaunch): Record<string, unknown> {
  return {
    name: value.name,
    symbol: value.symbol,
    imageUri: value.imageUri,
    description: value.description,
    socialLinks: value.socialLinks,
    creatorFeeBps: value.creatorFeeBps,
    creatorPayoutWallet: value.creatorPayoutWallet,
    devBuyEth: value.devBuyEth.toString(),
    totalSupply: value.totalSupply.toString(),
    virtualEthReserve: value.virtualEthReserve.toString(),
    launchDelay: value.launchDelay.toString(),
    agentLaunched: value.agentLaunched,
    repository: value.repository,
  };
}

const SIGNING =
  'Sign unsignedTx with the from address in your own wallet and broadcast it yourself. Polypad does not accept private keys and does not send the transaction.';

function fail(status: number, code: string, message: string, extra?: Record<string, unknown>, headers?: Record<string, string>): AgentHttpResult {
  return {
    status,
    headers,
    body: { ok: false, error: { code, message, ...extra } },
  };
}

async function readBody(req: Request): Promise<{ ok: true; value: unknown } | { ok: false; result: AgentHttpResult }> {
  const declared = req.headers.get('content-length');
  if (declared && Number(declared) > MAX_BODY_BYTES) {
    return { ok: false, result: fail(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.') };
  }
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) {
    return { ok: false, result: fail(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.') };
  }
  if (!text.trim()) return { ok: false, result: fail(400, 'INVALID_JSON', 'Expected a JSON object.') };
  try {
    const value = JSON.parse(text) as unknown;
    if (containsKeyMaterial(value)) {
      return {
        ok: false,
        result: fail(
          400,
          'KEY_MATERIAL_REJECTED',
          'This API does not accept private keys or seed phrases. Sign the returned transaction in your own wallet.',
        ),
      };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, result: fail(400, 'INVALID_JSON', 'Expected a JSON object.') };
  }
}

function clientName(req: Request): string | null {
  const raw = req.headers.get('x-polypad-client')?.trim() ?? '';
  if (!raw || !/^[A-Za-z0-9._:-]{1,64}$/.test(raw)) return null;
  return raw;
}

function takeLimit(req: Request, deps: AgentLaunchDeps): AgentHttpResult | null {
  const limiter = deps.limiter ?? agentRateLimiter;
  if (limiter.allow(clientIp(req))) return null;
  return fail(
    429,
    'RATE_LIMITED',
    'Too many agent launch requests from this IP. Try again later.',
    { retryAfterSeconds: AGENT_RATE_WINDOW_MS / 1000 },
    { 'retry-after': String(AGENT_RATE_WINDOW_MS / 1000) },
  );
}

export async function handleAgentValidate(req: Request, deps: AgentLaunchDeps = {}): Promise<AgentHttpResult> {
  const limited = takeLimit(req, deps);
  if (limited) return limited;
  const body = await readBody(req);
  if (!body.ok) return body.result;
  const validated = validateLaunchBody(body.value, { requireFrom: false });
  if (!validated.ok) {
    return fail(400, 'INVALID_PARAMS', 'Launch parameters do not match the factory limits.', { fields: validated.fields });
  }
  return {
    status: 200,
    body: {
      ok: true,
      chainId: deps.chainId ?? chainId(),
      factory: deps.factory ?? factoryAddress(),
      agentLaunched: validated.value.agentLaunched,
      agentMark: AGENT_LAUNCH_MARK,
      params: serializedParams(validated.value),
      custody: 'non-custodial',
    },
  };
}

export async function handleAgentSimulate(req: Request, deps: AgentLaunchDeps = {}): Promise<AgentHttpResult> {
  const limited = takeLimit(req, deps);
  if (limited) return limited;
  const body = await readBody(req);
  if (!body.ok) return body.result;
  const validated = validateLaunchBody(body.value, { requireFrom: true });
  if (!validated.ok) {
    return fail(400, 'INVALID_PARAMS', 'Launch parameters do not match the factory limits.', { fields: validated.fields });
  }
  const value = validated.value;
  const to = deps.factory ?? factoryAddress();
  const id = deps.chainId ?? chainId();
  const unsignedTx = unsignedCreateLaunch(value, to, id);
  const ethCall = deps.ethCall ?? defaultEthCall;
  let outcome: EthCallOutcome;
  try {
    outcome = await ethCall({ from: value.from as `0x${string}`, to, data: unsignedTx.data, value: value.devBuyEth });
  } catch {
    outcome = { ok: false, kind: 'rpc' };
  }

  const base = {
    chainId: id,
    factory: to,
    agentLaunched: value.agentLaunched,
    agentMark: AGENT_LAUNCH_MARK,
    params: serializedParams(value),
    unsignedTx,
    custody: 'non-custodial',
    signing: SIGNING,
  };

  if (!outcome.ok && outcome.kind === 'rpc') {
    return {
      status: 503,
      body: {
        ok: false,
        ...base,
        error: {
          code: 'RPC_UNAVAILABLE',
          message: 'The Robinhood Chain RPC did not complete eth_call. The unsigned transaction is included so you can simulate it yourself.',
        },
      },
    };
  }

  if (!outcome.ok) {
    const revert = decodeRevert(outcome.data);
    return {
      status: 422,
      body: {
        ok: false,
        ...base,
        simulation: { success: false, revert },
        error: {
          code: 'SIMULATION_REVERTED',
          message: `eth_call reverted (${revert}). The unsigned transaction is included unchanged.`,
          revert,
        },
      },
    };
  }

  let launch: string | null = null;
  let token: string | null = null;
  if (outcome.data && outcome.data !== '0x') {
    try {
      const decoded = decodeFunctionResult({ abi: CREATE_LAUNCH_ABI, functionName: 'createLaunch', data: outcome.data });
      launch = decoded[0];
      token = decoded[1];
    } catch {
      launch = null;
      token = null;
    }
  }

  let requestId: string | undefined;
  if (value.agentLaunched && value.from) {
    requestId = (deps.randomId ?? (() => crypto.randomUUID()))();
    rememberAgentLaunch({
      id: requestId,
      from: value.from,
      name: value.name,
      symbol: value.symbol,
      client: clientName(req),
      at: (deps.now ?? Date.now)(),
      simulated: true,
    });
  }

  return {
    status: 200,
    body: {
      ok: true,
      ...base,
      requestId: requestId ?? null,
      simulation: {
        success: true,
        launch,
        token,
        gas: outcome.gas !== undefined ? outcome.gas.toString() : null,
      },
    },
  };
}

export async function handleAgentMarks(req: Request, deps: AgentLaunchDeps = {}): Promise<AgentHttpResult> {
  const limited = takeLimit(req, deps);
  if (limited) return limited;
  const url = new URL(req.url);
  const from = url.searchParams.get('from')?.trim() ?? '';
  if (!from || !isAddress(from, { strict: false }) || getAddress(from) === zeroAddress) {
    return fail(400, 'INVALID_PARAMS', 'Pass the signer address as the from query parameter.', {
      fields: { from: 'Expected a 20-byte hex address.' },
    });
  }
  return {
    status: 200,
    body: {
      ok: true,
      from: getAddress(from),
      note: 'This log is per server process and is not the badge. The badge is the agent mark stored in socialLinks.',
      marks: listAgentLaunches(from),
    },
  };
}

/** Used by tests to confirm the prepared calldata is the factory function. */
export function decodeCreateLaunch(data: Hex) {
  return decodeFunctionData({ abi: CREATE_LAUNCH_ABI, data });
}
