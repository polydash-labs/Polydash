import { decodeEventLog } from 'viem';
import { prisma } from '@/lib/db';
import { PolydashFactoryABI } from '@/lib/contracts/abis';
import { getFactoryAddresses } from '@/lib/contracts/addresses';
import { agentClient, fail, isTxHash, json } from '@/lib/agents-api/core';

export const dynamic = 'force-dynamic';

/** Status of a launch transaction: pending, success, reverted or not_found, plus launch/token addresses. */
export async function GET(_req: Request, { params }: { params: Promise<{ txHash: string }> }) {
  const { txHash } = await params;
  if (!isTxHash(txHash)) return fail(400, 'invalid_tx_hash', 'txHash must be a 0x-prefixed 32-byte hash.');
  const hash = txHash.toLowerCase() as `0x${string}`;
  try {
    const reg = await prisma.agentLaunch.findUnique({ where: { txHash: hash } });
    if (reg) {
      return json({ status: 'success', txHash: hash, launchAddress: reg.launchAddress, tokenAddress: reg.tokenAddress, creator: reg.creator, agentLaunched: true, agentName: reg.agentName });
    }
    let receipt;
    try {
      receipt = await agentClient.getTransactionReceipt({ hash });
    } catch {
      const tx = await agentClient.getTransaction({ hash }).catch(() => null);
      return json({ status: tx ? 'pending' : 'not_found', txHash: hash, agentLaunched: false });
    }
    if (receipt.status !== 'success') return json({ status: 'reverted', txHash: hash, agentLaunched: false });
    const factories = getFactoryAddresses().map((f) => f.toLowerCase());
    for (const log of receipt.logs) {
      if (!factories.includes(log.address.toLowerCase())) continue;
      try {
        const d = decodeEventLog({ abi: PolydashFactoryABI, data: log.data, topics: log.topics });
        if (d.eventName === 'LaunchCreated') {
          const a = d.args as { launch: string; token: string; creator: string };
          return json({ status: 'success', txHash: hash, launchAddress: a.launch.toLowerCase(), tokenAddress: a.token.toLowerCase(), creator: a.creator.toLowerCase(), agentLaunched: false });
        }
      } catch { /* other event */ }
    }
    return json({ status: 'success', txHash: hash, launchAddress: null, tokenAddress: null, agentLaunched: false, message: 'Mined, but no LaunchCreated event from a Polypad factory.' });
  } catch (e) {
    console.error('agents v1 launch status failed', e);
    return fail(503, 'unavailable', 'Could not read the transaction right now. Retry shortly.');
  }
}
