import { CHAIN_ID } from '@/lib/agents-api/core';
import {
  MIN_COMMIT_WEI, SIGNING_NOTE, bad, cors, encApprove, encLaunch, minOut, ok, parseAddr, parseSlippage, parseWei, quote, readJson,
  readLaunch, readToken, resolveLaunch, simulate, tokenSummary, txLimited, txOf, type Addr, type UnsignedTx,
} from '@/lib/agents-api/trade';

export const dynamic = 'force-dynamic';

const ACTIONS = ['buy', 'sell', 'commit', 'uncommit', 'withdraw-commitment', 'claim-refund', 'claim-fees'] as const;
type Action = (typeof ACTIONS)[number];
const ZERO = BigInt(0);

export function OPTIONS() {
  return new Response(null, { status: 204, headers: cors() });
}

/** Builds unsigned, simulated transactions for an existing launch. Body: {token, from, amount?, slippageBps?}. */
export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action: raw } = await params;
  if (!(ACTIONS as readonly string[]).includes(raw)) return bad(404, 'unknown_action', `action must be one of: ${ACTIONS.join(', ')}.`);
  const action = raw as Action;
  const limited = txLimited(req);
  if (limited) return limited;
  const body = await readJson(req);
  if (body instanceof Response) return body;

  const from = parseAddr(body.from);
  if (!from) return bad(400, 'invalid_params', 'from must be the signer wallet address.', { fields: { from: 'Expected a 20-byte hex address.' } });
  const slippageBps = parseSlippage(body.slippageBps);
  if (slippageBps === null) return bad(400, 'invalid_params', 'slippageBps must be an integer from 0 to 5000.');
  const needsAmount = action === 'buy' || action === 'sell' || action === 'commit';
  const amount = needsAmount ? parseWei(body.amount) : ZERO;
  if (needsAmount && (amount === null || amount === ZERO)) return bad(400, 'invalid_params', 'amount must be a positive decimal base-unit string (wei).');
  const amt = amount as bigint;

  const launchSnap = await resolveLaunch(body.token);
  if (launchSnap instanceof Response) return launchSnap;
  const launch = launchSnap.launchAddress as Addr;
  const token = launchSnap.tokenAddress as Addr;
  const summary = tokenSummary(launchSnap);
  const state = (error: string, message: string, extra: Record<string, unknown> = {}) => bad(409, error, message, { token: summary, ...extra });

  const txs: UnsignedTx[] = [];
  let quoteOut: Record<string, unknown> | undefined;
  let note: string | undefined;

  try {
    switch (action) {
      case 'buy':
      case 'sell': {
        if (launchSnap.graduated || launchSnap.phase !== 3) {
          return state('not_on_curve', launchSnap.graduated ? 'This token has graduated and trades on its Uniswap V4 pool, not the bonding curve.' : 'Bonding-curve trading is not open for this token.');
        }
        const q = await quote(launch, action, amt);
        const min = minOut(q.out, slippageBps);
        quoteOut = { amountIn: amt.toString(), amountOut: q.out.toString(), minAmountOut: min.toString(), slippageBps, fees: q.fees };
        if (action === 'buy') {
          txs.push(txOf(1, 'buy', 'Buy on the bonding curve. value is ETH in wei.', from, launch, encLaunch('buy', [min]), amt, null));
        } else {
          const [bal, allowance] = await Promise.all([readToken<bigint>(token, 'balanceOf', [from]), readToken<bigint>(token, 'allowance', [from, launch])]);
          if (bal < amt) return state('insufficient_balance', 'from holds fewer tokens than amount.', { balance: bal.toString() });
          if (allowance < amt) txs.push(txOf(1, 'approve', 'Approve the launch contract to take exactly amount tokens.', from, token, encApprove(launch, amt), ZERO, null));
          txs.push(txOf(txs.length + 1, 'sell', 'Sell on the bonding curve. Send after the approve (if any) is confirmed.', from, launch, encLaunch('sell', [amt, min]), ZERO, null));
        }
        break;
      }
      case 'commit':
        if (launchSnap.phase !== 1) return state('not_in_commit_window', 'The commitment window is not open for this token.');
        if (amt < MIN_COMMIT_WEI) return bad(400, 'invalid_params', `amount must be at least ${MIN_COMMIT_WEI.toString()} wei (0.0001 ETH).`);
        txs.push(txOf(1, 'commit', 'Commit ETH to the commitment window. Withdrawable in full while the window is open.', from, launch, encLaunch('commit'), amt, null));
        break;
      case 'uncommit': {
        if (launchSnap.phase !== 1) return state('not_in_commit_window', 'Uncommit is only available while the commitment window is open. After it closes, use withdraw-commitment or claim-refund.');
        const c = await readLaunch<bigint>(launch, 'commitments', [from]);
        if (c === ZERO) return state('nothing_committed', 'from has no commitment on this launch.');
        txs.push(txOf(1, 'uncommit', 'Withdraw the full commitment.', from, launch, encLaunch('uncommit'), ZERO, null));
        break;
      }
      case 'withdraw-commitment':
        txs.push(txOf(1, 'withdraw_commitment', 'Withdraw a commitment that was not processed.', from, launch, encLaunch('withdrawUnprocessedCommitment'), ZERO, null));
        break;
      case 'claim-refund': {
        const r = await readLaunch<bigint>(launch, 'refunds', [from]);
        if (r === ZERO) return state('nothing_to_claim', 'from has no refund on this launch.');
        txs.push(txOf(1, 'claim_refund', 'Claim the ETH refund owed to from.', from, launch, encLaunch('claimRefund'), ZERO, null));
        break;
      }
      case 'claim-fees': {
        if (from.toLowerCase() !== launchSnap.creator.toLowerCase()) return bad(403, 'not_creator', 'Only the launch creator can claim creator fees.', { token: summary });
        const accrued = await readLaunch<bigint>(launch, 'creatorFeesAccrued');
        if (launchSnap.graduated) note = 'After graduation, new creator fees accrue in the Uniswap V4 hook pool. This builds the launch-contract claim only; claim pool fees from the token page.';
        if (accrued === ZERO) return state('nothing_to_claim', 'No creator fees are accrued on the launch contract.', note ? { note } : {});
        txs.push(txOf(1, 'claim_creator_fees', 'Claim creator fees accrued on the launch contract.', from, launch, encLaunch('claimCreatorFees'), ZERO, null));
        break;
      }
    }
  } catch (e) {
    console.error(`agents v1 tx ${action} read failed`, e);
    return bad(503, 'rpc_unavailable', 'Could not read chain state right now.');
  }

  // Simulate step 1 only. Later steps depend on earlier ones landing (for example sell after approve).
  const first = txs[0];
  const sim = await simulate(first.from, first.to, first.data, BigInt(first.value));
  if (!sim.ok && sim.kind === 'rpc') return bad(503, 'rpc_unavailable', 'Simulation could not reach the chain. Retry shortly.');
  const transactions = txs.map((t, i) => {
    const gas = i === 0 && sim.ok ? sim.gas : null;
    const withGas = i === 0 && sim.ok ? txOf(t.step, t.kind, t.description, t.from, t.to, t.data, BigInt(t.value), gas) : t;
    return { ...withGas, simulated: i === 0 };
  });
  const base = {
    chainId: CHAIN_ID,
    action,
    token: summary,
    transactions,
    ...(quoteOut ? { quote: quoteOut } : {}),
    ...(note ? { note } : {}),
    signing: SIGNING_NOTE,
    custody: 'non-custodial',
  };
  if (!sim.ok) {
    return ok({ ok: false, error: 'simulation_reverted', message: `Simulation reverted: ${sim.reason}`, simulation: { success: false, reason: sim.reason }, ...base }, 422);
  }
  return ok({ ok: true, simulation: { success: true, gas: sim.gas !== null ? sim.gas.toString() : null, step: 1 }, ...base });
}
