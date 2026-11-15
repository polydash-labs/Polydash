/**
 * Read-only portfolio for a wallet address: ETH, launch tokens, fund shares, and NFTs.
 * Result figures are in ETH units. There is no USD value, no forecast, and no price target.
 * Cost basis comes from on-chain events, so each figure says what it covers.
 */
import { erc20Abi, fundNftAbi, launchAbi, nftCollectionAbi } from './abis';
import { CHAIN_FIRST_BLOCK, LIMITS, SITE_ORIGIN, WORDING } from './config';
import { cached, ethDisplay, unitsDisplay, type Addr, type Ctx } from './core';
import { allFunds } from './funds';
import { allLaunches } from './launches';
import { allCollections, loadListings } from './nfts';
import { getLogsChunked } from './logs';
import { quoteLaunch } from './trade';

const boughtEv = launchAbi.find((x) => x.type === 'event' && x.name === 'Bought')!;
const soldEv = launchAbi.find((x) => x.type === 'event' && x.name === 'Sold')!;
const mintedEv = fundNftAbi.find((x) => x.type === 'event' && x.name === 'Minted')!;
const FIRST_BLOCK = CHAIN_FIRST_BLOCK;

export async function portfolioOf(ctx: Ctx, owner: Addr) {
  return cached(ctx, `portfolio:${owner}`, 20_000, async () => {
    const [ethBal, launches, funds, collections] = await Promise.all([ctx.client.getBalance({ address: owner }), allLaunches(ctx), allFunds(ctx), allCollections(ctx)]);

    // ---- launch tokens
    const tokBal = await ctx.client.multicall({ contracts: launches.map((l) => ({ address: l.token, abi: erc20Abi, functionName: 'balanceOf' as const, args: [owner] as const })), allowFailure: true });
    const tokens: Record<string, unknown>[] = [];
    let curveScanCapped = false;
    const scanList = launches.slice(0, 60);
    if (launches.length > 60) curveScanCapped = true;
    const flows = await Promise.all(
      scanList.map(async (l) => {
        try {
          const [b, s] = await Promise.all([
            getLogsChunked(ctx, { address: l.launch, event: boughtEv, args: { buyer: owner }, fromBlock: FIRST_BLOCK }),
            getLogsChunked(ctx, { address: l.launch, event: soldEv, args: { seller: owner }, fromBlock: FIRST_BLOCK }),
          ]);
          let spent = 0n;
          let got = 0n;
          for (const x of b as { args: { ethIn: bigint } }[]) spent += x.args.ethIn;
          for (const x of s as { args: { ethOut: bigint } }[]) got += x.args.ethOut;
          return { l, spent, got, trades: b.length + s.length, ok: true };
        } catch {
          return { l, spent: 0n, got: 0n, trades: 0, ok: false };
        }
      }),
    );
    const flowBy = new Map(flows.map((f) => [f.l.launch, f]));
    for (let i = 0; i < launches.length; i += 1) {
      const l = launches[i];
      const r = tokBal[i];
      const bal = r.status === 'success' ? (r.result as bigint) : 0n;
      const fl = flowBy.get(l.launch);
      if (bal === 0n && !(fl && fl.trades > 0)) continue;
      let exitValue: bigint | null = null;
      if (bal > 0n && (l.phase === 3 || l.phase === 4)) {
        try { exitValue = (await quoteLaunch(ctx, l, 'sell', bal, 0)).amountOut; } catch { exitValue = null; }
      }
      const spent = fl?.spent ?? 0n;
      const got = fl?.got ?? 0n;
      tokens.push({
        name: l.name, symbol: l.symbol, token: l.token, launch: l.launch, phase: l.phaseName,
        balance: bal.toString(), balanceDisplay: `${unitsDisplay(bal)} ${l.symbol}`,
        exitValueEth: exitValue === null ? null : ethDisplay(exitValue),
        curveTrades: fl?.trades ?? 0,
        ethSpentOnCurve: ethDisplay(spent),
        ethReceivedFromCurve: ethDisplay(got),
        netResultEth: l.phase === 4 || exitValue === null || !fl?.ok ? null : ethDisplay(got + exitValue - spent),
        resultNote: l.phase === 4 ? 'Graduated: trades now happen in the Uniswap pool, which this read does not total, so no net result is shown. Only the current exit value is.' : 'Counts bonding-curve trades. Tokens that arrived by transfer or commit allocation have no recorded cost. Exit value is what selling now would return after fees, at this moment.',
        page: `${SITE_ORIGIN}/token/${l.launch}`,
      });
    }

    // ---- fund shares
    const shareBal = await ctx.client.multicall({ contracts: funds.map((f) => ({ address: f.address, abi: fundNftAbi, functionName: 'balanceOf' as const, args: [owner] as const })), allowFailure: true });
    const fundRows: Record<string, unknown>[] = [];
    for (let i = 0; i < funds.length; i += 1) {
      const f = funds[i];
      const r = shareBal[i];
      const n = r.status === 'success' ? (r.result as bigint) : 0n;
      if (n === 0n) continue;
      let paid = 0n;
      let minted = 0n;
      let paidOk = true;
      try {
        const logs = (await getLogsChunked(ctx, { address: f.address, event: mintedEv, args: { minter: owner }, fromBlock: FIRST_BLOCK })) as { args: { qty: bigint; paid: bigint } }[];
        for (const x of logs) { paid += x.args.paid; minted += x.args.qty; }
      } catch { paidOk = false; }
      const value = f.navPerNftWei !== null ? f.navPerNftWei * n : null;
      const basis = paidOk && minted >= n && minted > 0n ? (paid * n) / minted : null;
      fundRows.push({
        name: f.name, fund: f.address, status: f.statusName, shares: n.toString(),
        currentValueEth: value === null ? null : ethDisplay(value, 8),
        ethPaidMinting: paidOk ? ethDisplay(basis ?? 0n, 8) : null,
        netResultEth: value !== null && basis !== null ? ethDisplay(value - basis, 8) : null,
        resultNote: 'Value is the fund net value per share times your shares, in ETH. The paid figure counts what this wallet paid when minting. Shares received by transfer have no recorded cost.',
        page: `${SITE_ORIGIN}/funds/${f.address}`,
      });
    }

    // ---- NFTs
    const fixed = collections.filter((c) => c.kind === 'fixed');
    const nftBal = await ctx.client.multicall({ contracts: fixed.map((c) => ({ address: c.address, abi: nftCollectionAbi, functionName: 'balanceOf' as const, args: [owner] as const })), allowFailure: true });
    const listings = await loadListings(ctx).catch(() => []);
    const nftRows: Record<string, unknown>[] = [];
    fixed.forEach((c, i) => {
      const r = nftBal[i];
      const n = r.status === 'success' ? (r.result as bigint) : 0n;
      if (n === 0n) return;
      nftRows.push({
        name: c.name, collection: c.address, owned: n.toString(),
        mintPriceDisplay: `${ethDisplay(c.mintPriceWei)} ETH`,
        listedByYou: listings.filter((x) => x.valid && x.nft === c.address && x.seller === owner).map((x) => ({ listingId: x.id, tokenId: x.tokenId.toString(), priceDisplay: `${ethDisplay(x.priceWei)} ETH` })),
        page: `${SITE_ORIGIN}/nfts/${c.address}`,
      });
    });

    return {
      ok: true,
      address: owner,
      readOnly: true,
      unit: 'ETH',
      ethBalance: ethDisplay(ethBal),
      tokens,
      funds: fundRows,
      nfts: nftRows,
      empty: tokens.length + fundRows.length + nftRows.length === 0,
      coverage: curveScanCapped ? 'Trade history was read for the 60 oldest launches only.' : 'Trade history read for all launches.',
      reading: 'Figures are readings of on-chain data in ETH units. They are readings, not forecasts.',
      disclaimer: WORDING.notAudited,
      rateNote: `At most ${LIMITS.rate.read.limit} reads per minute per client.`,
    };
  });
}
