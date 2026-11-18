'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { Loader2 } from 'lucide-react';
import { parseEther, parseEventLogs } from 'viem';
import { Button } from '@/components/ui/button';
import { InfoNote, TreasuryNote } from '@/components/treasury/notes';
import { Field, RulesFields, Segmented, buildRules, defaultRulesState, inputCls, type RulesFormState } from '@/components/treasury/rules-form';
import { FACTORY_ABI, useTreasurySetupInfo, useTreasuryTx } from '@/lib/hooks/use-treasury';
import {
  AGENTS_NOTE, DEFAULT_DELAY, HOUR, MAX_DELAY, MAX_EXECUTORS, MIN_DELAY, NOT_ELIGIBLE, isAddr, isPolydashToken, treasuryFactory, type Addr,
} from '@/lib/treasury';

export function TreasurySetup({ initialToken }: { initialToken: string }) {
  const router = useRouter();
  const { isConnected } = useAccount();
  const [tokenInput, setTokenInput] = useState(initialToken);
  const token = isAddr(tokenInput.trim()) ? (tokenInput.trim().toLowerCase() as Addr) : null;
  const info = useTreasurySetupInfo(token);
  const { send, pending, lastError } = useTreasuryTx();
  const [s, setS] = useState<RulesFormState>(defaultRulesState);
  const set = (p: Partial<RulesFormState>) => setS((x) => ({ ...x, ...p }));
  const [budget, setBudget] = useState('');
  const [executorsText, setExecutorsText] = useState('');
  const [delayHours, setDelayHours] = useState(String(DEFAULT_DELAY / HOUR));
  const [submitted, setSubmitted] = useState(false);
  const d = info.data;
  const decimals = d?.decimals ?? 18;

  const built = useMemo(() => buildRules(s, decimals), [s, decimals]);
  const executors = useMemo(() => Array.from(new Set(executorsText.split(/[\s,]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))), [executorsText]);
  const execError = s.openExecution ? undefined
    : executors.some((x) => !isAddr(x)) ? 'One of the agent addresses is not a valid address.'
    : executors.length > MAX_EXECUTORS ? `Up to ${MAX_EXECUTORS} agents.` : undefined;
  const delaySec = Math.round(Number(delayHours) * HOUR);
  const delayError = !Number.isFinite(delaySec) || delaySec < MIN_DELAY || delaySec > MAX_DELAY ? 'Between 24 hours and 30 days.' : undefined;
  let budgetWei = BigInt(0);
  let budgetError: string | undefined;
  try { budgetWei = budget.trim() ? parseEther(budget.trim() as `${number}`) : BigInt(0); } catch { budgetError = 'Enter a valid ETH amount.'; }

  const submit = async () => {
    setSubmitted(true);
    const factory = treasuryFactory();
    if (!factory || !token || !built.rules || execError || delayError || budgetError) return;
    const r = await send({
      key: 'create', address: factory, abi: 'factory', functionName: 'createRules',
      args: [token, built.rules, s.openExecution ? [] : executors, BigInt(delaySec === DEFAULT_DELAY ? 0 : delaySec)],
      value: budgetWei > BigInt(0) ? budgetWei : undefined, success: 'Treasury rules created',
    });
    if (!r) return;
    const ev = parseEventLogs({ abi: FACTORY_ABI, logs: r.logs, eventName: 'RulesCreated' as any }) as any[];
    if (!ev.length) console.error('RulesCreated event not found in receipt', r.transactionHash);
    router.push(`/token/${token}#treasury`);
  };

  const shownErrors = submitted ? built.errors : {};

  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-[12px] uppercase tracking-wider text-white/55">Treasury rules</p>
      <h1 className="mt-1 text-2xl font-semibold text-white">Set up treasury rules{d?.symbol ? ` for ${d.symbol}` : ''}</h1>
      <p className="mt-2 text-[13px] text-white/65">
        A treasury vault you own, with public limits for buybacks, reward pools and airdrops. Your wallet signs every transaction; funds stay in the vault contract.
      </p>
      <TreasuryNote className="mt-4" />

      {!initialToken && (
        <div className="mt-6">
          <Field label="Token address">
            <input className={inputCls} placeholder="0x..." value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} />
          </Field>
        </div>
      )}

      <div className="mt-6">
        {!token ? (
          <InfoNote>Open this page from a token you launched, or paste its address above.</InfoNote>
        ) : isPolydashToken(token) ? (
          <InfoNote>{NOT_ELIGIBLE}</InfoNote>
        ) : !isConnected ? (
          <ConnectButton.Custom>{({ openConnectModal }) => <Button className="rounded-full" onClick={openConnectModal}>Connect wallet</Button>}</ConnectButton.Custom>
        ) : info.isLoading ? (
          <div className="flex items-center gap-2 text-[13px] text-white/60"><Loader2 className="h-4 w-4 animate-spin" /> Checking eligibility…</div>
        ) : info.isError ? (
          <InfoNote>Could not read this token right now. Please try again.</InfoNote>
        ) : !d?.launch || !d.isCreator ? (
          <InfoNote>{NOT_ELIGIBLE}</InfoNote>
        ) : d.existing ? (
          <InfoNote>This token already has treasury rules. <a className="underline" href={`/token/${token}#treasury`}>View them on the token page</a>.</InfoNote>
        ) : (
          <div className="space-y-4">
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
              <h3 className="text-[14px] font-semibold text-white">Starting budget</h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Starting ETH budget" hint="Optional. Sent to the vault with the setup transaction. You can add ETH or tokens later." error={budgetError}>
                  <input className={inputCls} inputMode="decimal" placeholder="0" value={budget} onChange={(e) => setBudget(e.target.value)} />
                </Field>
              </div>
            </section>

            <RulesFields s={s} set={set} errors={shownErrors} symbol={d.symbol} />

            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
              <h3 className="text-[14px] font-semibold text-white">Who can trigger actions</h3>
              <p className="mt-1 text-[12px] text-white/55">{AGENTS_NOTE}</p>
              <div className="mt-4 space-y-4">
                <Segmented value={s.openExecution} onChange={(v) => set({ openExecution: v })} options={[
                  { value: false, label: 'Approved agents only' }, { value: true, label: 'Anyone' },
                ]} />
                {!s.openExecution && (
                  <Field label={`Agent addresses (up to ${MAX_EXECUTORS}, one per line)`} hint="Optional now. You can add agents later through the timelock." error={submitted ? execError : undefined}>
                    <textarea className={`${inputCls} min-h-[96px] font-mono`} placeholder="0x..." value={executorsText} onChange={(e) => setExecutorsText(e.target.value)} />
                  </Field>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
              <h3 className="text-[14px] font-semibold text-white">Timelock</h3>
              <p className="mt-1 text-[12px] text-white/55">Withdrawals, rule changes, new agents and airdrop rounds wait this long before they take effect.</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Timelock delay (hours)" hint="Default 48 hours. 24 hours to 30 days." error={submitted ? delayError : undefined}>
                  <input className={inputCls} inputMode="decimal" value={delayHours} onChange={(e) => setDelayHours(e.target.value)} />
                </Field>
              </div>
            </section>

            {lastError && <p className="rounded-xl border border-red-400/25 bg-red-500/[0.06] p-3 text-[12px] text-red-200">{lastError}</p>}
            {submitted && Object.keys(built.errors).length > 0 && <p className="text-[12px] text-red-300">Fix the highlighted fields above.</p>}
            <Button className="rounded-full" onClick={submit} disabled={!!pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create treasury rules
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
