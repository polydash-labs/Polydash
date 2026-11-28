import { encodeFunctionData } from 'viem';
import { prisma } from '@/lib/db';
import { PolydashFactoryABI } from '@/lib/contracts/abis';
import { getFactoryAddress } from '@/lib/contracts/addresses';
import {
  CHAIN_ID, TERMS_VERSION, agentClient, allowAttempt, checkBuildLimits, ensureTerms, fail, json, requireKey, shortReason, validateLaunch,
} from '@/lib/agents-api/core';

export const dynamic = 'force-dynamic';

/** Validates params, simulates createLaunch from `from`, and returns an UNSIGNED transaction. */
export async function POST(req: Request) {
  const key = await requireKey(req);
  if (key instanceof Response) return key;
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return fail(400, 'invalid_json', 'Send a JSON body.');
    const v = validateLaunch(body);
    if (!v.ok) return fail(400, 'invalid_params', 'Some parameters are invalid.', { details: v.errors });
    const wallet = v.from.toLowerCase();

    const terms = await ensureTerms([`wallet:${wallet}`, `key:${key.id}`], body);
    if (terms) return terms;
    const limited = await checkBuildLimits(wallet, key.id);
    if (limited) return limited;
    if (!allowAttempt(`sim:${key.id}`, 30, 60 * 60 * 1000)) {
      return fail(429, 'rate_limited', 'Too many simulation attempts: 30 per API key per hour.', { scope: 'api_key', limit: 30, window: '1h', retryAfter: 3600 }, { 'retry-after': '3600' });
    }

    const factory = getFactoryAddress();
    if (!factory) return fail(503, 'unavailable', 'Launches are not available right now.');
    const data = encodeFunctionData({ abi: PolydashFactoryABI, functionName: 'createLaunch', args: [v.args] });

    let gasEstimate: bigint;
    try {
      await agentClient.call({ account: v.from, to: factory, data, value: v.value });
      gasEstimate = await agentClient.estimateGas({ account: v.from, to: factory, data, value: v.value });
    } catch (e) {
      return fail(422, 'simulation_failed', 'The transaction would revert when sent from this wallet.', { reason: shortReason(e) });
    }

    const buildId = crypto.randomUUID();
    await prisma.agentBuild.create({
      data: {
        id: buildId, wallet, keyId: key.id, agentName: key.agentName, operatorUrl: key.operatorUrl,
        to: factory.toLowerCase(), data, value: v.value.toString(), gasEstimate: gasEstimate.toString(),
        params: JSON.parse(JSON.stringify(v.args, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))),
        termsVersion: TERMS_VERSION,
      },
    });

    return json({
      to: factory, data, value: v.value.toString(), chainId: CHAIN_ID, gasEstimate: gasEstimate.toString(), buildId, termsVersion: TERMS_VERSION,
      from: v.from,
      note: 'Unsigned transaction. Sign and send it with your own wallet, then POST /api/agents/v1/launch/register with buildId and txHash.',
    }, 201);
  } catch (e) {
    console.error('agents v1 build failed', e);
    return fail(500, 'server_error', 'Could not build the transaction.');
  }
}
