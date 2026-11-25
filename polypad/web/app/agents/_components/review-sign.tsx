'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { decodeEventLog, formatEther, type Address, type Hex } from 'viem';
import { useAccount, useSwitchChain, useWriteContract } from 'wagmi';
import { PolydashFactoryABI } from '@/lib/contracts/abis';
import { robinhoodChain } from '@/lib/chain';
import { publicClient } from '@/lib/agents/tools';
import { Button } from '@/components/ui/button';
import { ErrorNote, Pill, TxLink, card } from './ui';
import type { TxPlan } from './forge';
import { cn } from '@/lib/utils';

interface StepState { sim: 'idle' | 'running' | 'ok' | 'fail' | 'waiting'; simMsg?: string; signing?: boolean; hash?: Hex; done?: boolean; error?: string }

const short = (e: any) => {
  const m: string = e?.shortMessage ?? e?.message ?? 'Failed';
  return m.includes('User rejected') || m.includes('denied') ? 'Transaction cancelled in wallet.' : m.split('\n')[0];
};

export function ReviewSign({ plan, onClose }: { plan: TxPlan; onClose: () => void }) {
  const { address: account, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [steps, setSteps] = useState<StepState[]>(() => plan.steps.map(() => ({ sim: 'idle' })));
  const [created, setCreated] = useState<{ launch?: Address; token?: Address } | null>(null);
  const [poolAddr, setPoolAddr] = useState<string | null>(null);

  const patch = (i: number, s: Partial<StepState>) => setSteps((prev) => prev.map((x, j) => (j === i ? { ...x, ...s } : x)));

  const simulate = useCallback(async (i: number) => {
    const st = plan.steps[i];
    if (!account) return;
    patch(i, { sim: 'running', simMsg: undefined });
    try {
      const { result } = await publicClient.simulateContract({ account, address: st.to, abi: st.abi, functionName: st.functionName, args: st.args, value: st.value } as any);
      let msg = 'Simulation passed.';
      if (st.functionName === 'createLaunch' && Array.isArray(result)) msg = `Simulation passed. Expected launch ${result[0]}, token ${result[1]}.`;
      if (st.functionName === 'createPool' && typeof result === 'string') { msg = `Simulation passed. Expected pool ${result}.`; setPoolAddr(result); }
      patch(i, { sim: 'ok', simMsg: msg });
    } catch (e) {
      patch(i, { sim: 'fail', simMsg: `Simulation failed: ${short(e)}` });
    }
  }, [account, plan]);

  useEffect(() => {
    plan.steps.forEach((_, i) => {
      if (i === 0) simulate(0);
      else patch(i, { sim: 'waiting', simMsg: 'Simulated after the previous step confirms.' });
    });
  }, [plan, simulate]);

  const sign = async (i: number) => {
    const st = plan.steps[i];
    patch(i, { signing: true, error: undefined });
    try {
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      const hash = await writeContractAsync({ address: st.to, abi: st.abi, functionName: st.functionName, args: st.args, value: st.value, chainId: robinhoodChain.id } as any);
      patch(i, { hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Transaction reverted.');
      patch(i, { done: true, signing: false });
      if (st.functionName === 'createLaunch') {
        for (const log of receipt.logs) {
          try {
            const ev = decodeEventLog({ abi: PolydashFactoryABI, data: log.data, topics: log.topics });
            if (ev.eventName === 'LaunchCreated') { setCreated({ launch: ev.args.launch, token: ev.args.token }); break; }
          } catch { /* other event */ }
        }
      }
      if (st.functionName === 'createPool') {
        // PoolCreated(pool indexed, ...) from the factory: the pool is the first indexed topic.
        const log = receipt.logs.find((l) => l.address.toLowerCase() === st.to.toLowerCase() && l.topics[0] === '0x456b3be9337b85c0de5db05a624108913601f1547f51850eba3e777474cf5c07' && l.topics.length > 1);
        if (log?.topics[1]) setPoolAddr(`0x${log.topics[1].slice(-40)}`);
      }
      if (i + 1 < plan.steps.length) simulate(i + 1);
    } catch (e) {
      console.error('PolyForge transaction failed', e);
      patch(i, { signing: false, error: short(e) });
    }
  };

  const allDone = steps.every((s) => s.done);

  return (
    <div className={cn(card, 'border-polydash-green/30 p-4 sm:p-5')}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold">Review & sign</h3>
        <button onClick={onClose} className="text-[12px] text-white/50 hover:text-white">Edit</button>
      </div>
      <p className="text-[13px] text-white/75">{plan.summary}</p>
      {plan.notes.map((n) => <p key={n} className="mt-1 text-[12px] text-white/50">{n}</p>)}
      <p className="mt-3 rounded-xl bg-yellow-400/[0.06] px-3 py-2 text-[12px] text-yellow-200/90">Review every field and sign only in your own wallet. Never share a seed phrase.</p>

      <ol className="mt-4 space-y-3">
        {plan.steps.map((st, i) => {
          const s = steps[i];
          const prevDone = i === 0 || steps[i - 1]?.done;
          return (
            <li key={i} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[13px] font-medium">{plan.steps.length > 1 ? `Step ${i + 1}: ` : ''}{st.label}</div>
                {s.done ? <Pill tone="green"><Check className="mr-1 h-3 w-3" /> Confirmed</Pill> : null}
              </div>
              <dl className="mt-2 space-y-1 text-[12px]">
                {([['Target contract', st.to], ['Function', st.functionName], ['Value', `${formatEther(st.value)} ETH`], ...st.params] as [string, string][]).map(([k, v]) => (
                  <div key={k} className="flex flex-col gap-0.5 border-b border-white/[0.05] pb-1 sm:flex-row sm:justify-between sm:gap-4">
                    <dt className="shrink-0 text-white/45">{k}</dt>
                    <dd className="break-all font-mono text-white/85 sm:text-right">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className={cn('mt-2 text-[12px]', s.sim === 'ok' ? 'text-polydash-green' : s.sim === 'fail' ? 'text-[#FF8A80]' : 'text-white/45')}>
                {s.sim === 'running' ? <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Simulating</span> : <span className="break-words">{s.simMsg}</span>}
              </div>
              {s.error && <div className="mt-2"><ErrorNote message={s.error} /></div>}
              {s.hash && <div className="mt-2 text-[12px] text-white/60">Transaction: <TxLink hash={s.hash} /></div>}
              {!s.done && (
                <Button className="mt-3" size="sm" disabled={!prevDone || !!s.signing || !account} onClick={() => sign(i)}>
                  {s.signing ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {s.hash ? 'Waiting for confirmation' : 'Confirm in wallet'}</> : `Sign${plan.steps.length > 1 ? ` step ${i + 1}` : ''}`}
                </Button>
              )}
            </li>
          );
        })}
      </ol>

      {created && (
        <div className="mt-4 rounded-xl bg-polydash-green/[0.08] p-3 text-[12px]">
          <div className="font-medium text-polydash-green">Launch created</div>
          <div className="mt-1 break-all font-mono text-white/80">Launch: {created.launch}</div>
          <div className="break-all font-mono text-white/80">Token: {created.token}</div>
        </div>
      )}
      {allDone && plan.kind === 'pool' && (
        <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-polydash-green">
          Staking pool created.
          <a href={poolAddr ? `/stake/${poolAddr.toLowerCase()}` : '/stake'} className="inline-flex h-10 items-center font-medium text-white underline-offset-4 hover:underline sm:h-auto">View pool / Stake now</a>
        </p>
      )}
    </div>
  );
}
