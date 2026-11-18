// Launch reads shared by the client hooks (lib/hooks/use-launches.ts) and the server cache (lib/launches-server.ts).
import { formatEther, parseAbiItem, type PublicClient } from 'viem';
import { PolydashFactoryABI, PolydashLaunchABI, PolydashTokenABI } from '@/lib/contracts/abis';
import type { LaunchToken } from '@/lib/token-types';
import { cleanLine, cleanText, safeHttpUrl } from '@/lib/sanitize';

export const DEPLOY_BLOCK = BigInt(85405135);
export const BOUGHT = parseAbiItem('event Bought(address indexed buyer, uint256 ethIn, uint256 tokensOut, uint256 platformFee, uint256 creatorFee, uint256 price)');
export const SOLD = parseAbiItem('event Sold(address indexed seller, uint256 tokensIn, uint256 ethOut, uint256 platformFee, uint256 creatorFee, uint256 price)');

const LAUNCH_FIELDS = ['token', 'creator', 'creatorFeeBps', 'phase', 'spotPrice', 'realEthRaised', 'graduationThreshold', 'tokensSold', 'curveSupply', 'totalSupply', 'virtualEth', 'launchTime', 'graduated', 'k', 'totalCommitted', 'committersLength', 'commitmentCursor'] as const;
const TOKEN_FIELDS = ['name', 'symbol', 'imageUri', 'description', 'socialLinks'] as const;

/**
 * Agent Swarm (SWARM) image override — the on-chain imageUri points at a
 * Muse-hosted URL that expires Nov 18, 2026, and the launch factory has no
 * imageUri setter, so the on-chain URI is effectively immutable. The image
 * is pinned on IPFS (CID bafybeihk6cgm5ndcrmy6cucrqz44xzqxa3sz3vkqmasj6ubfnpai7rwrkm);
 * serve it via Pinata's gateway (ipfs.io is unreliable behind Cloudflare bot
 * protection — verified: Pinata gateway returns the image, ipfs.io 403s).
 * Targeted at this token address only; every other token keeps its on-chain URI.
 */
const SWARM_TOKEN_ADDRESS = '0x3da9244dde38284017fd15e45d1fdf66d3617b4b';
const SWARM_IMAGE_URI = 'https://gateway.pinata.cloud/ipfs/bafybeihk6cgm5ndcrmy6cucrqz44xzqxa3sz3vkqmasj6ubfnpai7rwrkm';

/**
 * The chain RPC caps eth_getLogs at 100,000 blocks per request when the filter
 * has more than one value per position (a multi-address query), and 10M blocks
 * when it has exactly one (verified live: a 2-address 9M-block range is
 * rejected, a 1-address 9M-block range and a 2-address 99k-block range work).
 * Split accordingly: 99k-block ranges for multi-value filters, 9M for
 * single-value ones. Narrow scans run in batches of 8 — a full
 * deploy→latest scan is ~320 ranges, and firing them all at once gets
 * rate-limited.
 */
const LOG_CHUNK_WIDE = BigInt(9_000_000);
const LOG_CHUNK_NARROW = BigInt(99_000);
const NARROW_CONCURRENCY = 8;
export async function getLogsFromDeploy<T>(client: PublicClient, query: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>, opts?: { narrow?: boolean }): Promise<T[]> {
  const latest = await client.getBlockNumber();
  const chunk = opts?.narrow ? LOG_CHUNK_NARROW : LOG_CHUNK_WIDE;
  const ranges: [bigint, bigint][] = [];
  for (let s = DEPLOY_BLOCK; s <= latest; s += chunk) {
    const e = s + chunk - BigInt(1);
    ranges.push([s, e > latest ? latest : e]);
  }
  if (opts?.narrow) {
    const out: T[] = [];
    for (let i = 0; i < ranges.length; i += NARROW_CONCURRENCY) {
      const parts = await Promise.all(ranges.slice(i, i + NARROW_CONCURRENCY).map(([f, t]) => query(f, t)));
      out.push(...parts.flat());
    }
    return out;
  }
  const parts = await Promise.all(ranges.map(([f, t]) => query(f, t)));
  return parts.flat();
}

/** null = volume unknown (the RPC rejected the log query, e.g. multi-address ranges); UI shows an em dash instead of $0. */
async function fetchVolumes(client: PublicClient, launches: `0x${string}`[]): Promise<Record<string, number> | null> {
  const vol: Record<string, number> = {};
  if (launches.length === 0) return vol;
  try {
    const narrow = launches.length > 1;
    const [buys, sells] = await Promise.all([
      getLogsFromDeploy(client, (fromBlock, toBlock) => client.getLogs({ address: launches, event: BOUGHT, fromBlock, toBlock }), { narrow }),
      getLogsFromDeploy(client, (fromBlock, toBlock) => client.getLogs({ address: launches, event: SOLD, fromBlock, toBlock }), { narrow }),
    ]);
    for (const l of buys) vol[l.address.toLowerCase()] = (vol[l.address.toLowerCase()] ?? 0) + Number(formatEther(l.args.ethIn ?? BigInt(0)));
    for (const l of sells) vol[l.address.toLowerCase()] = (vol[l.address.toLowerCase()] ?? 0) + Number(formatEther(l.args.ethOut ?? BigInt(0)));
  } catch (e) {
    console.warn('Trade volume unavailable', (e as Error)?.message?.slice(0, 160));
    return null;
  }
  return vol;
}

/** Launch addresses from every factory, in factory order.
 * `strict`: throw instead of returning a partial/empty list when any factory
 * lookup failed, so an empty result always means every factory genuinely
 * reports zero launches. A flaky refetch then keeps the last good data
 * instead of blanking the list. */
export async function fetchLaunchAddresses(client: PublicClient, factories: `0x${string}`[], strict = false): Promise<`0x${string}`[]> {
  const lists = await Promise.all(factories.map(async (factory) => {
    const len = (await client.readContract({ address: factory, abi: PolydashFactoryABI, functionName: 'allLaunchesLength' })) as bigint;
    const n = Number(len);
    if (n === 0) return [] as `0x${string}`[];
    const addrRes = await client.multicall({
      contracts: Array.from({ length: n }, (_, i) => ({ address: factory, abi: PolydashFactoryABI, functionName: 'allLaunches', args: [BigInt(i)] })) as any,
      allowFailure: true,
    });
    if (strict && addrRes.some((r) => r.status !== 'success')) throw new Error('launch address lookup inconclusive');
    return addrRes.filter((r) => r.status === 'success').map((r) => r.result as `0x${string}`);
  }));
  return lists.flat();
}

/** True if any factory recognises the address as one of its launches. */
export async function isFactoryLaunch(client: PublicClient, factories: `0x${string}`[], address: `0x${string}`): Promise<boolean> {
  const checks = await client.multicall({
    contracts: factories.map((f) => ({ address: f, abi: PolydashFactoryABI, functionName: 'isLaunch', args: [address] })) as any,
    allowFailure: true,
  });
  return checks.some((r) => r.status === 'success' && r.result === true);
}

/**
 * Resolve a token OR launch contract address to the launch address, across every known factory.
 * Order: the address itself is a launch → token.launch() verified by isLaunch → factory.launchOfToken(token). null if none match.
 */
/** `strict`: throw instead of returning null when any factory lookup failed, so null always means "not a launch". */
export async function resolveLaunchAddress(client: PublicClient, factories: `0x${string}`[], address: `0x${string}`, strict = false): Promise<`0x${string}` | null> {
  if (factories.length === 0 || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
  const [launchOfToken, ...isLaunchRes] = await client.multicall({
    contracts: [
      { address, abi: PolydashTokenABI, functionName: 'launch' },
      ...factories.map((f) => ({ address: f, abi: PolydashFactoryABI, functionName: 'isLaunch', args: [address] })),
    ] as any,
    allowFailure: true,
  });
  if (isLaunchRes.some((r) => r.status === 'success' && r.result === true)) return address;
  const viaToken = launchOfToken?.status === 'success' ? (launchOfToken.result as `0x${string}`) : undefined;
  if (viaToken && viaToken.toLowerCase() !== ZERO_ADDR && (await isFactoryLaunch(client, factories, viaToken))) return viaToken;
  const lookups = await client.multicall({
    contracts: factories.map((f) => ({ address: f, abi: PolydashFactoryABI, functionName: 'launchOfToken', args: [address] })) as any,
    allowFailure: true,
  });
  const hit = lookups.find((r) => r.status === 'success' && typeof r.result === 'string' && r.result.toLowerCase() !== ZERO_ADDR);
  if (hit) return hit.result as `0x${string}`;
  if (strict && [...isLaunchRes, ...lookups].some((r) => r.status !== 'success')) throw new Error('launch lookup inconclusive');
  return null;
}

export async function fetchLaunchDetails(client: PublicClient, addrs: `0x${string}`[], ethUsd: number): Promise<LaunchToken[]> {
  if (addrs.length === 0) return [];
  const launchRes = await client.multicall({
    contracts: addrs.flatMap((a) => LAUNCH_FIELDS.map((f) => ({ address: a, abi: PolydashLaunchABI, functionName: f }))) as any,
    allowFailure: true,
  });
  const perLaunch = addrs.map((_, i) => {
    const slice = launchRes.slice(i * LAUNCH_FIELDS.length, (i + 1) * LAUNCH_FIELDS.length);
    const o: Record<string, any> = {};
    LAUNCH_FIELDS.forEach((f, j) => { o[f] = slice[j]?.status === 'success' ? slice[j].result : undefined; });
    return o;
  });
  // Wholesale read failure (no launch field readable at all) is inconclusive,
  // not an empty result: throw so a flaky refetch keeps the last good data
  // instead of replacing real tokens with 'Unknown' rows.
  if (perLaunch.length > 0 && perLaunch.every((l) => l.token === undefined)) {
    throw new Error('launch details lookup inconclusive');
  }
  const tokenAddrs = perLaunch.map((l) => l.token as `0x${string}` | undefined);
  const tokenRes = await client.multicall({
    contracts: tokenAddrs.flatMap((t) => TOKEN_FIELDS.map((f) => ({ address: t ?? '0x0000000000000000000000000000000000000000', abi: PolydashTokenABI, functionName: f }))) as any,
    allowFailure: true,
  });
  const vols = await fetchVolumes(client, addrs);

  return addrs.map((addr, i) => {
    const l = perLaunch[i];
    const tslice = tokenRes.slice(i * TOKEN_FIELDS.length, (i + 1) * TOKEN_FIELDS.length);
    const t: Record<string, any> = {};
    TOKEN_FIELDS.forEach((f, j) => { t[f] = tslice[j]?.status === 'success' ? tslice[j].result : undefined; });
    const zero = BigInt(0);
    const priceEth = Number(formatEther((l.spotPrice as bigint) ?? zero));
    const totalSupplyTokens = Number(formatEther((l.totalSupply as bigint) ?? zero));
    const raised = Number(formatEther((l.realEthRaised as bigint) ?? zero));
    const threshold = Number(formatEther((l.graduationThreshold as bigint) ?? zero));
    const phase = Number(l.phase ?? 0);
    const graduated = Boolean(l.graduated) || phase === 4;
    const progress = graduated ? 100 : threshold > 0 ? Math.min(100, Math.round((raised / threshold) * 1000) / 10) : 0;
    const volEth = vols ? vols[addr.toLowerCase()] ?? 0 : null;
    return {
      launchAddress: addr,
      tokenAddress: (l.token as string) ?? '',
      name: cleanLine(t.name, 64) || 'Unknown',
      symbol: cleanLine(t.symbol, 32) || '???',
      imageUri: (l.token as string)?.toLowerCase() === SWARM_TOKEN_ADDRESS ? SWARM_IMAGE_URI : (t.imageUri as string) ?? '',
      description: cleanText(t.description, 2000),
      creator: (l.creator as string) ?? '',
      creatorFeeBps: Number(l.creatorFeeBps ?? 0),
      curveProgress: progress,
      marketCapUsd: priceEth * totalSupplyTokens * ethUsd,
      volumeUsd: volEth == null ? null : volEth * ethUsd,
      priceEth,
      ethRaised: raised,
      graduationThreshold: threshold,
      graduated,
      totalSupply: String(Math.round(totalSupplyTokens)),
      socialLinks: ((t.socialLinks as string[]) ?? []).map((s) => safeHttpUrl(s, 512)).filter((s): s is string => !!s),
      createdAt: Number(l.launchTime ?? 0) * 1000,
      phase,
      launchTime: Number(l.launchTime ?? 0) * 1000,
      totalCommitted: Number(formatEther((l.totalCommitted as bigint) ?? zero)),
      committers: Number(l.committersLength ?? 0),
      commitmentCursor: Number(l.commitmentCursor ?? 0),
      virtualEthWei: String(l.virtualEth ?? 0),
      curveSupplyWei: String(l.curveSupply ?? 0),
      tokensSoldWei: String(l.tokensSold ?? 0),
      kWei: String(l.k ?? 0),
    } satisfies LaunchToken;
  });
}
