import { prisma } from '@/lib/db';
import { fail, json } from '@/lib/agents-api/core';

export const dynamic = 'force-dynamic';

/** Decide one queued move. Approve records the owner's Safe execution tx
 * (the client signs + submits it first, then reports the hash here); deny
 * kills the move. Only pending rows can be decided. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return fail(400, 'invalid_json', 'Send a JSON body.');
    const action = String(body.action ?? '');
    if (action !== 'approve' && action !== 'deny') {
      return fail(400, 'invalid_params', 'action must be "approve" or "deny".');
    }
    const txHash = body.txHash != null ? String(body.txHash) : null;
    if (action === 'approve' && (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash))) {
      return fail(400, 'invalid_params', 'Approving needs the executed Safe transaction hash as txHash.');
    }
    const row = await prisma.agentWalletApproval.findUnique({ where: { id } });
    if (!row) return fail(404, 'not_found', 'No queued move with that id.');
    if (row.status !== 'pending') {
      return fail(409, 'already_decided', `This move is already ${row.status}.`);
    }
    const updated = await prisma.agentWalletApproval.update({
      where: { id },
      data: {
        status: action === 'approve' ? 'executed' : 'denied',
        decidedAt: new Date(),
        decisionTxHash: txHash,
      },
    });
    return json({ approval: updated });
  } catch (e) {
    console.error('agent wallet approvals PATCH failed', e);
    return fail(500, 'server_error', 'Could not record the decision.');
  }
}
