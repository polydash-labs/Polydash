'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Bot, Check, Copy, Loader2, Upload, X } from 'lucide-react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useQueryClient } from '@tanstack/react-query';
import { decodeEventLog, keccak256, toHex, zeroAddress } from 'viem';
import { useAccount, usePublicClient, useSwitchChain, useWalletClient, useWriteContract } from 'wagmi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { FundFactoryInvestABI, FundVaultInvestABI } from '@/lib/contracts/fund-abi';
import { getExplorerAddressUrl, getExplorerTxUrl } from '@/lib/contracts/addresses';
import { robinhoodChain } from '@/lib/chain';
import { getFundInvestFactoryAddress } from '@/lib/fund/address';
import {
  AgentExecutorABI,
  AgentRegistryABI,
  RISK_LEVELS,
  RUNNER_COMMANDS,
  SAMPLE_PRICE_SERIES,
  STRATEGY_TEMPLATES,
  buildRulesJson,
  explainTrade,
  formatChange,
  generateMandateText,
  getAgentExecutorBytecode,
  getAgentRegistryAddress,
  prefillFromParams,
  riskLabel,
  rulesHashFor,
  runPaperTrade,
  strategyDefaults,
  templateById,
  validateAgentIdentity,
  validateGuardrails,
  runnerEnvText,
  type PaperTradeResult,
  type StrategyParams,
} from '@/lib/fund/agent';
import {
  DEFAULT_FUND_DRAFT,
  bpsLabel,
  formatFundEth,
  fundTxError,
  mandateHashFor,
  parseAssetList,
  previewDraft,
  type FundDraft,
} from '@/lib/fund/model';
import { cn } from '@/lib/utils';
import { FundNotice } from '../../_components/fund-notice';

const STEPS = [
  { label: 'Agent' },
  { label: 'Strategy' },
  { label: 'Guardrails' },
  { label: 'Fund setup' },
  { label: 'Review' },
];

type DeployStage = 'idle' | 'fund' | 'executor' | 'register' | 'authorize' | 'done' | 'waiting-executor';

type Created = {
  fund?: string;
  vault?: string;
  executor?: string;
  agentId?: string;
  fundTx: string;
};

export function AgentFundWizard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { address: account, isConnected, chainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { data: walletClient } = useWalletClient({ chainId: robinhoodChain.id });
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: robinhoodChain.id });
  const [step, setStep] = useState(0);
  const [reveal, setReveal] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  // Step 1 — the agent.
  const [agentName, setAgentName] = useState('');
  const [agentLogo, setAgentLogo] = useState('');
  const [agentDescription, setAgentDescription] = useState('');
  // Step 2 — the strategy.
  const [templateId, setTemplateId] = useState(4);
  const [riskLevel, setRiskLevel] = useState(1);
  // Step 3 — guardrails.
  const [params, setParams] = useState<StrategyParams>(() => strategyDefaults(4, 1));
  const [assetsText, setAssetsText] = useState('');
  const [agentKey, setAgentKey] = useState('');
  const [paperOn, setPaperOn] = useState(false);
  const [paperResult, setPaperResult] = useState<PaperTradeResult | null>(null);
  // Step 4 — the fund (same fields as the human flow).
  const [draft, setDraft] = useState<FundDraft>(DEFAULT_FUND_DRAFT);
  const [mandateUri, setMandateUri] = useState('');
  // Step 5 — review / deploy.
  const [runnerMode, setRunnerMode] = useState<0 | 1>(1);
  const [deploying, setDeploying] = useState(false);
  const [stage, setStage] = useState<DeployStage>('idle');
  const [created, setCreated] = useState<Created | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Copy-an-agent: prefill the strategy + guardrails from the link.
  useEffect(() => {
    if (prefilled) return;
    const prefill = prefillFromParams(new URLSearchParams(window.location.search));
    if (!prefill) return;
    const base = strategyDefaults(prefill.templateId, prefill.riskLevel);
    setTemplateId(prefill.templateId);
    setRiskLevel(prefill.riskLevel);
    setParams({
      ...base,
      maxPositionBps: prefill.maxPositionBps ?? base.maxPositionBps,
      maxTradeBps: prefill.maxTradeBps ?? base.maxTradeBps,
      maxDeviationBps: prefill.maxDeviationBps ?? base.maxDeviationBps,
      dailyTradeLimit: prefill.dailyTradeLimit ?? base.dailyTradeLimit,
      circuitBreakerBps: prefill.circuitBreakerBps ?? base.circuitBreakerBps,
      rebalanceIntervalSeconds: prefill.rebalanceIntervalSeconds ?? base.rebalanceIntervalSeconds,
    });
    if (prefill.assetsText) setAssetsText(prefill.assetsText);
    if (prefill.agentName) setAgentName(`${prefill.agentName} (copy)`);
    setPrefilled(true);
    toast.success('Strategy copied — change anything you like before creating the fund.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefilled]);

  const registry = getAgentRegistryAddress();
  const executorBytecode = getAgentExecutorBytecode();
  const assets = parseAssetList(assetsText);
  const assetList = assets.ok ? assets.assets : [];
  const mandateText = generateMandateText({
    agentName,
    fundName: draft.name,
    params,
    assets: assetList,
    description: agentDescription,
  });
  const mandateHash = mandateHashFor(mandateText);
  const backtested = paperResult
    ? { startValueEth: paperResult.startValueEth, endValueEth: paperResult.endValueEth, changePct: paperResult.changePct, trades: paperResult.trades.length }
    : null;
  const rulesJson = buildRulesJson({ agentName, params, assets: assetList, description: agentDescription, backtested });
  const rulesHash = rulesHashFor(rulesJson);
  const fullParams: StrategyParams = { ...params, rulesHash };
  const fundDraft: FundDraft = {
    ...draft,
    imageUri: draft.imageUri || agentLogo,
    mandateText,
    mandateUri,
    assetsText,
    maxPositionBps: params.maxPositionBps === 0 ? 7500 : params.maxPositionBps,
    maxTradeBps: params.maxTradeBps === 0 ? 7500 : params.maxTradeBps,
    maxDeviationBps: params.maxDeviationBps === 0 ? 5000 : params.maxDeviationBps,
  };
  const fundCheck = previewDraft(fundDraft);
  const investFactory = getFundInvestFactoryAddress();

  const identityIssues = validateAgentIdentity({ name: agentName, description: agentDescription, logoUri: agentLogo, agentKey });
  const guardrailIssues = validateGuardrails(params);
  const stepIssues: string[] = (() => {
    if (step === 0) return identityIssues.filter((i) => i.field !== 'agentKey').map((i) => i.message);
    if (step === 2) {
      const list = [...guardrailIssues.map((i) => i.message)];
      if (!assets.ok) list.push(assets.message);
      const keyIssue = identityIssues.find((i) => i.field === 'agentKey');
      if (keyIssue) list.push(keyIssue.message);
      return list;
    }
    if (step === 3) {
      return fundCheck.issues
        .filter((i) => ['name', 'symbol', 'imageUri', 'baseUri', 'mintPriceEth', 'raiseCapEth', 'entryFeeBps', 'skinBps', 'raiseDurationDays'].includes(i.field))
        .map((i) => i.message);
    }
    if (step === 4) return fundCheck.issues.filter((i) => i.field === 'mandateUri').map((i) => i.message);
    return [];
  })();

  const updateDraft = <K extends keyof FundDraft>(field: K, value: FundDraft[K]) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  };

  const applyTemplate = (nextTemplate: number, nextRisk: number) => {
    setTemplateId(nextTemplate);
    setRiskLevel(nextRisk);
    setParams((prev) => ({ ...strategyDefaults(nextTemplate, nextRisk), rulesHash: prev.rulesHash }));
  };

  const goNext = () => {
    if (stepIssues.length) {
      setReveal(true);
      return;
    }
    setReveal(false);
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  };

  const goBack = () => {
    setReveal(false);
    setStep((current) => Math.max(current - 1, 0));
  };

  const handleLogoFile = async (file?: File | null) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      toast.error('Use a PNG, JPG, WEBP or GIF image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be 5 MB or smaller.');
      return;
    }
    setUploading(true);
    try {
      const res = await fetch('/api/upload/logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: file.type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Upload failed');
      const formData = new FormData();
      const fields = data?.fields;
      if (!data?.uploadUrl || !fields || typeof fields !== 'object') throw new Error('Upload failed');
      for (const [key, value] of Object.entries(fields)) formData.append(key, String(value));
      formData.append('file', file);
      const upload = await fetch(data.uploadUrl, { method: 'POST', body: formData });
      if (!upload.ok) throw new Error(`Upload failed (${upload.status})`);
      setAgentLogo(data.publicUrl);
      toast.success('Logo uploaded');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const runPaper = () => {
    const result = runPaperTrade({ templateId, params, prices: SAMPLE_PRICE_SERIES, startingEth: 1 });
    setPaperResult(result);
    setPaperOn(true);
  };

  const waitReceipt = async (hash: `0x${string}`) => {
    if (!publicClient) throw new Error('No connection to Robinhood Chain.');
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error('Transaction reverted');
    return receipt;
  };

  const sendTx = async (tid: string | number, label: string, fn: () => Promise<`0x${string}`>) => {
    toast.loading(label, { id: tid });
    const hash = await fn();
    return waitReceipt(hash);
  };

  const handleDeploy = async () => {
    const checked = previewDraft(fundDraft);
    if (!checked.params || !publicClient || !account) {
      setReveal(true);
      toast.error(checked.issues[0]?.message ?? 'Check the fund settings.');
      return;
    }
    if (!investFactory) {
      toast.error('The investing factory is not configured yet.');
      return;
    }
    setDeploying(true);
    const tid = toast.loading('Confirm the transaction in your wallet…');
    try {
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      const factoryParams = checked.params;

      // 1. Create the fund via the factory (same as the human flow).
      setStage('fund');
      const fundReceipt = await sendTx(tid, 'Creating the fund on Robinhood Chain…', () =>
        writeContractAsync({
          address: investFactory as `0x${string}`,
          abi: FundFactoryInvestABI,
          functionName: 'createFund',
          chainId: robinhoodChain.id,
          args: [{
            name: factoryParams.name,
            symbol: factoryParams.symbol,
            imageUri: factoryParams.imageUri,
            baseURI: factoryParams.baseURI,
            mintPrice: factoryParams.mintPrice,
            raiseCap: factoryParams.raiseCap,
            entryFeeBps: factoryParams.entryFeeBps,
            minSkinBps: factoryParams.minSkinBps,
            raiseDuration: factoryParams.raiseDuration,
            mandateHash: factoryParams.mandateHash,
            assets: factoryParams.assets,
            mandateUri: factoryParams.mandateUri,
            maxPositionBps: factoryParams.maxPositionBps,
            maxTradeBps: factoryParams.maxTradeBps,
            maxDeviationBps: factoryParams.maxDeviationBps,
          }],
        }),
      );
      let fund: string | undefined;
      let vault: string | undefined;
      for (const log of fundReceipt.logs) {
        try {
          const event = decodeEventLog({ abi: FundFactoryInvestABI, data: log.data, topics: log.topics });
          if (event.eventName === 'FundCreated') {
            fund = event.args.fund;
            vault = event.args.vault;
            break;
          }
        } catch {
          /* not a factory event */
        }
      }
      if (!fund || !vault) throw new Error('Fund created, but the fund address was not in the receipt.');
      const fundTx = fundReceipt.transactionHash;
      setCreated({ fund, vault, fundTx });
      await queryClient.invalidateQueries({ queryKey: ['funds'] });

      // 2. Deploy the AgentExecutor. Needs the published bytecode.
      if (!executorBytecode || !walletClient) {
        setStage('waiting-executor');
        setCreated({ fund, vault, fundTx });
        toast.success('Fund created — agent setup is waiting on the executor contract', { id: tid });
        return;
      }
      setStage('executor');
      const executorHash = await walletClient.deployContract({
        abi: AgentExecutorABI,
        bytecode: executorBytecode,
        args: [
          vault as `0x${string}`,
          agentKey.trim() as `0x${string}`,
          {
            templateId: fullParams.templateId,
            riskLevel: fullParams.riskLevel,
            maxPositionBps: fullParams.maxPositionBps,
            maxTradeBps: fullParams.maxTradeBps,
            maxDeviationBps: fullParams.maxDeviationBps,
            dailyTradeLimit: fullParams.dailyTradeLimit,
            circuitBreakerBps: fullParams.circuitBreakerBps,
            rebalanceIntervalSeconds: fullParams.rebalanceIntervalSeconds,
            rulesHash: fullParams.rulesHash,
          },
          (registry ?? zeroAddress) as `0x${string}`,
        ],
        account,
        chain: robinhoodChain,
      });
      const executorReceipt = await waitReceipt(executorHash);
      const executor = executorReceipt.contractAddress;
      if (!executor) throw new Error('Executor deployed, but no contract address came back.');
      setCreated({ fund, vault, executor, fundTx });

      // 3. Register the agent (the registry is a directory, not a security boundary).
      let agentId: string | undefined;
      if (registry) {
        setStage('register');
        const strategyHash = keccak256(toHex(mandateText));
        const registerReceipt = await sendTx(tid, 'Registering the agent…', () =>
          writeContractAsync({
            address: registry,
            abi: AgentRegistryABI,
            functionName: 'registerAgent',
            chainId: robinhoodChain.id,
            args: [{
              fund: fund as `0x${string}`,
              vault: vault as `0x${string}`,
              executor: executor as `0x${string}`,
              creator: account as `0x${string}`,
              agentKey: agentKey.trim() as `0x${string}`,
              name: agentName.trim(),
              logoURI: agentLogo,
              description: agentDescription.trim(),
              templateId: fullParams.templateId,
              runnerMode,
              strategyHash,
              rulesHash: fullParams.rulesHash,
              createdAt: 0n,
              active: true,
            }],
          }),
        );
        for (const log of registerReceipt.logs) {
          try {
            const event = decodeEventLog({ abi: AgentRegistryABI, data: log.data, topics: log.topics });
            if (event.eventName === 'AgentRegistered') {
              agentId = event.args.agentId.toString();
              break;
            }
          } catch {
            /* not a registry event */
          }
        }
        setCreated({ fund, vault, executor, agentId, fundTx });
      }

      // 4. Let the executor trade for the vault.
      setStage('authorize');
      await sendTx(tid, 'Letting the agent trade for the vault…', () =>
        writeContractAsync({
          address: vault as `0x${string}`,
          abi: FundVaultInvestABI,
          functionName: 'setExecutor',
          chainId: robinhoodChain.id,
          args: [executor as `0x${string}`, true],
        }),
      );
      if (agentId && backtested) {
        try {
          localStorage.setItem(`polypad-agent-backtested:${agentId}`, '1');
        } catch {
          /* private mode — the badge just won't show on this browser */
        }
      }
      setCreated({ fund, vault, executor, agentId, fundTx });
      setStage('done');
      await queryClient.invalidateQueries({ queryKey: ['fund'] });
      toast.success('Agent fund created', {
        id: tid,
        action: { label: 'View fund', onClick: () => router.push(`/funds/${fund}`) },
      });
    } catch (error) {
      const message = error instanceof Error ? (error as Error & { shortMessage?: string }).shortMessage ?? error.message : 'Transaction failed';
      toast.error(fundTxError(message), { id: tid });
      setStage((current) => (current === 'done' ? current : 'idle'));
    } finally {
      setDeploying(false);
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Could not copy — select the text manually.');
    }
  };

  if (created && (stage === 'done' || stage === 'waiting-executor')) {
    return (
      <div className="mx-auto max-w-[700px] px-5 py-8 sm:py-12">
        <div className="glass-card space-y-4 rounded-xl p-4 sm:p-6">
          <h1 className="text-[18px] font-semibold">
            {stage === 'done' ? 'Agent fund created' : 'Fund created — agent setup paused'}
          </h1>
          {stage === 'waiting-executor' ? (
            <p className="text-[13px] leading-relaxed text-white/60">
              The fund exists, but the agent executor contract has not been published yet, so the agent cannot trade.
              Nothing is running and nothing is pretending to run. Once the executor bytecode is published, deploy it
              for this vault and register the agent — the fund and vault addresses below are what that step needs.
            </p>
          ) : (
            <p className="text-[13px] leading-relaxed text-white/60">
              {agentName.trim() || 'The agent'} is registered for this fund and allowed to trade within the limits you set.
              It never holds money — the vault does. You can pause it or remove it from the fund page at any time.
            </p>
          )}
          <dl className="space-y-2 text-[13px]">
            {created.fund && <AddressRow label="Fund NFT" address={created.fund} />}
            {created.vault && <AddressRow label="Vault" address={created.vault} />}
            {created.executor && <AddressRow label="Agent executor" address={created.executor} />}
            {created.agentId && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-white/50">Agent number</dt>
                <dd className="font-mono text-[12px]">#{created.agentId}</dd>
              </div>
            )}
            {!created.agentId && stage === 'done' && (
              <p className="text-[12px] text-yellow-200/90">The agent registry is not set up yet, so this agent is not listed in the directory. The executor is still allowed to trade.</p>
            )}
          </dl>

          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
            <h2 className="text-[14px] font-semibold">Runner setup</h2>
            {runnerMode === 1 ? (
              <p className="mt-2 text-[13px] leading-relaxed text-white/60">
                Hosted runner: waiting for the platform to start it. The agent will not trade until the platform
                starts the hosted runner for this fund. Nothing is running yet.
              </p>
            ) : (
              <>
                <p className="mt-2 text-[13px] leading-relaxed text-white/60">
                  Self-hosted runner: run the runner package on your own machine. The runner wallet signs the trades
                  and pays gas — keep a little ETH in it. It never holds fund money.
                </p>
                {created.executor && created.vault && created.fund && (
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-white/75">
                    {runnerEnvText({
                      executor: created.executor,
                      vault: created.vault,
                      fund: created.fund,
                      agentKey,
                      registry,
                    })}
                    {'\nAGENT_PRIVATE_KEY=  # paste the runner wallet key here — never share it'}
                  </pre>
                )}
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => created.executor && created.vault && created.fund && copyText(
                      `${runnerEnvText({ executor: created.executor, vault: created.vault, fund: created.fund, agentKey, registry })}\nAGENT_PRIVATE_KEY=`,
                      'Runner settings',
                    )}
                  >
                    <Copy className="h-3.5 w-3.5" /> Copy settings
                  </Button>
                </div>
                <pre className="mt-3 overflow-x-auto rounded-lg bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-white/75">
                  {RUNNER_COMMANDS.join('\n')}
                </pre>
              </>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            {created.fund && <Button onClick={() => router.push(`/funds/${created.fund}?mint=skin`)}>Mint your manager share</Button>}
            <Button variant="secondary" onClick={() => router.push(created.fund ? `/funds/${created.fund}` : '/funds')}>
              {created.fund ? 'View fund' : 'Back to funds'}
            </Button>
          </div>
          <a className="inline-block text-[12px] text-polydash-green" href={getExplorerTxUrl(created.fundTx)} target="_blank" rel="noopener noreferrer">
            View transaction
          </a>
          <FundNotice />
        </div>
      </div>
    );
  }

  const issueForStep = (field: string) =>
    reveal ? stepIssues.find((message) => message.toLowerCase().includes(field.toLowerCase())) : undefined;

  return (
    <div className="mx-auto max-w-[700px] space-y-5 px-5 py-8 sm:space-y-6 sm:py-12">
      <div className="space-y-2">
        <Link href="/funds" className="text-[12px] text-white/50 hover:text-white">Funds</Link>
        <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight sm:text-[28px]">
          <Bot className="h-6 w-6 text-polydash-green" /> Create an agent fund
        </h1>
        <p className="text-[13px] leading-relaxed text-white/60">
          An AI agent manages this fund within limits you set. The agent never holds money — the vault does — and you
          can pause it or remove it at any time. Five short steps: name the agent, pick its strategy, set its limits,
          set up the fund, then review. You sign the transactions at the end.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
        {STEPS.map((item, index) => (
          <div key={item.label} className="flex items-center gap-1.5 sm:gap-2">
            <div className={cn(
              'flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium sm:px-3 sm:py-1.5 sm:text-xs',
              index === step ? 'bg-primary/10 text-primary' : index < step ? 'bg-primary/5 text-primary/60' : 'bg-secondary text-muted-foreground',
            )}>
              {index < step ? <Check className="h-3 w-3" /> : <span className="font-mono">{index + 1}</span>}
              <span>{item.label}</span>
            </div>
            {index < STEPS.length - 1 && <div className="hidden h-px w-3 bg-border sm:block sm:w-6" />}
          </div>
        ))}
      </div>

      <div className="glass-card space-y-4 rounded-xl p-4 sm:p-6">
        {step === 0 && (
          <>
            <h2 className="text-[15px] font-semibold">Name the agent</h2>
            <Field label="Agent name" error={issueForStep('name')}>
              <Input value={agentName} onChange={(event) => setAgentName(event.target.value)} placeholder="Ada" className="bg-secondary/50" />
            </Field>
            <Field label="Logo, optional">
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(event) => handleLogoFile(event.target.files?.[0])} />
              <div className="flex items-center gap-3 rounded-lg border border-dashed border-white/15 bg-secondary/30 p-3">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/5">
                  {agentLogo ? <img src={agentLogo} alt="" className="h-full w-full object-cover" /> : uploading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : <Upload className="h-5 w-5 text-muted-foreground" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{agentLogo ? 'Logo added' : 'Add a logo'}</p>
                  <p className="text-[11px] text-muted-foreground">PNG, JPG, WEBP, or GIF, up to 5 MB. Or paste a link.</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button type="button" size="sm" variant="secondary" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                    {uploading ? 'Uploading…' : agentLogo ? 'Change' : 'Choose'}
                  </Button>
                  {agentLogo && !uploading && (
                    <button type="button" aria-label="Remove logo" onClick={() => setAgentLogo('')} className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-white/5 hover:text-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              <Input value={agentLogo} onChange={(event) => setAgentLogo(event.target.value)} placeholder="https://" className="mt-2 bg-secondary/50 font-mono text-[12px]" />
            </Field>
            <Field label="Short description" error={issueForStep('description')}>
              <textarea value={agentDescription} onChange={(event) => setAgentDescription(event.target.value)} placeholder="Buys the dips in WETH and holds through the noise." rows={3} className="w-full rounded-lg border border-white/10 bg-secondary/50 p-3 text-[13px] leading-relaxed text-white placeholder:text-white/30" />
            </Field>
            <p className="text-[12px] leading-relaxed text-white/55">
              Investors will see this name, logo and description on the fund page and the leaderboard.
            </p>
          </>
        )}

        {step === 1 && (
          <>
            <h2 className="text-[15px] font-semibold">Pick a strategy</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {STRATEGY_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => applyTemplate(template.id, riskLevel)}
                  className={cn(
                    'rounded-xl border p-3 text-left transition-colors',
                    templateId === template.id ? 'border-polydash-green bg-polydash-green/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/5',
                  )}
                >
                  <p className="text-[13px] font-semibold">{template.name} — {template.title}</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-white/60">{template.description}</p>
                </button>
              ))}
            </div>
            <div>
              <label className="mb-2 block text-xs text-muted-foreground">How careful should it be? {riskLabel(riskLevel)}</label>
              <Slider value={[riskLevel]} min={0} max={2} step={1} onValueChange={(value) => applyTemplate(templateId, value[0] ?? 1)} />
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                {RISK_LEVELS.map((level) => <span key={level.id}>{level.label}</span>)}
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-white/55">{RISK_LEVELS[riskLevel]?.description}</p>
            </div>
            <div className="rounded-lg bg-secondary/30 p-3 text-[12px] leading-relaxed text-white/70">
              <p>With {templateById(templateId).name} ({riskLabel(riskLevel).toLowerCase()}): largest holding {bpsLabel(params.maxPositionBps)}, largest trade {bpsLabel(params.maxTradeBps)}, up to {params.dailyTradeLimit} trades a day, auto-pause after a {bpsLabel(params.circuitBreakerBps)} drop. You can change every number on the next step.</p>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="text-[15px] font-semibold">Guardrails — the limits the agent cannot cross</h2>
            <p className="text-[12px] leading-relaxed text-white/55">
              These limits are written into the fund&apos;s rules and enforced on-chain. The agent cannot trade past
              them, move money to itself, or change them later.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Largest single holding (% of the fund)" error={issueForStep('largest single holding')}>
                <Input value={String(params.maxPositionBps / 100)} onChange={(event) => setParams((p) => ({ ...p, maxPositionBps: Math.round(Number(event.target.value.replace(/[^\d.]/g, '')) * 100) || 0 }))} inputMode="decimal" className="bg-secondary/50 font-mono" />
              </Field>
              <Field label="Largest single trade (% of the fund)" error={issueForStep('largest single trade')}>
                <Input value={String(params.maxTradeBps / 100)} onChange={(event) => setParams((p) => ({ ...p, maxTradeBps: Math.round(Number(event.target.value.replace(/[^\d.]/g, '')) * 100) || 0 }))} inputMode="decimal" className="bg-secondary/50 font-mono" />
              </Field>
              <Field label="Trades per day" error={issueForStep('trades per day')}>
                <Input value={String(params.dailyTradeLimit)} onChange={(event) => setParams((p) => ({ ...p, dailyTradeLimit: Number(event.target.value.replace(/[^\d]/g, '')) || 0 }))} inputMode="numeric" className="bg-secondary/50 font-mono" />
              </Field>
              <Field label="Auto-pause if value per share drops by (%)" error={issueForStep('auto-pause')}>
                <Input value={String(params.circuitBreakerBps / 100)} onChange={(event) => setParams((p) => ({ ...p, circuitBreakerBps: Math.round(Number(event.target.value.replace(/[^\d.]/g, '')) * 100) || 0 }))} inputMode="decimal" className="bg-secondary/50 font-mono" />
              </Field>
              <Field label="Wait between trades (hours)">
                <Input value={String(params.rebalanceIntervalSeconds / 3600)} onChange={(event) => setParams((p) => ({ ...p, rebalanceIntervalSeconds: Math.round(Number(event.target.value.replace(/[^\d.]/g, '')) * 3600) || 0 }))} inputMode="decimal" className="bg-secondary/50 font-mono" />
              </Field>
              <Field label="Runner wallet address (signs the trades)">
                <Input value={agentKey} onChange={(event) => setAgentKey(event.target.value)} placeholder="0x…" className="bg-secondary/50 font-mono text-[12px]" />
                <p className="mt-1 text-[11px] text-muted-foreground">The wallet the runner uses to sign trade instructions. It pays gas, so keep a little ETH in it. It never holds fund money.</p>
                {reveal && identityIssues.find((i) => i.field === 'agentKey') && <p className="mt-1 text-[12px] text-red-300">{identityIssues.find((i) => i.field === 'agentKey')?.message}</p>}
              </Field>
            </div>
            <Field label="Which assets may it buy? One address per line (optional — empty means WETH only)" error={reveal && !assets.ok ? assets.message : undefined}>
              <textarea value={assetsText} onChange={(event) => setAssetsText(event.target.value)} placeholder={'0x…\n0x…'} rows={3} className="w-full rounded-lg border border-white/10 bg-secondary/50 p-3 font-mono text-[12px] text-white placeholder:text-white/30" />
              <p className="mt-1 text-[11px] text-muted-foreground">Each asset must already be on the allowlist with a price feed. WETH is the quote and is not listed here.</p>
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setParams((p) => ({ ...strategyDefaults(templateId, riskLevel), rulesHash: p.rulesHash }))}>
                Reset to strategy defaults
              </Button>
              <Button variant="secondary" size="sm" onClick={runPaper}>Try it on paper first</Button>
            </div>
            {paperOn && paperResult && (
              <div className="rounded-lg bg-secondary/30 p-3 text-[12px] leading-relaxed text-white/70">
                <p className="font-semibold text-white">Paper run — no chain, no money <span className="ml-1 rounded-full bg-polydash-green/15 px-2 py-0.5 text-[10px] font-medium text-polydash-green">Backtested</span></p>
                <p className="mt-1">
                  Started with {paperResult.startValueEth.toFixed(2)} ETH, ended with {paperResult.endValueEth.toFixed(4)} ETH
                  ({formatChange(paperResult.changePct)}) over {paperResult.trades.length} paper trades.
                  Largest dip from the high point: {paperResult.maxDrawdownPct.toFixed(1)}%.
                </p>
                <p className="mt-1 text-white/50">This ran the same rules against past-style prices on your device. Past paper results do not promise future returns.</p>
                <p className="mt-1 font-mono text-[11px] text-white/50">{explainTrade(templateId, { side: 'buy', assetSymbol: 'the asset', priceChangePct: null })}</p>
              </div>
            )}
            {reveal && stepIssues.length > 0 && (
              <ul className="space-y-1 text-[12px] text-red-300">
                {stepIssues.map((message) => <li key={message}>{message}</li>)}
              </ul>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="text-[15px] font-semibold">Fund setup — the same as a human-managed fund</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Fund name">
                <Input value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} placeholder="Example Fund" className="bg-secondary/50" />
              </Field>
              <Field label="Ticker">
                <Input value={draft.symbol} onChange={(event) => updateDraft('symbol', event.target.value)} placeholder="EX" className="bg-secondary/50" />
              </Field>
              <Field label="Mint price (ETH)">
                <Input value={draft.mintPriceEth} onChange={(event) => updateDraft('mintPriceEth', event.target.value)} inputMode="decimal" className="bg-secondary/50 font-mono" />
              </Field>
              <Field label="Raise goal (ETH)">
                <Input value={draft.raiseCapEth} onChange={(event) => updateDraft('raiseCapEth', event.target.value)} inputMode="decimal" className="bg-secondary/50 font-mono" />
              </Field>
              <Field label="Raise length (days, 1–30)">
                <Input value={draft.raiseDurationDays} onChange={(event) => updateDraft('raiseDurationDays', event.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" className="bg-secondary/50 font-mono" />
              </Field>
              <Field label="Metadata link, optional">
                <Input value={draft.baseUri} onChange={(event) => updateDraft('baseUri', event.target.value)} placeholder="https://" className="bg-secondary/50 font-mono text-[12px]" />
              </Field>
            </div>
            <div>
              <label className="mb-2 block text-xs text-muted-foreground">Entry fee: {bpsLabel(draft.entryFeeBps)}</label>
              <Slider value={[draft.entryFeeBps]} min={0} max={500} step={50} onValueChange={(value) => updateDraft('entryFeeBps', value[0] ?? 0)} />
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>0%</span><span>5% maximum</span></div>
            </div>
            <div>
              <label className="mb-2 block text-xs text-muted-foreground">Manager share: {bpsLabel(draft.skinBps)}</label>
              <Slider value={[draft.skinBps]} min={500} max={10000} step={100} onValueChange={(value) => updateDraft('skinBps', value[0] ?? 500)} />
              <p className="mt-2 text-[12px] text-white/55">5% is the minimum. You mint this share yourself before anyone else can, at the same price.</p>
            </div>
            <Field label="Where can investors read the full rules? (ipfs:// or https://)" error={reveal ? fundCheck.issues.find((i) => i.field === 'mandateUri')?.message : undefined}>
              <Input value={mandateUri} onChange={(event) => setMandateUri(event.target.value)} placeholder="ipfs://…" className="bg-secondary/50 font-mono text-[12px]" />
              <p className="mt-1 text-[11px] text-muted-foreground">Publish the rules text below at this link. The vault saves the link next to the fingerprint of the text.</p>
            </Field>
            {reveal && stepIssues.length > 0 && (
              <ul className="space-y-1 text-[12px] text-red-300">
                {stepIssues.map((message) => <li key={message}>{message}</li>)}
              </ul>
            )}
          </>
        )}

        {step === 4 && fundCheck.params && (
          <>
            <h2 className="text-[15px] font-semibold">Review and create</h2>
            <dl className="space-y-1 text-sm">
              <ReviewRow label="Agent" value={agentName.trim() || '—'} />
              <ReviewRow label="Strategy" value={`${templateById(templateId).name} — ${riskLabel(riskLevel)}`} />
              <ReviewRow label="Fund" value={fundCheck.params.name} />
              <ReviewRow label="Ticker" value={fundCheck.params.symbol} />
              <ReviewRow label="Price per share" value={`${formatFundEth(fundCheck.params.mintPrice)} ETH`} />
              <ReviewRow label="Raise goal" value={`${formatFundEth(fundCheck.params.raiseCap)} ETH`} />
              <ReviewRow label="Shares" value={fundCheck.params.maxSupply.toString()} />
              <ReviewRow label="Entry fee" value={bpsLabel(Number(fundCheck.params.entryFeeBps))} />
              <ReviewRow label="Largest holding / trade" value={`${bpsLabel(params.maxPositionBps)} / ${bpsLabel(params.maxTradeBps)}`} />
              <ReviewRow label="Trades per day" value={String(params.dailyTradeLimit === 0 ? 5 : params.dailyTradeLimit)} />
              <ReviewRow label="Auto-pause drop" value={bpsLabel(params.circuitBreakerBps === 0 ? 1000 : params.circuitBreakerBps)} />
              <ReviewRow label="Assets" value={assetList.length ? `${assetList.length} asset(s)` : 'WETH only'} />
              <ReviewRow label="Runner wallet" value={agentKey.trim()} />
              <ReviewRow label="Fingerprint of the rules" value={`${mandateHash.slice(0, 10)}…${mandateHash.slice(-6)}`} />
              <ReviewRow label="Where to read the rules" value={mandateUri} />
            </dl>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">The rules, written out in plain language (the agent&apos;s constitution)</p>
                <Button variant="secondary" size="sm" onClick={() => copyText(mandateText, 'Rules text')}>
                  <Copy className="h-3.5 w-3.5" /> Copy rules
                </Button>
              </div>
              <pre className="whitespace-pre-wrap rounded-lg bg-secondary/30 p-3 text-[12px] leading-relaxed text-white/75">{mandateText}</pre>
            </div>
            <div>
              <p className="mb-2 text-xs text-muted-foreground">How will the agent run?</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button type="button" onClick={() => setRunnerMode(1)} className={cn('rounded-xl border p-3 text-left', runnerMode === 1 ? 'border-polydash-green bg-polydash-green/10' : 'border-white/10 bg-white/[0.03]')}>
                  <p className="text-[13px] font-semibold">Polypad-hosted</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-white/60">The platform runs the agent for you. It starts after the platform turns it on.</p>
                </button>
                <button type="button" onClick={() => setRunnerMode(0)} className={cn('rounded-xl border p-3 text-left', runnerMode === 0 ? 'border-polydash-green bg-polydash-green/10' : 'border-white/10 bg-white/[0.03]')}>
                  <p className="text-[13px] font-semibold">Self-hosted</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-white/60">You run the runner on your own machine with the settings shown after creation.</p>
                </button>
              </div>
            </div>
            {backtested && (
              <p className="text-[12px] text-polydash-green">Backtested on paper: {formatChange(backtested.changePct)} over {backtested.trades} paper trades. This result is recorded in the agent&apos;s rules.</p>
            )}
            <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3 text-[12px] leading-relaxed text-yellow-200">
              What happens next: you sign one transaction to create the fund, then further transactions to deploy the
              agent, register it, and let it trade for the vault. No ETH is sent to create the fund. Buying your
              manager shares is a second step on the fund page. After the raise closes and investing opens, the agent
              trades only within the rules above. Unaudited. Not financial advice.
            </div>
            {deploying && stage !== 'idle' && (
              <p className="text-[12px] text-white/60">
                {stage === 'fund' && 'Creating the fund…'}
                {stage === 'executor' && 'Deploying the agent…'}
                {stage === 'register' && 'Registering the agent…'}
                {stage === 'authorize' && 'Letting the agent trade for the vault…'}
              </p>
            )}
            {reveal && fundCheck.issues.length > 0 && (
              <ul className="space-y-1 text-[12px] text-red-300">
                {fundCheck.issues.map((issue) => <li key={issue.field}>{issue.message}</li>)}
              </ul>
            )}
          </>
        )}

        <div className="flex justify-between gap-3">
          {step === 0 ? (
            <Button variant="secondary" onClick={() => router.push('/funds/create')}>Back to choice</Button>
          ) : (
            <Button variant="secondary" onClick={goBack} className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
          )}
          {step < 4 ? (
            <Button onClick={goNext} disabled={uploading} className="gap-2">
              Next <ArrowRight className="h-4 w-4" />
            </Button>
          ) : !isConnected ? (
            <ConnectButton.Custom>
              {({ openConnectModal }) => <Button onClick={openConnectModal}>Connect wallet</Button>}
            </ConnectButton.Custom>
          ) : (
            <Button onClick={handleDeploy} disabled={deploying || !fundCheck.params} className="gap-2">
              {deploying && <Loader2 className="h-4 w-4 animate-spin" />}
              {deploying ? 'Creating…' : 'Create agent fund'}
            </Button>
          )}
        </div>
      </div>
      <FundNotice mode="invest" />
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      {children}
      {error && <span className="mt-1 block text-[12px] text-red-300">{error}</span>}
    </label>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/20 py-1.5 last:border-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="max-w-[60%] truncate text-right font-mono text-xs">{value}</dd>
    </div>
  );
}

function AddressRow({ label, address }: { label: string; address: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-white/50">{label}</dt>
      <dd>
        <a className="font-mono text-[12px] text-polydash-green" href={getExplorerAddressUrl(address)} target="_blank" rel="noopener noreferrer">
          {address.slice(0, 6)}…{address.slice(-4)}
        </a>
      </dd>
    </div>
  );
}
