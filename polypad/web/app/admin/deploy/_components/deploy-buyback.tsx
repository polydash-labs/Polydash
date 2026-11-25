'use client';

import { useEffect, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi';
import { toast } from 'sonner';
import { encodeDeployData, formatEther, type Abi } from 'viem';
import { Button } from '@/components/ui/button';
import { robinhoodChain } from '@/lib/chain';
import { getExplorerAddressUrl, getExplorerTxUrl } from '@/lib/contracts/addresses';
import { BUYBACK_VAULT_ABI, BUYBACK_VAULT_ARGS, BUYBACK_VAULT_BYTECODE, REWARDS_POOL_ABI, REWARDS_POOL_ARGS, REWARDS_POOL_BYTECODE } from '@/lib/buybackArtifacts';
import {
  BUYBACK_VAULT_ADDRESS, DEPLOYER_HINT, EXPECTED_BURN_SHARE_BPS, EXPECTED_MAX_BUY_WEI, EXPECTED_POOL_FEE_BPS, EXPECTED_POOL_ID, POLYDASH, POOL_ARG_LABEL,
  POOL_DEPLOY_GAS_FLOOR, POOL_EXPECTED, POOL_NONCE, REWARDS_POOL_ADDRESS, VAULT_ARG_LABELS, VAULT_DEPLOY_GAS_FLOOR, VAULT_EXPECTED, VAULT_NONCE,
  fmtArg, poolDeployGas, sameAddress, vaultDeployGas, type Addr,
} from '@/lib/buyback';
import { CopyRow } from '@/components/vesting/notes';
import { Card, Note, Row, TxButton } from '@/components/buyback/ui';

const POOL_ABI = REWARDS_POOL_ABI as unknown as Abi;
const VAULT_ABI = BUYBACK_VAULT_ABI as unknown as Abi;
const STORE = 'polypad-buyback-deploy-v1';
type Check = { label: string; value: string; ok: boolean };

export function DeployBuyback() {
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const [busy, setBusy] = useState<'A' | 'B' | null>(null);
  const [a, setA] = useState<{ hash?: `0x${string}`; address?: Addr; from?: string; checks?: Check[] }>({});
  const [b, setB] = useState<{ hash?: `0x${string}`; address?: Addr; checks?: Check[] }>({});
  const [ackMismatch, setAckMismatch] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) { const p = JSON.parse(raw); if (p?.a?.address) setA(p.a); if (p?.b?.address) setB(p.b); }
    } catch (e) { console.error('deploy state restore failed', e); }
  }, []);
  const persist = (na: typeof a, nb: typeof b) => { try { localStorage.setItem(STORE, JSON.stringify({ a: na, b: nb })); } catch (e) { console.error('deploy state save failed', e); } };

  const deploy = async (step: 'A' | 'B') => {
    if (!walletClient || !client || !address) return;
    const isA = step === 'A';
    const abi = isA ? POOL_ABI : VAULT_ABI;
    const bytecode = (isA ? REWARDS_POOL_BYTECODE : BUYBACK_VAULT_BYTECODE) as `0x${string}`;
    const args = (isA ? REWARDS_POOL_ARGS : [{ ...BUYBACK_VAULT_ARGS[0], initialTarget: a.address }]) as any;
    setBusy(step);
    const tid = toast.loading('Preparing deployment…');
    try {
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      let estimate: bigint | null = null;
      try {
        estimate = await client.estimateGas({ account: address, data: encodeDeployData({ abi, bytecode, args }) });
      } catch (e) {
        console.error(`step ${step} deploy gas estimate failed, using floor`, e);
      }
      const gas = isA ? poolDeployGas(estimate) : vaultDeployGas(estimate);
      toast.loading('Confirm the deployment in your wallet…', { id: tid });
      const hash = await walletClient.deployContract({ abi, bytecode, args, chain: robinhoodChain, account: address, gas } as any);
      if (isA) setA({ hash }); else setB({ hash });
      toast.loading('Waiting for confirmation…', { id: tid });
      const r = await client.waitForTransactionReceipt({ hash });
      if (r.status !== 'success' || !r.contractAddress) throw new Error('Deployment reverted');
      const at = r.contractAddress as Addr;
      const read = async (fn: string) => client.readContract({ address: at, abi, functionName: fn }).catch((e) => { console.error(`${fn}() read failed`, e); return undefined; });
      let checks: Check[];
      if (isA) {
        const [st, rt, top] = await Promise.all([read('stakeToken'), read('rewardToken'), read('acceptsRewardTopUps')]);
        checks = [
          { label: 'stakeToken()', value: String(st ?? '-'), ok: sameAddress(st as string, POLYDASH) },
          { label: 'rewardToken()', value: String(rt ?? '-'), ok: sameAddress(rt as string, POLYDASH) },
          { label: 'acceptsRewardTopUps()', value: String(top ?? '-'), ok: top === true },
        ];
        const na = { hash, address: at, from: address, checks };
        setA(na); setB({}); setAckMismatch(false); persist(na, {});
      } else {
        const [pid, fee, burn, maxBuy, target] = await Promise.all([read('poolId'), read('poolFeeBps'), read('burnShareBps'), read('maxBuyEth'), read('rewardsTarget')]);
        checks = [
          { label: 'poolId()', value: String(pid ?? '-'), ok: String(pid ?? '').toLowerCase() === EXPECTED_POOL_ID },
          { label: 'poolFeeBps()', value: String(fee ?? '-'), ok: Number(fee) === EXPECTED_POOL_FEE_BPS },
          { label: 'burnShareBps()', value: String(burn ?? '-'), ok: Number(burn) === EXPECTED_BURN_SHARE_BPS },
          { label: 'maxBuyEth()', value: maxBuy != null ? `${formatEther(maxBuy as bigint)} ETH` : '-', ok: maxBuy === EXPECTED_MAX_BUY_WEI },
          { label: 'rewardsTarget()', value: String(target ?? '-'), ok: sameAddress(target as string, a.address) },
        ];
        const nb = { hash, address: at, checks };
        setB(nb); persist(a, nb);
      }
      toast.success(isA ? 'POLYDASH Rewards Pool deployed' : 'Buyback vault deployed', { id: tid });
    } catch (e: any) {
      console.error(`step ${step} deploy failed`, e);
      const msg = e?.shortMessage || e?.message || 'Deployment failed';
      toast.error(/User rejected|denied/i.test(msg) ? 'Deployment cancelled' : msg, { id: tid });
    } finally {
      setBusy(null);
    }
  };

  const aMismatch = !!a.address && !sameAddress(a.address, POOL_EXPECTED);
  const bMismatch = !!b.address && !sameAddress(b.address, VAULT_EXPECTED);
  const wrongWallet = !!a.from && !!address && !sameAddress(a.from, address);
  const bArgs = { ...BUYBACK_VAULT_ARGS[0], initialTarget: a.address ?? BUYBACK_VAULT_ARGS[0].initialTarget } as Record<string, unknown>;
  const bReady = !!a.address && (!aMismatch || ackMismatch);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:py-14">
      <div>
        <p className="text-[12px] uppercase tracking-wider text-white/55">Admin</p>
        <h1 className="mt-1 text-2xl font-semibold text-white">Deploy POLYDASH Rewards Pool and buyback vault</h1>
        <p className="mt-2 text-[13px] text-white/65">
          Two steps in this order, from the same wallet, with no other transaction in between. Your wallet signs; no keys are stored. Neither contract has an owner,
          an admin or a function that withdraws other people&apos;s funds.
        </p>
        {(REWARDS_POOL_ADDRESS || BUYBACK_VAULT_ADDRESS) && <p className="mt-2 text-[12px] text-amber-300">Addresses are already set in lib/buyback.ts. Deploying again creates separate contracts.</p>}
      </div>

      <div>
        {!isConnected && <ConnectButton.Custom>{({ openConnectModal }) => <Button className="rounded-full" onClick={openConnectModal}>Connect wallet</Button>}</ConnectButton.Custom>}
      </div>

      <Card title="Step A: Deploy POLYDASH Rewards Pool">
        <div data-testid="step-a">
          <Row label={POOL_ARG_LABEL}>{REWARDS_POOL_ARGS[0]}</Row>
          <Row label="Gas limit">max({POOL_DEPLOY_GAS_FLOOR.toLocaleString('en-US')}, 1.5 x estimate)</Row>
          <Row label={`Expected address (from ${DEPLOYER_HINT}, nonce ${POOL_NONCE})`}>{POOL_EXPECTED}</Row>
        </div>
        <div className="mt-4">
          <TxButton onClick={() => deploy('A')} busy={busy === 'A'} disabled={!isConnected || !walletClient || !!busy || !!b.address}>Deploy POLYDASH Rewards Pool</TxButton>
        </div>
        {(a.hash || a.address) && (
          <div className="mt-4 space-y-3">
            {a.hash && <CopyRow label="Transaction hash" value={a.hash} href={getExplorerTxUrl(a.hash)} />}
            {a.address && <CopyRow label="POLYDASH Rewards Pool address" value={a.address} href={getExplorerAddressUrl(a.address)} />}
            {a.checks?.map((c) => <Row key={c.label} label={c.label}><span className={c.ok ? 'text-polydash-green' : 'text-amber-300'}>{c.value} {c.ok ? '(ok)' : '(unexpected)'}</span></Row>)}
            {aMismatch && <Note>The deployed address differs from the expected {POOL_EXPECTED}. This happens when a different wallet or nonce was used.</Note>}
          </div>
        )}
      </Card>

      <Card title="Step B: Deploy buyback vault">
        <div data-testid="step-b">
          {VAULT_ARG_LABELS.map((f) => (
            <Row key={f.key} label={f.label}>{fmtArg(bArgs[f.key], f.fmt)}</Row>
          ))}
          <Row label="Gas limit">max({VAULT_DEPLOY_GAS_FLOOR.toLocaleString('en-US')}, 1.5 x estimate)</Row>
          <Row label={`Expected address (from ${DEPLOYER_HINT}, nonce ${VAULT_NONCE})`}>{VAULT_EXPECTED}</Row>
        </div>
        {!a.address && <p className="mt-3 text-[12px] text-white/55">Enabled after Step A confirms. The initial rewards target is set to the Step A address.</p>}
        {aMismatch && !b.address && (
          <div className="mt-3 space-y-2">
            <Note>Step A deployed at {a.address}, not the expected {POOL_EXPECTED}. The vault will use the Step A address as its initial target, and its own address will also differ from the expected one.</Note>
            <label className="flex items-center gap-2 text-[12px] text-white/80">
              <input type="checkbox" checked={ackMismatch} onChange={(e) => setAckMismatch(e.target.checked)} /> I understand and want to continue with {a.address}
            </label>
          </div>
        )}
        {wrongWallet && <div className="mt-3"><Note>Step A was sent from {a.from}. Connect the same wallet for Step B.</Note></div>}
        <div className="mt-4">
          <TxButton onClick={() => deploy('B')} busy={busy === 'B'} disabled={!isConnected || !walletClient || !!busy || !bReady || wrongWallet || !!b.address}>Deploy buyback vault</TxButton>
        </div>
        {(b.hash || b.address) && (
          <div className="mt-4 space-y-3">
            {b.hash && <CopyRow label="Transaction hash" value={b.hash} href={getExplorerTxUrl(b.hash)} />}
            {b.address && <CopyRow label="Buyback vault address" value={b.address} href={getExplorerAddressUrl(b.address)} />}
            {b.checks?.map((c) => <Row key={c.label} label={c.label}><span className={c.ok ? 'text-polydash-green' : 'text-amber-300'}>{c.value} {c.ok ? '(ok)' : '(unexpected)'}</span></Row>)}
            {bMismatch && <Note>The deployed address differs from the expected {VAULT_EXPECTED}. Use the address above.</Note>}
            {b.address && <p className="text-[12px] text-white/65">Set REWARDS_POOL_ADDRESS, BUYBACK_VAULT_ADDRESS and their deploy blocks in lib/buyback.ts to turn on the dashboard and the Rewards Pool.</p>}
          </div>
        )}
      </Card>
    </div>
  );
}
