'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { useFactoriesLive, useVaultTargetLive, useBuybackTx, ABIS } from '@/lib/hooks/use-buyback';
import { useNow, formatCountdown } from '@/lib/hooks/use-nft-collections';
import {
  BUYBACK_VAULT_ADDRESS, DEPLOY_VAULT_FIRST, ERRORS, PLATFORM_FEE_WALLET, SET_CONFIRM, TARGET_BPS, TARGET_NOTE, ZERO,
  fmtPT, fmtToken, isAddress, sameAddress, vaultAddress, type Addr,
} from '@/lib/buyback';
import { AddrLink, Card, ConfirmModal, ConnectOr, Note, Row, TxButton, TxLink } from '@/components/buyback/ui';

function FactoryPanel({ f, idx }: { f: { address: Addr; owner: Addr | null; enabled: boolean; bps: number; contract: Addr | null }; idx: number }) {
  const tx = useBuybackTx();
  const [confirm, setConfirm] = useState(false);
  const vault = vaultAddress();
  const isOwner = sameAddress(tx.address, f.owner);
  const atTarget = !!vault && f.enabled && f.bps === TARGET_BPS && sameAddress(f.contract, vault);
  const key = `set-${f.address}`;
  return (
    <Card title={`Launch factory ${idx === 0 ? 'A' : 'B'}`}>
      <Row label="Factory"><AddrLink address={f.address} /></Row>
      <Row label="Owner"><AddrLink address={f.owner} /></Row>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-white/[0.04] p-3">
          <p className="text-[12px] text-white/55">Current</p>
          <p className="mt-1 text-[13px] text-white" data-testid={`factory-current-${idx}`}>
            {f.enabled ? 'Enabled' : 'Disabled'}, {f.bps} bps ({f.bps / 100}%)
          </p>
          <p className="mt-1 text-[12px] text-white/70">Contract: {f.contract && !/^0x0{40}$/i.test(f.contract) ? <AddrLink address={f.contract} /> : 'none'}</p>
        </div>
        <div className="rounded-xl bg-white/[0.04] p-3">
          <p className="text-[12px] text-white/55">Target</p>
          <p className="mt-1 text-[13px] text-white">Enabled, {TARGET_BPS} bps (40%)</p>
          <p className="mt-1 text-[12px] text-white/70">Vault: {vault ? <AddrLink address={vault} /> : 'not deployed'}</p>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {!vault && <Note>{DEPLOY_VAULT_FIRST}</Note>}
        <p className="text-[12px] text-white/55" data-testid={`owner-check-${idx}`}>
          Owner check: {tx.address ? (isOwner ? 'connected wallet is the factory owner' : 'connected wallet is not the factory owner') : 'no wallet connected'}
        </p>
        <ConnectOr>
          {isOwner ? (
            <TxButton disabled={!vault || atTarget} busy={tx.pending === key} onClick={() => setConfirm(true)}>
              {atTarget ? 'Already set to 40% to the buyback vault' : 'Set 40% to the buyback vault'}
            </TxButton>
          ) : (
            <p className="text-[12px] text-amber-100/90">Connect the Polydash fee wallet to change this.</p>
          )}
        </ConnectOr>
        {tx.lastHash?.key === key && <p className="text-[12px] text-white/55">Tx: <TxLink hash={tx.lastHash.hash} /></p>}
      </div>
      <ConfirmModal
        open={confirm}
        title="Set 40% to the buyback vault"
        body={<p>{SET_CONFIRM}</p>}
        confirmLabel="Confirm"
        onClose={() => setConfirm(false)}
        onConfirm={() => vault && tx.send({ key, address: f.address, abi: 'factory', functionName: 'setBuybackConfig', args: [true, BigInt(TARGET_BPS), vault], success: 'Factory buyback setting updated' })}
      />
    </Card>
  );
}

function TargetSection() {
  const vault = vaultAddress();
  const { data: t } = useVaultTargetLive();
  const tx = useBuybackTx();
  const now = useNow();
  const [input, setInput] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const isAdmin = sameAddress(tx.address, t?.admin ?? PLATFORM_FEE_WALLET);
  const due = !!t?.pending || (t?.pendingAt ?? 0) > 0;
  const canExecute = due && now != null && now >= (t?.pendingAt ?? 0);

  const propose = async () => {
    setErr(null);
    const v = input.trim();
    if (v && !isAddress(v)) { setErr('Enter a valid address, or leave empty for no target.'); return; }
    const addr = (v || ZERO) as Addr;
    if (addr !== ZERO && tx.client && vault) {
      try {
        const ok = await tx.client.readContract({ address: vault, abi: ABIS.vault, functionName: 'isValidTarget', args: [addr] });
        if (!ok) { setErr(ERRORS.InvalidTarget); return; }
      } catch (e) {
        console.error('isValidTarget failed', e);
        setErr('Could not check the target. Try again.');
        return;
      }
    }
    await tx.send({ key: 'propose', address: vault!, abi: 'vault', functionName: 'proposeTarget', args: [addr], success: 'Target proposed' });
  };

  return (
    <Card title="Stakers' rewards target">
      {!vault ? (
        <Note>{DEPLOY_VAULT_FIRST}</Note>
      ) : (
        <>
          <Row label="Rewards target">{t?.target ? <AddrLink address={t.target} /> : 'No target'}</Row>
          <Row label="Target end time">{fmtPT(t?.endTime)}</Row>
          <Row label="Target active">{t ? (t.active ? 'Yes' : 'No') : '-'}</Row>
          <Row label="Held for stakers">{fmtToken(t?.held)} POLYDASH</Row>
          <Row label="Pending target">{t?.pending ? <AddrLink address={t.pending} /> : due ? 'No target (address 0)' : 'None'}</Row>
          <Row label="Executable after">
            {due ? `${fmtPT(t?.pendingAt)}${now != null && (t?.pendingAt ?? 0) > now ? ` (in ${formatCountdown((t?.pendingAt ?? 0) - now)})` : ''}` : '-'}
          </Row>
          <div className="mt-4 space-y-3">
            <ConnectOr>
              {isAdmin ? (
                <div className="space-y-3">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="0x… (empty = no target)" className="font-mono" />
                    <TxButton busy={tx.pending === 'propose'} onClick={propose}>Propose target</TxButton>
                  </div>
                  {err && <p className="text-[12px] text-red-300">{err}</p>}
                  <div className="flex flex-wrap gap-2">
                    <TxButton variant="outline" disabled={!due} busy={tx.pending === 'cancel'} onClick={() => tx.send({ key: 'cancel', address: vault, abi: 'vault', functionName: 'cancelTarget', success: 'Pending target cancelled' })}>Cancel</TxButton>
                    <TxButton disabled={!canExecute} busy={tx.pending === 'execute'} onClick={() => tx.send({ key: 'execute', address: vault, abi: 'vault', functionName: 'executeTarget', success: 'Target changed' })}>Execute</TxButton>
                  </div>
                </div>
              ) : (
                <p className="text-[12px] text-amber-100/90">Connect the Polydash fee wallet to change this.</p>
              )}
            </ConnectOr>
            {tx.lastHash && <p className="text-[12px] text-white/55">Tx: <TxLink hash={tx.lastHash.hash} /></p>}
          </div>
        </>
      )}
      <div className="mt-4"><Note tone="muted">{TARGET_NOTE}</Note></div>
    </Card>
  );
}

export function BuybackSettings() {
  const { data: factories, isLoading } = useFactoriesLive();
  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-8 sm:py-12">
      <div>
        <h1 className="text-2xl font-semibold text-white sm:text-3xl">Buyback settings</h1>
        <p className="mt-2 text-[13px] text-white/55">
          Factory buyback setting and the stakers&apos; rewards target. Vault: {BUYBACK_VAULT_ADDRESS ? <AddrLink address={BUYBACK_VAULT_ADDRESS} /> : 'not deployed'}.
        </p>
      </div>
      {!BUYBACK_VAULT_ADDRESS && <Note>{DEPLOY_VAULT_FIRST}. The factory reads and owner check below still work.</Note>}
      {isLoading && <p className="text-[13px] text-white/55">Loading factory settings…</p>}
      <div className="grid gap-5">
        {factories?.map((f, i) => <FactoryPanel key={f.address} f={f} idx={i} />)}
      </div>
      <TargetSection />
    </div>
  );
}
