// PolyForge transaction builders. Validate form input and turn it into unsigned transaction steps.
// Nothing here signs or sends; the user's wallet does that from the Review & sign card.
import { formatEther, formatUnits, isAddress, getAddress, parseAbi, parseEther, parseUnits, type Abi, type Address } from 'viem';
import { PolydashFactoryABI } from '@/lib/contracts/abis';
import { erc20ReadAbi, publicClient, tokenMeta } from '@/lib/agents/tools';
import { STAKING_FACTORY_NEW } from '@/lib/staking/factories';

export const LAUNCH_FACTORY = '0xfDfD0A095966c8B56639f7eAa13f4B0188Fc08c2' as Address;
// New staking pools are created only through the upgraded factory (old factory pools stay live on /stake).
export const POOL_FACTORY = STAKING_FACTORY_NEW;
export const poolFactoryAbi = parseAbi([
  'function createPool(address stakeToken, address rewardToken, uint256 rewardAmount, uint256 startTime, uint256 duration, uint256 maxTotalStake, uint256 claimFeeBps, string name, string description) returns (address pool)',
]);
export const approveAbi = parseAbi(['function approve(address spender, uint256 amount) returns (bool)']);

export interface TxStep {
  label: string;
  to: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value: bigint;
  params: [string, string][];
}
export interface TxPlan { kind: 'launch' | 'pool'; summary: string; steps: TxStep[]; notes: string[] }

export interface LaunchForm {
  name: string; symbol: string; description: string; imageUri: string; socialLinks: string;
  creatorFeeBps: string; creatorPayoutWallet: string; devBuyEth: string;
  totalSupply: string; virtualEthReserve: string; launchDelayHours: string;
}
export const defaultLaunch: LaunchForm = {
  name: '', symbol: '', description: '', imageUri: '', socialLinks: '',
  creatorFeeBps: '100', creatorPayoutWallet: '', devBuyEth: '',
  totalSupply: '1000000000', virtualEthReserve: '1.5', launchDelayHours: '0',
};

export interface PoolForm {
  stakeToken: string; rewardToken: string; rewardAmount: string; startTime: string; // datetime-local, empty = now
  durationDays: string; maxTotalStake: string; claimFeeBps: string; name: string; description: string;
}
export const defaultPool: PoolForm = {
  stakeToken: '', rewardToken: '', rewardAmount: '', startTime: '', durationDays: '30', maxTotalStake: '0', claimFeeBps: '100', name: '', description: '',
};

const num = (s: string) => (s.trim() === '' ? NaN : Number(s.trim()));
const isInt = (n: number) => Number.isFinite(n) && Math.floor(n) === n;
const fmtInt = (v: bigint) => v.toLocaleString('en-US');
const WHOLE = /^\d+$/;

export function validateLaunch(f: LaunchForm, account: Address | undefined): { errors: string[]; plan?: TxPlan } {
  const errors: string[] = [];
  const name = f.name.trim();
  const symbol = f.symbol.trim().toUpperCase();
  const description = f.description.trim();
  const links = f.socialLinks.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (!name) errors.push('Name is required.');
  if (!symbol) errors.push('Symbol is required.');
  if (description.length > 1000) errors.push('Description must be 1000 characters or fewer.');
  if (links.length > 10) errors.push('Up to 10 social links.');
  const fee = num(f.creatorFeeBps);
  if (!isInt(fee) || fee < 0 || fee > 500) errors.push('Creator fee must be a whole number from 0 to 500 bps.');
  let payout: Address | undefined = account;
  if (f.creatorPayoutWallet.trim()) {
    if (!isAddress(f.creatorPayoutWallet.trim(), { strict: false })) errors.push('Creator payout wallet is not a valid address.');
    else payout = getAddress(f.creatorPayoutWallet.trim());
  }
  if (!payout) errors.push('Connect a wallet or enter a creator payout wallet.');
  let devBuy = BigInt(0);
  try { devBuy = parseEther(f.devBuyEth.trim() || '0'); if (devBuy < BigInt(0)) throw new Error(); } catch { errors.push('Dev buy must be a valid ETH amount.'); }
  const supplyStr = f.totalSupply.trim();
  let supply = BigInt(0);
  if (!WHOLE.test(supplyStr)) errors.push('Total supply must be a whole number of tokens.');
  else {
    supply = BigInt(supplyStr);
    if (supply < BigInt(1_000_000) || supply > BigInt(1_000_000_000_000)) errors.push('Total supply must be between 1,000,000 and 1,000,000,000,000 tokens.');
  }
  let vEth = BigInt(0);
  const vNum = num(f.virtualEthReserve);
  if (!Number.isFinite(vNum) || vNum < 0.01 || vNum > 1000) errors.push('Virtual ETH reserve must be between 0.01 and 1000 ETH.');
  else { try { vEth = parseEther(f.virtualEthReserve.trim()); } catch { errors.push('Virtual ETH reserve is not a valid number.'); } }
  const hours = num(f.launchDelayHours || '0');
  const delay = Math.round(hours * 3600);
  if (!Number.isFinite(hours) || delay < 0 || delay > 2_592_000) errors.push('Commitment window must be between 0 and 720 hours (30 days).');
  if (errors.length) return { errors };

  const p = {
    name, symbol, imageUri: f.imageUri.trim(), description, socialLinks: links,
    creatorFeeBps: BigInt(fee), creatorPayoutWallet: payout as Address, devBuyEth: devBuy,
    totalSupply: supply * BigInt(10) ** BigInt(18), virtualEthReserve: vEth, launchDelay: BigInt(delay),
  };
  return {
    errors,
    plan: {
      kind: 'launch',
      summary: `Create a new token "${name}" (${symbol}) with ${fmtInt(supply)} tokens on a bonding curve.${devBuy > BigInt(0) ? ` You also buy ${formatEther(devBuy)} ETH of it in the same transaction.` : ''}${delay > 0 ? ` A ${(delay / 3600).toLocaleString('en-US', { maximumFractionDigits: 2 })}-hour commitment window opens first.` : ' Trading opens immediately.'}`,
      notes: [],
      steps: [{
        label: 'Create launch',
        to: LAUNCH_FACTORY, abi: PolydashFactoryABI as unknown as Abi, functionName: 'createLaunch', args: [p], value: devBuy,
        params: [
          ['name', p.name], ['symbol', p.symbol], ['imageUri', p.imageUri || '(none)'], ['description', p.description || '(none)'],
          ['socialLinks', links.length ? links.join(', ') : '(none)'],
          ['creatorFeeBps', `${fee} (${(fee / 100).toFixed(2)}%)`], ['creatorPayoutWallet', p.creatorPayoutWallet],
          ['devBuyEth', `${p.devBuyEth.toString()} wei (${formatEther(p.devBuyEth)} ETH)`],
          ['totalSupply', `${p.totalSupply.toString()} (${fmtInt(supply)} tokens)`],
          ['virtualEthReserve', `${p.virtualEthReserve.toString()} wei (${formatEther(p.virtualEthReserve)} ETH)`],
          ['launchDelay', `${delay} seconds`],
        ],
      }],
    },
  };
}

export function toLocalInput(unix: number) {
  const d = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function validatePool(f: PoolForm, account: Address | undefined): Promise<{ errors: string[]; plan?: TxPlan }> {
  const errors: string[] = [];
  if (!account) errors.push('Connect your wallet first.');
  const stakeIn = f.stakeToken.trim();
  const rewardIn = f.rewardToken.trim() || stakeIn;
  if (!isAddress(stakeIn, { strict: false })) errors.push('Stake token is not a valid address.');
  if (!isAddress(rewardIn, { strict: false })) errors.push('Reward token is not a valid address.');
  const days = num(f.durationDays);
  if (!Number.isFinite(days) || days < 1 || days > 3650) errors.push('Duration must be between 1 and 3650 days.');
  const fee = num(f.claimFeeBps);
  if (!isInt(fee) || fee < 100 || fee > 500) errors.push('Claim fee must be a whole number from 100 to 500 bps.');
  const name = f.name.trim();
  const description = f.description.trim();
  if (!name) errors.push('Pool name is required.');
  if (name.length > 64) errors.push('Pool name must be 64 characters or fewer.');
  if (description.length > 280) errors.push('Description must be 280 characters or fewer.');
  const now = Math.floor(Date.now() / 1000);
  let start = 0;
  if (f.startTime.trim()) {
    const t = Math.floor(new Date(f.startTime).getTime() / 1000);
    if (!Number.isFinite(t)) errors.push('Start time is not valid.');
    else if (t <= now) start = 0;
    else if (t > now + 365 * 86400) errors.push('Start time can be at most 365 days ahead.');
    else start = t;
  }
  if (errors.length) return { errors };

  const stakeToken = getAddress(stakeIn);
  const rewardToken = getAddress(rewardIn);
  const [sm, rm] = await Promise.all([tokenMeta(stakeToken), tokenMeta(rewardToken)]);
  if (!sm.decimalsKnown) errors.push('Stake token does not look like an ERC-20 (no decimals()).');
  if (!rm.decimalsKnown) errors.push('Reward token does not look like an ERC-20 (no decimals()).');
  let rewardAmount = BigInt(0);
  let maxStake = BigInt(0);
  try { rewardAmount = parseUnits(f.rewardAmount.trim(), rm.decimals); if (rewardAmount <= BigInt(0)) errors.push('Reward amount must be greater than 0.'); } catch { errors.push('Reward amount is not a valid number.'); }
  try { maxStake = parseUnits(f.maxTotalStake.trim() || '0', sm.decimals); } catch { errors.push('Max total stake is not a valid number.'); }
  if (errors.length) return { errors };

  const [balance, allowance] = await Promise.all([
    publicClient.readContract({ address: rewardToken, abi: erc20ReadAbi, functionName: 'balanceOf', args: [account as Address] }).catch(() => null),
    publicClient.readContract({ address: rewardToken, abi: erc20ReadAbi, functionName: 'allowance', args: [account as Address, POOL_FACTORY] }).catch(() => null),
  ]);
  if (balance == null) return { errors: ['Could not read your reward token balance. Try again.'] };
  if (balance < rewardAmount) return { errors: [`Your ${rm.symbol} balance (${formatUnits(balance, rm.decimals)}) is below the reward amount.`] };

  const duration = Math.round(days * 86400);
  const steps: TxStep[] = [];
  if (allowance == null || allowance < rewardAmount) {
    steps.push({
      label: `Approve ${rm.symbol}`, to: rewardToken, abi: approveAbi as Abi, functionName: 'approve', args: [POOL_FACTORY, rewardAmount], value: BigInt(0),
      params: [['spender', `${POOL_FACTORY} (staking factory)`], ['amount', `${rewardAmount.toString()} (${formatUnits(rewardAmount, rm.decimals)} ${rm.symbol})`]],
    });
  }
  steps.push({
    label: 'Create staking pool', to: POOL_FACTORY, abi: poolFactoryAbi as Abi, functionName: 'createPool',
    args: [stakeToken, rewardToken, rewardAmount, BigInt(start), BigInt(duration), maxStake, BigInt(fee), name, description], value: BigInt(0),
    params: [
      ['stakeToken', `${stakeToken} (${sm.symbol})`], ['rewardToken', `${rewardToken} (${rm.symbol})`],
      ['rewardAmount', `${rewardAmount.toString()} (${formatUnits(rewardAmount, rm.decimals)} ${rm.symbol})`],
      ['startTime', start === 0 ? '0 (starts now)' : `${start} (${new Date(start * 1000).toUTCString()})`],
      ['duration', `${duration} seconds (${days} days)`],
      ['maxTotalStake', maxStake === BigInt(0) ? '0 (no cap)' : `${maxStake.toString()} (${formatUnits(maxStake, sm.decimals)} ${sm.symbol})`],
      ['claimFeeBps', `${fee} (${(fee / 100).toFixed(2)}%)`], ['name', name], ['description', description || '(none)'],
    ],
  });
  return {
    errors: [],
    plan: {
      kind: 'pool',
      summary: `Create a staking pool where people stake ${sm.symbol} and earn ${rm.symbol}. You deposit ${formatUnits(rewardAmount, rm.decimals)} ${rm.symbol} as rewards, paid out over ${days} days${start ? ' from the start time' : ' starting now'}.`,
      notes: ['Claim fee is a fee on reward claims, split with the platform per the contract.'],
      steps,
    },
  };
}

// Parse a PolyForge JSON reply into form values. Returns null if the reply is not usable JSON.
export function parseForgeReply(text: string): { type: 'launch'; form: Partial<LaunchForm> } | { type: 'pool'; form: Partial<PoolForm> } | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let o: any;
  try { o = JSON.parse(m[0]); } catch { return null; }
  const s = (v: unknown) => (v == null ? undefined : String(v));
  if (o?.type === 'launch') {
    return { type: 'launch', form: {
      name: s(o.name), symbol: s(o.symbol), description: s(o.description), creatorFeeBps: s(o.creatorFeeBps), devBuyEth: s(o.devBuyEth),
      totalSupply: s(o.totalSupply), virtualEthReserve: s(o.virtualEthReserve),
      launchDelayHours: o.launchDelay != null && Number.isFinite(Number(o.launchDelay)) ? String(Number(o.launchDelay) / 3600) : undefined,
    } };
  }
  if (o?.type === 'pool') {
    const st = Number(o.startTime);
    return { type: 'pool', form: {
      stakeToken: s(o.stakeToken), rewardToken: s(o.rewardToken), rewardAmount: s(o.rewardAmount),
      startTime: Number.isFinite(st) && st > 0 ? toLocalInput(st) : undefined, durationDays: s(o.durationDays),
      maxTotalStake: s(o.maxTotalStake), claimFeeBps: s(o.claimFeeBps), name: s(o.name), description: s(o.description),
    } };
  }
  return null;
}
