'use client';

import { useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { Download, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { parseEther, parseUnits } from 'viem';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { Button } from '@/components/ui/button';
import { InfoNote } from '@/components/treasury/notes';
import { Field, RulesFields, Segmented, buildRules, inputCls, rulesToState, type RulesFormState } from '@/components/treasury/rules-form';
import { useTreasuryTx, type TreasuryData } from '@/lib/hooks/use-treasury';
import {
  DAY, HOUR, MAX_CLAIM_DAYS, MAX_DELAY, MAX_EXECUTORS, MIN_CLAIM_DAYS, MIN_DELAY, TIMELOCK_NOTE, ZERO_ADDRESS, fmtAmount, isAddr, type Addr,
} from '@/lib/treasury';

type Tab = 'rules' | 'withdraw' | 'agent' | 'delay' | 'airdrop';

export function CreatorControls({ t, token, decimals, symbol }: { t: TreasuryData; token: Addr; decimals: number; symbol: string }) {
  const { address } = useAccount();
  const { send, pending, lastError } = useTreasuryTx();
  const vault = t.vault as Addr;
  const [tab, setTab] = useState<Tab>('withdraw');
  const [err, setErr] = useState<string | null>(null);

  // rules
  const [rs, setRs] = useState<RulesFormState | null>(null);
  const rulesState = rs ?? (t.rules ? rulesToState(t.rules, decimals) : null);
  const builtRules = useMemo(() => (rulesState ? buildRules(rulesState, decimals) : null), [rulesState, decimals]);
  // withdraw
  const [asset, setAsset] = useState<'eth' | 'token'>('eth');
  const [wAmount, setWAmount] = useState('');
  const [wTo, setWTo] = useState('');
  // agent / delay
  const [agent, setAgent] = useState('');
  const [delayHours, setDelayHours] = useState(String((t.timelockDelay ?? 0) / HOUR));
  // airdrop
  const [csv, setCsv] = useState('');
  const [claimDays, setClaimDays] = useState('30');

  const tree = useMemo(() => {
    if (!csv.trim()) return { error: null as string | null, tree: null as StandardMerkleTree<[string, string]> | null, total: BigInt(0), count: 0 };
    try {
      const seen = new Set<string>();
      const values: [string, string][] = [];
      let total = BigInt(0);
      csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
        const [a, amt] = line.split(/[,;\t]/).map((x) => x.trim());
        if (i === 0 && !isAddr(a)) return; // header row
        if (!isAddr(a)) throw new Error(`Line ${i + 1}: invalid address`);
        const key = a.toLowerCase();
        if (seen.has(key)) throw new Error(`Line ${i + 1}: duplicate address`);
        seen.add(key);
        const v = parseUnits(amt as `${number}`, decimals);
        if (v <= BigInt(0)) throw new Error(`Line ${i + 1}: amount must be above 0`);
        total += v;
        values.push([key, v.toString()]);
      });
      if (!values.length) throw new Error('No rows found');
      return { error: null, tree: StandardMerkleTree.of(values, ['address', 'uint256']), total, count: values.length };
    } catch (e: any) {
      return { error: e?.message ?? 'Invalid CSV', tree: null, total: BigInt(0), count: 0 };
    }
  }, [csv, decimals]);

  const downloadTree = () => {
    if (!tree.tree) return;
    const blob = new Blob([JSON.stringify(tree.tree.dump(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `treasury-airdrop-${tree.tree.root.slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const uploadTree = async (dump: unknown) => {
    try {
      const r = await fetch(`/api/treasury/${token}/proof`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tree: dump }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
      toast.success('Tree uploaded. Holders can now load their proofs on this page.');
    } catch (e: any) {
      console.error('tree upload failed', e);
      toast.error(e?.message === 'root_not_found_on_chain' ? 'Queue the airdrop first, then upload its tree.' : 'Tree upload failed. You can retry from this panel.');
    }
  };
  const uploadFile = async (f: File | undefined) => {
    if (!f) return;
    try { await uploadTree(JSON.parse(await f.text())); } catch (e) { console.error('tree file parse failed', e); toast.error('That file is not a valid tree JSON.'); }
  };

  const queue = async () => {
    setErr(null);
    if (tab === 'rules') {
      if (!builtRules?.rules) return setErr('Fix the highlighted rule fields.');
      await send({ key: 'q-rules', address: vault, abi: 'vault', functionName: 'queueRules', args: [builtRules.rules], success: 'Rule change queued' });
    } else if (tab === 'withdraw') {
      let amt: bigint;
      try { amt = asset === 'eth' ? parseEther(wAmount.trim() as `${number}`) : parseUnits(wAmount.trim() as `${number}`, decimals); } catch { return setErr('Enter a valid amount.'); }
      const to = (wTo.trim() || address || '').toLowerCase();
      if (amt <= BigInt(0) || !isAddr(to)) return setErr('Enter an amount and a recipient address.');
      await send({ key: 'q-withdraw', address: vault, abi: 'vault', functionName: 'queueWithdraw', args: [asset === 'eth' ? ZERO_ADDRESS : token, amt, to], success: 'Withdrawal queued' });
    } else if (tab === 'agent') {
      if (!isAddr(agent.trim())) return setErr('Enter a valid address.');
      if ((t.executors?.length ?? 0) >= MAX_EXECUTORS) return setErr(`Up to ${MAX_EXECUTORS} agents.`);
      await send({ key: 'q-agent', address: vault, abi: 'vault', functionName: 'queueAddExecutor', args: [agent.trim().toLowerCase()], success: 'New agent queued' });
    } else if (tab === 'delay') {
      const d = Math.round(Number(delayHours) * HOUR);
      if (!Number.isFinite(d) || d < MIN_DELAY || d > MAX_DELAY) return setErr('Between 24 hours and 30 days.');
      await send({ key: 'q-delay', address: vault, abi: 'vault', functionName: 'queueDelay', args: [BigInt(d)], success: 'Timelock change queued' });
    } else {
      const days = Number(claimDays);
      if (!tree.tree) return setErr(tree.error ?? 'Paste a CSV of address,amount.');
      if (!Number.isInteger(days) || days < MIN_CLAIM_DAYS || days > MAX_CLAIM_DAYS) return setErr('Claim window is 1 to 365 days.');
      const r = await send({ key: 'q-airdrop', address: vault, abi: 'vault', functionName: 'queueAirdrop', args: [tree.tree.root, tree.total, BigInt(days * DAY)], success: 'Airdrop round queued' });
      if (r) await uploadTree(tree.tree.dump());
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <h3 className="text-[14px] font-semibold text-white">Creator controls</h3>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" className="rounded-full" disabled={!!pending}
          onClick={() => send({ key: 'pause', address: vault, abi: 'vault', functionName: 'setPaused', args: [!t.paused], success: t.paused ? 'Treasury resumed' : 'Treasury paused' })}>
          {pending === 'pause' && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />} {t.paused ? 'Resume' : 'Pause'}
        </Button>
        <span className="text-[11px] text-white/45">Pause and removing an agent take effect immediately.</span>
      </div>
      {!!t.executors?.length && (
        <ul className="mt-3 space-y-1.5">
          {t.executors.map((e) => (
            <li key={e} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-3 py-1.5">
              <code className="truncate font-mono text-[11px] text-white/80">{e}</code>
              <button type="button" className="text-[11px] text-red-300 hover:text-red-200 disabled:opacity-50" disabled={!!pending}
                onClick={() => send({ key: `rm-${e}`, address: vault, abi: 'vault', functionName: 'removeExecutor', args: [e], success: 'Agent removed' })}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <InfoNote className="mt-4">{TIMELOCK_NOTE}</InfoNote>
      <div className="mt-4">
        <Segmented value={tab} onChange={(v) => { setTab(v); setErr(null); }} options={[
          { value: 'withdraw', label: 'Withdraw' }, { value: 'rules', label: 'Change rules' }, { value: 'agent', label: 'Add agent' },
          { value: 'delay', label: 'Timelock' }, { value: 'airdrop', label: 'Airdrop round' },
        ]} />
      </div>

      <div className="mt-4 space-y-4">
        {tab === 'withdraw' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Asset">
              <Segmented value={asset} onChange={setAsset} options={[{ value: 'eth', label: 'ETH' }, { value: 'token', label: symbol || 'Token' }]} />
            </Field>
            <Field label="Amount" hint={asset === 'token' ? `Available: ${fmtAmount(t.balances?.available ?? '0', decimals)} ${symbol}` : undefined}>
              <input className={inputCls} inputMode="decimal" value={wAmount} onChange={(e) => setWAmount(e.target.value)} />
            </Field>
            <Field label="Recipient" hint="Default: your wallet">
              <input className={inputCls} placeholder={address ?? '0x...'} value={wTo} onChange={(e) => setWTo(e.target.value)} />
            </Field>
          </div>
        )}
        {tab === 'rules' && rulesState && (
          <RulesFields s={rulesState} set={(p) => setRs({ ...rulesState, ...p })} errors={builtRules?.errors ?? {}} symbol={symbol} includeExecution />
        )}
        {tab === 'agent' && (
          <Field label="Agent address" hint="Agents can only trigger buybacks and reward pools within the rules. They never receive funds.">
            <input className={inputCls} placeholder="0x..." value={agent} onChange={(e) => setAgent(e.target.value)} />
          </Field>
        )}
        {tab === 'delay' && (
          <Field label="New timelock delay (hours)" hint="24 hours to 30 days">
            <input className={inputCls} inputMode="decimal" value={delayHours} onChange={(e) => setDelayHours(e.target.value)} />
          </Field>
        )}
        {tab === 'airdrop' && (
          <div className="space-y-3">
            <Field label="Recipients CSV (address,amount)" hint={`Amounts in ${symbol || 'tokens'}. Max per round: ${fmtAmount(t.rules?.maxAirdropPerRound ?? '0', decimals)} ${symbol}.`} error={tree.error ?? undefined}>
              <textarea className={`${inputCls} min-h-[120px] font-mono text-[11px]`} placeholder={'0xabc...,1000\n0xdef...,250'} value={csv} onChange={(e) => setCsv(e.target.value)} />
            </Field>
            {tree.tree && (
              <div className="rounded-xl bg-white/[0.04] p-3 text-[11px] text-white/70">
                <p>{tree.count} recipients · total {fmtAmount(tree.total, decimals)} {symbol}</p>
                <p className="mt-1 break-all font-mono">Root {tree.tree.root}</p>
                <Button size="sm" variant="outline" className="mt-2 rounded-full" onClick={downloadTree}><Download className="mr-1.5 h-3.5 w-3.5" /> Download tree JSON</Button>
              </div>
            )}
            <Field label="Claim window (days)" hint="1 to 365 days">
              <input className={inputCls} inputMode="numeric" value={claimDays} onChange={(e) => setClaimDays(e.target.value)} />
            </Field>
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-white/60 hover:text-white">
              <Upload className="h-3.5 w-3.5" /> Upload a saved tree JSON for proofs
              <input type="file" accept="application/json" className="hidden" onChange={(e) => uploadFile(e.target.files?.[0])} />
            </label>
          </div>
        )}
        <Button className="rounded-full" onClick={queue} disabled={!!pending}>
          {pending?.startsWith('q-') && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Queue change
        </Button>
        {(err || lastError) && <p className="text-[12px] text-red-300">{err || lastError}</p>}
      </div>
    </div>
  );
}
