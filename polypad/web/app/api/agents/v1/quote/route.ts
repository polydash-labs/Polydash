import { CHAIN_ID } from '@/lib/agents-api/core';
import { bad, cors, ok, parseWei, quote, resolveLaunch, tokenSummary, txLimited, type Addr } from '@/lib/agents-api/trade';

export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return new Response(null, { status: 204, headers: cors() });
}

/** Bonding-curve quote. buy: amount is ETH in wei, out is token base units. sell: amount is token base units, out is ETH in wei. */
export async function GET(req: Request) {
  const limited = txLimited(req);
  if (limited) return limited;
  const sp = new URL(req.url).searchParams;
  const side = sp.get('side');
  if (side !== 'buy' && side !== 'sell') return bad(400, 'invalid_params', 'side must be buy or sell.');
  const amount = parseWei(sp.get('amount'));
  if (amount === null || amount === BigInt(0)) return bad(400, 'invalid_params', 'amount must be a positive decimal base-unit string (wei).');
  const launch = await resolveLaunch(sp.get('token'));
  if (launch instanceof Response) return launch;
  if (launch.graduated || launch.phase !== 3) {
    return bad(409, 'not_on_curve', launch.graduated ? 'This token has graduated and trades on its Uniswap V4 pool, not the bonding curve.' : 'Bonding-curve trading is not open for this token.', {
      token: tokenSummary(launch),
    });
  }
  try {
    const q = await quote(launch.launchAddress as Addr, side, amount);
    return ok({
      ok: true,
      chainId: CHAIN_ID,
      side,
      amountIn: amount.toString(),
      amountInUnit: side === 'buy' ? 'wei' : 'token base units (18 decimals)',
      amountOut: q.out.toString(),
      amountOutUnit: side === 'buy' ? 'token base units (18 decimals)' : 'wei',
      fees: q.fees,
      feesUnit: 'wei',
      token: tokenSummary(launch),
      note: 'Quotes move with every trade. Use slippageBps when building the transaction.',
    });
  } catch (e) {
    console.error('agents v1 quote failed', e);
    return bad(503, 'rpc_unavailable', 'Could not read a quote from the chain right now.');
  }
}
