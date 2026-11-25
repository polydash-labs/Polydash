import { decodeEventLog } from 'viem';
import { prisma } from '@/lib/db';
import { PolydashFactoryABI } from '@/lib/contracts/abis';
import { agentClient, clearAgentLaunchedCache, fail, isTxHash, json, requireKey, shortReason } from '@/lib/agents-api/core';

export const dynamic = 'force-dynamic';

/** Checks the receipt of a sent build, decodes LaunchCreated and marks the token agent-launched. */
export async function POST(req: Request) {
  const key = await requireKey(req);
  if (key instanceof Response) return key;
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const buildId = typeof body?.buildId === 'string' ? body.buildId.trim() : '';
    const txHash = body?.txHash;
    if (!buildId || !isTxHash(txHash)) return fail(400, 'invalid_params', 'Send { buildId, txHash }.');
    const hash = txHash.toLowerCase() as `0x${string}`;

    const build = await prisma.agentBuild.findUnique({ where: { id: buildId } });
    if (!build) return fail(404, 'build_not_found', 'Unknown buildId.');
    if (build.keyId !== key.id) return fail(403, 'forbidden', 'This build belongs to a different API key.');

    const existing = await prisma.agentLaunch.findUnique({ where: { buildId } });
    if (existing) {
      if (existing.txHash !== hash) return fail(409, 'already_registered', 'This build is already registered with another transaction.');
      return json({ status: 'registered', launchAddress: existing.launchAddress, tokenAddress: existing.tokenAddress, txHash: existing.txHash, agentLaunched: true });
    }

    let tx;
    try {
      tx = await agentClient.getTransaction({ hash });
    } catch {
      return fail(404, 'tx_not_found', 'Transaction not found yet. Retry in a few seconds.', { status: 'not_found' });
    }
    if (
      tx.from.toLowerCase() !== build.wallet ||
      (tx.to ?? '').toLowerCase() !== build.to ||
      tx.input.toLowerCase() !== build.data.toLowerCase() ||
      tx.value.toString() !== build.value
    ) {
      return fail(422, 'tx_mismatch', 'The transaction does not match this build (sender, target, data or value differ).');
    }

    let receipt;
    try {
      receipt = await agentClient.getTransactionReceipt({ hash });
    } catch {
      return json({ status: 'pending', txHash: hash, message: 'Transaction is not mined yet. Retry in a few seconds.' }, 202);
    }
    if (receipt.status !== 'success') {
      await prisma.agentBuild.update({ where: { id: buildId }, data: { status: 'reverted', txHash: hash } });
      return fail(422, 'tx_reverted', 'The transaction reverted.', { status: 'reverted' });
    }

    let ev: { launch: string; token: string; creator: string } | null = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== build.to) continue;
      try {
        const d = decodeEventLog({ abi: PolydashFactoryABI, data: log.data, topics: log.topics });
        if (d.eventName === 'LaunchCreated') {
          const a = d.args as { launch: string; token: string; creator: string };
          ev = { launch: a.launch.toLowerCase(), token: a.token.toLowerCase(), creator: a.creator.toLowerCase() };
          break;
        }
      } catch { /* other event */ }
    }
    if (!ev) return fail(422, 'event_not_found', 'No LaunchCreated event from the factory in this transaction.');

    await prisma.agentLaunch.upsert({
      where: { launchAddress: ev.launch },
      update: {},
      create: { launchAddress: ev.launch, tokenAddress: ev.token, txHash: hash, buildId, creator: ev.creator, agentName: build.agentName, operatorUrl: build.operatorUrl },
    });
    await prisma.agentBuild.update({ where: { id: buildId }, data: { status: 'registered', txHash: hash } });
    clearAgentLaunchedCache();
    return json({ status: 'registered', launchAddress: ev.launch, tokenAddress: ev.token, txHash: hash, agentLaunched: true, tokenUrl: `/token/${ev.launch}` });
  } catch (e) {
    console.error('agents v1 register failed', e);
    return fail(500, 'server_error', 'Could not register the launch.', { reason: shortReason(e) });
  }
}
