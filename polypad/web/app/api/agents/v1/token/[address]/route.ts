import { prisma } from '@/lib/db';
import { getLaunchLookup } from '@/lib/launches-server';
import { cleanLine, cleanText, safeHttpUrl } from '@/lib/sanitize';
import { fail, json } from '@/lib/agents-api/core';
import { getHolderProtections } from '@/lib/holder-protections';

export const dynamic = 'force-dynamic';

/** Token state (launch or token address) plus agentLaunched. */
export async function GET(_req: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return fail(400, 'invalid_address', 'address must be a 0x-prefixed 20-byte address.');
  const a = address.toLowerCase();
  try {
    const [{ token, missing }, agent] = await Promise.all([
      getLaunchLookup(a, 6_000),
      prisma.agentLaunch.findFirst({ where: { OR: [{ launchAddress: a }, { tokenAddress: a }] } }),
    ]);
    if (!token) {
      if (missing) return fail(404, 'not_found', 'Not a Polypad launch or token.');
      return fail(503, 'unavailable', 'Token data is not ready yet. Retry shortly.', {}, { 'retry-after': '5' });
    }
    const holderProtections = await getHolderProtections(token.launchAddress).catch(() => null);
    return json({
      launchAddress: token.launchAddress.toLowerCase(),
      tokenAddress: token.tokenAddress.toLowerCase(),
      name: cleanLine(token.name, 64),
      symbol: cleanLine(token.symbol, 16),
      description: cleanText(token.description, 1000),
      imageUri: token.imageUri,
      socialLinks: token.socialLinks.map((l) => safeHttpUrl(l, 256)).filter(Boolean),
      creator: token.creator,
      creatorFeeBps: token.creatorFeeBps,
      phase: token.phase,
      graduated: token.graduated,
      curveProgress: token.curveProgress,
      priceEth: token.priceEth,
      ethRaised: token.ethRaised,
      graduationThreshold: token.graduationThreshold,
      totalSupply: token.totalSupply,
      launchTime: token.launchTime,
      createdAt: token.createdAt,
      agentLaunched: !!agent,
      agent: agent ? { name: agent.agentName, operatorUrl: agent.operatorUrl, txHash: agent.txHash } : null,
      url: `/token/${token.launchAddress.toLowerCase()}`,
      holderProtections,
    }, 200, { 'cache-control': 'public, max-age=15' });
  } catch (e) {
    console.error('agents v1 token failed', e);
    return fail(503, 'unavailable', 'Could not read token data right now.');
  }
}
