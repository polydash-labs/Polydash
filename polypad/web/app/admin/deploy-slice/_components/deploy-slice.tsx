'use client';

import { useEffect, useState } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { encodeDeployData, type Abi } from 'viem';
import { toast } from 'sonner';
import { robinhoodChain } from '@/lib/chain';
import { Card, Note, Row, TxButton, ConnectOr, AddrLink, TxLink } from '@/components/buyback/ui';
import { CopyRow } from '@/components/vesting/notes';
import { SourcifyLink } from '@/components/slice/slice-contracts';
import {
  SLICE_ADMIN_DEPLOYER, SLICE_DISTRIBUTOR_ABI, SLICE_DISTRIBUTOR_ARGS, SLICE_DISTRIBUTOR_BYTECODE, SLICE_DISTRIBUTOR_EXPECTED_ADDRESS,
  SLICE_ESCROW_ABI, SLICE_ESCROW_ARGS, SLICE_ESCROW_BYTECODE, SLICE_ESCROW_EXPECTED_ADDRESS, SLICE_ROOT_POSTER,
} from '@/lib/sliceArtifacts';
import { DISTRIBUTOR_NONCE, blockscoutAddr, distributorDeployGas, errorText, escrowDeployGas, sameAddress } from '@/lib/slice';

const A_LABELS = [
  'Escrow (expected next address)',
  'Root poster: Polydash agent wallet 0xd75492a45Ceed467d2147cBa74A9595b949E491E (can only propose roots)',
  'Guardian: Polydash fee wallet (can only veto a pending root)',
  'Stake source: POLYDASH Rewards Pool',
  'Epoch 0 start',
];
const B_LABELS = ['Launch factory A', 'Launch factory B', 'Distributor (Step A)'];
const EPOCH_NOTE = '1794096000 = Sun Nov 8, 2026 00:00 UTC / Sat Nov 7, 4:00 PM PT';
const KEY = 'polypad.deploySlice';
type Res = { hash: `0x${string}`; address: `0x${string}`; reads: Record<string, string> };

export function DeploySlice() {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const { data: wallet } = useWalletClient();
  const [nonce, setNonce] = useState<number | null>(null);
  const [a, setA] = useState<Res | null>(null);
  const [b, setB] = useState<Res | null>(null);
  const [busy, setBusy] = useState<'a' | 'b' | null>(null);

  useEffect(() => { try { const s = JSON.parse(localStorage.getItem(KEY) || '{}'); if (s.a) setA(s.a); if (s.b) setB(s.b); } catch (e) { console.error(e); } }, []);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ a, b })); } catch (e) { console.error(e); } }, [a, b]);
  useEffect(() => {
    if (!client || !address) { setNonce(null); return; }
    client.getTransactionCount({ address, blockTag: 'pending' }).then(setNonce).catch((e) => console.error('nonce', e));
  }, [client, address, a, b]);

  const isDeployer = sameAddress(address, SLICE_ADMIN_DEPLOYER);
  const aBlocked = !isDeployer || nonce !== DISTRIBUTOR_NONCE;
  const aMatches = !!a && sameAddress(a.address, SLICE_DISTRIBUTOR_EXPECTED_ADDRESS);

  const deploy = async (step: 'a' | 'b') => {
    if (!client || !wallet || !address) return;
    const abi = (step === 'a' ? SLICE_DISTRIBUTOR_ABI : SLICE_ESCROW_ABI) as unknown as Abi;
    const bytecode = step === 'a' ? SLICE_DISTRIBUTOR_BYTECODE : SLICE_ESCROW_BYTECODE;
    const args = (step === 'a' ? SLICE_DISTRIBUTOR_ARGS : SLICE_ESCROW_ARGS) as unknown as unknown[];
    setBusy(step);
    const tid = toast.loading('Confirm the deploy in your wallet…');
    try {
      let est: bigint | null = null;
      try { est = await client.estimateGas({ account: address, data: encodeDeployData({ abi, bytecode, args }) }); } catch (e) { console.error('deploy estimate failed, using floor', e); }
      const gas = step === 'a' ? distributorDeployGas(est) : escrowDeployGas(est);
      const hash = await wallet.deployContract({ abi, bytecode, args, chain: robinhoodChain, account: address, gas } as any);
      toast.loading('Waiting for confirmation…', { id: tid });
      const r = await client.waitForTransactionReceipt({ hash });
      if (r.status !== 'success' || !r.contractAddress) throw new Error('Deploy reverted');
      const fns = step === 'a' ? ['escrow', 'rootPoster', 'guardian', 'rewardsPool', 'epochGenesis', 'ROOT_DELAY'] : ['distributor', 'factoryA', 'factoryB', 'MIN_SLICE_BPS', 'MAX_TOTAL_BPS', 'MIN_DURATION', 'MAX_DURATION'];
      const reads: Record<string, string> = {};
      for (const f of fns) { try { reads[f] = String(await client.readContract({ address: r.contractAddress, abi, functionName: f } as any)); } catch (e) { reads[f] = 'read failed'; console.error(f, e); } }
      const res = { hash, address: r.contractAddress, reads };
      if (step === 'a') { setA(res); } else { setB(res); }
      toast.success('Deployed', { id: tid });
    } catch (e: any) {
      console.error('deploy failed', e);
      toast.error(errorText(e), { id: tid });
    } finally { setBusy(null); }
  };

  const Result = ({ r, expect }: { r: Res; expect: Record<string, string> }) => (
    <div className="mt-3 space-y-1">
      <Row label="Tx"><TxLink hash={r.hash} /></Row>
      <CopyRow label="Address" value={r.address} href={blockscoutAddr(r.address)} />
      {Object.entries(r.reads).map(([k, v]) => (
        <Row key={k} label={`${k}()`}>{v}{expect[k] ? (String(expect[k]).toLowerCase() === v.toLowerCase() ? '  (ok)' : `  (expected ${expect[k]})`) : ''}</Row>
      ))}
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <h1 className="text-2xl font-semibold text-white">Deploy airdrop slice contracts</h1>
      <Note>Two steps in order, same wallet, no other transaction in between. Neither contract has an owner or a withdraw function.</Note>
      <Card title="Before you start">
        <Row label="Deployer"><AddrLink address={SLICE_ADMIN_DEPLOYER} /></Row>
        <Row label="Connected wallet nonce">{nonce ?? '-'}</Row>
        <p className="mt-2 font-mono text-[12px] text-white/75" data-testid="expected-addresses">
          Expected: nonce 51 -&gt; {SLICE_DISTRIBUTOR_EXPECTED_ADDRESS} <SourcifyLink address={SLICE_DISTRIBUTOR_EXPECTED_ADDRESS} />, nonce 52 -&gt; {SLICE_ESCROW_EXPECTED_ADDRESS} <SourcifyLink address={SLICE_ESCROW_EXPECTED_ADDRESS} />
        </p>
        {address && !isDeployer && <div className="mt-2"><Note>This wallet is not the expected deployer. Connect {SLICE_ADMIN_DEPLOYER}.</Note></div>}
        {address && isDeployer && nonce !== null && nonce !== DISTRIBUTOR_NONCE && !a && <div className="mt-2"><Note>Wallet nonce is {nonce}, not 51. The addresses would not match. Do not deploy.</Note></div>}
      </Card>

      <Card title="Step A: Deploy SliceDistributor">
        {(SLICE_DISTRIBUTOR_ARGS as readonly unknown[]).map((v, i) => (
          <Row key={i} label={A_LABELS[i] ?? `Arg ${i}`}>{String(v)}{i === 4 ? ` (${EPOCH_NOTE})` : ''}</Row>
        ))}
        <div className="mt-3"><ConnectOr><TxButton testId="deploy-a" onClick={() => deploy('a')} busy={busy === 'a'} disabled={aBlocked || !!a}>Deploy SliceDistributor</TxButton></ConnectOr></div>
        {a && <Result r={a} expect={{ escrow: SLICE_ESCROW_EXPECTED_ADDRESS, rootPoster: SLICE_ROOT_POSTER, ROOT_DELAY: '86400', epochGenesis: '1794096000' }} />}
      </Card>

      <Card title="Step B: Deploy SliceEscrow">
        {(SLICE_ESCROW_ARGS as readonly unknown[]).map((v, i) => <Row key={i} label={B_LABELS[i] ?? `Arg ${i}`}>{String(v)}</Row>)}
        <p className="mt-2 text-[12px] text-white/60">The escrow checks the distributor on deploy; it reverts if Step A is not the address above.</p>
        {a && !aMatches && <div className="mt-2"><Note>Stop: addresses do not match. Contact the developer.</Note></div>}
        <div className="mt-3"><ConnectOr><TxButton testId="deploy-b" onClick={() => deploy('b')} busy={busy === 'b'} disabled={!aMatches || !!b}>Deploy SliceEscrow</TxButton></ConnectOr></div>
        {b && <Result r={b} expect={{ distributor: SLICE_DISTRIBUTOR_EXPECTED_ADDRESS, MIN_SLICE_BPS: '25', MAX_TOTAL_BPS: '500', MIN_DURATION: '2592000', MAX_DURATION: '31536000' }} />}
      </Card>
    </div>
  );
}
