import { isAddress } from 'viem';
import { prisma } from '@/lib/db';
import { allowAttempt, clientIpHash, fail, isTxHash, json } from '@/lib/agents-api/core';
import { AGENT_ACTIONS, AGENT_STATUSES, REF_RE, isClient } from '@/lib/agent-actions';
import { attributionForHash } from '@/lib/attribution-server';

export const dynamic = 'force-dynamic';

const ORDER: Record<string, number> = { viewed: 0, connected: 1, sent: 2, confirmed: 3, failed: 3 };

/**
 * Internal route for the /sign page. Body: { id?, action, ref, client, status, wallet?, txHash?, valueWei?, fingerprint? }.
 * Without id a row is created; with id the row's status moves forward. Stores only the connected wallet (lowercase).
 */
export async function POST(req: Request) {
  const ip = clientIpHash(req);
  if (!allowAttempt(`agent-actions:${ip}`, 30, 60_000)) return fail(429, 'rate_limited', 'Too many requests. Try again in a minute.');
  let b: any;
  try { b = await req.json(); } catch { return fail(400, 'bad_request', 'Invalid JSON.'); }

  const status = String(b?.status ?? '');
  if (!(AGENT_STATUSES as readonly string[]).includes(status)) return fail(400, 'bad_status', 'Unknown status.');
  const wallet = b?.wallet == null || b.wallet === '' ? null : String(b.wallet);
  if (wallet !== null && !isAddress(wallet, { strict: false })) return fail(400, 'bad_wallet', 'Invalid wallet.');
  const txHash = b?.txHash == null || b.txHash === '' ? null : String(b.txHash);
  if (txHash !== null && !isTxHash(txHash)) return fail(400, 'bad_hash', 'Invalid transaction hash.');
  const valueWei = b?.valueWei == null || b.valueWei === '' ? null : String(b.valueWei);
  if (valueWei !== null && !/^\d{1,40}$/.test(valueWei)) return fail(400, 'bad_value', 'valueWei must be a decimal string.');
  const fingerprint = b?.fingerprint == null || b.fingerprint === '' ? null : String(b.fingerprint);
  if (fingerprint !== null && !/^[A-Za-z0-9_:.-]{1,100}$/.test(fingerprint)) return fail(400, 'bad_fingerprint', 'Invalid fingerprint.');

  try {
    if (b?.id) {
      const id = String(b.id);
      if (!/^[a-z0-9]{10,40}$/.test(id)) return fail(400, 'bad_id', 'Invalid id.');
      const row = await prisma.agentAction.findUnique({ where: { id } });
      if (!row) return fail(404, 'not_found', 'Unknown id.');
      if (ORDER[status] < ORDER[row.status] || row.status === 'confirmed' || row.status === 'failed') return json({ ok: true, id });
      let matchedChat = row.matchedChat;
      const hash = txHash ?? row.txHash;
      if (status === 'confirmed' && hash) {
        const a = await attributionForHash(hash);
        matchedChat = !!a && a.ref === row.ref;
      }
      await prisma.agentAction.update({
        where: { id },
        data: {
          status,
          wallet: wallet ? wallet.toLowerCase() : row.wallet,
          txHash: hash,
          valueWei: valueWei ?? row.valueWei,
          fingerprint: fingerprint ?? row.fingerprint,
          matchedChat,
        },
      });
      return json({ ok: true, id });
    }

    const action = String(b?.action ?? '');
    if (!(AGENT_ACTIONS as readonly string[]).includes(action)) return fail(400, 'bad_action', 'Unknown action.');
    const ref = String(b?.ref ?? '');
    if (!REF_RE.test(ref)) return fail(400, 'bad_ref', 'ref must match [a-z0-9_-]{1,24}.');
    if (!isClient(b?.client)) return fail(400, 'bad_client', 'client must be 1 to 64 characters.');
    const row = await prisma.agentAction.create({
      data: { action, ref, client: b.client, status, wallet: wallet ? wallet.toLowerCase() : null, txHash, valueWei, fingerprint },
      select: { id: true },
    });
    return json({ ok: true, id: row.id });
  } catch (e: any) {
    console.error('agent-actions write failed', e?.message);
    return fail(500, 'server_error', 'Could not record this step.');
  }
}
