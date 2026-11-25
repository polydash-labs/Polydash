/** Token launch through the same validation as /api/agents/v1, returned in the v2 prepared-action shape. */
import { factoryAddress, validateLaunchBody, encodeCreateLaunch } from '../../agent-launch';
import { WORDING } from './config';
import { ApiError, assertNotFeeWallet, bodyGuard, ethDisplay, type Ctx, type Meta } from './core';
import { finishPrepared, validReturnUrl } from './prepared';

export async function prepareTokenLaunch(ctx: Ctx, rawInput: unknown, meta: Meta) {
  const input = bodyGuard(rawInput);
  const v = validateLaunchBody(input, { requireFrom: true });
  if (!v.ok) throw new ApiError(400, 'invalid_params', 'Some launch fields need fixing.', { fields: v.fields });
  const value = v.value;
  assertNotFeeWallet(value.from!);
  const to = factoryAddress();
  const data = encodeCreateLaunch(value);
  const signInput = {
    name: value.name, symbol: value.symbol, imageUri: value.imageUri, description: value.description,
    socialLinks: value.socialLinks, creatorFeeBps: value.creatorFeeBps, creatorPayoutWallet: value.creatorPayoutWallet,
    devBuyEth: value.devBuyEth.toString(), totalSupply: value.totalSupply.toString(), virtualEthReserve: value.virtualEthReserve.toString(),
    launchDelay: value.launchDelay.toString(),
  };
  const p = Buffer.from(JSON.stringify(signInput)).toString('base64url');
  return finishPrepared(ctx, {
    action: 'token-launch',
    signParams: { p },
    from: value.from!,
    meta,
    returnUrl: validReturnUrl(input.returnUrl),
    allowTargets: [to],
    steps: [{ kind: 'create_launch', description: 'Create the token launch on the Polypad factory. The sending wallet becomes the creator.', to, data, value: value.devBuyEth, simulate: true }],
    summary: {
      headline: `Launch ${value.name} (${value.symbol}) on Robinhood Chain`,
      lines: [
        `Creator fee: ${value.creatorFeeBps / 100}% of each trade`,
        value.devBuyEth > 0n ? `Your buy at launch: ${ethDisplay(value.devBuyEth)} ETH` : 'No buy at launch',
        value.launchDelay > 0n ? `Trading opens after ${value.launchDelay} seconds` : 'Trading opens right away',
        value.agentLaunched ? 'Marked Agent-launched (a label for how it was prepared, not a review)' : 'Not marked Agent-launched',
        'The token starts on a bonding curve and graduates to a locked Uniswap V4 pool at the threshold.',
      ],
      youPay: value.devBuyEth > 0n ? `${ethDisplay(value.devBuyEth)} ETH` : '0 ETH plus gas',
      risks: ['Most new tokens lose value. A token may never graduate.', 'You are responsible for what you launch.', WORDING.notAudited],
    },
    extra: { params: { ...signInput, agentLaunched: value.agentLaunched } },
  });
}

