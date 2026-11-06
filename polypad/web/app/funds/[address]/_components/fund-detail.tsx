'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { toast } from 'sonner';
import { TokenAvatar } from '@/components/token-avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { getExplorerAddressUrl, getExplorerTxUrl } from '@/lib/contracts/addresses';
import { FundNFTABI } from '@/lib/contracts/fund-abi';
import { robinhoodChain } from '@/lib/chain';
import {
  FUND_STATUS_LABEL,
  bpsLabel,
  formatFundEth,
  fundTxError,
  quoteMint,
  ratioPercent,
} from '@/lib/fund/model';
import { useFund } from '@/lib/fund/use-funds';
import { shortenAddress } from '@/lib/format';
import { cn } from '@/lib/utils';
import { FundNotice } from '../../_components/fund-notice';
import { FundTerminal } from './fund-terminal';
import { ManagerDesk } from './manager-desk';

export function FundDetail({ address, focusMint }: { address: string; focusMint?: boolean }) {
  const { address: account, isConnected, chainId } = useAccount();
  const { data: fund, isLoading, isError } = useFund(address, account);
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: robinhoodChain.id });
  const queryClient = useQueryClient();
  const [qtyText, setQtyText] = useState('1');
  const [seeded, setSeeded] = useState(false);
  const [minting, setMinting] = useState(false);

  const isManager = !!fund && !!account && fund.manager.toLowerCase() === account.toLowerCase();
  const remaining = fund ? (fund.maxSupply > fund.totalMinted ? fund.maxSupply - fund.totalMinted : 0n) : 0n;
  const skinLeft = fund && fund.skinRequired > fund.managerMinted ? fund.skinRequired - fund.managerMinted : 0n;

  useEffect(() => {
    if (!fund || seeded) return;
    const next = isManager && !fund.publicOpen && skinLeft > 0n ? skinLeft : 1n;
    const capped = next > remaining && remaining > 0n ? remaining : next;
    setQtyText(capped > 0n ? capped.toString() : '1');
    setSeeded(true);
  }, [fund, seeded, isManager, skinLeft, remaining]);

  useEffect(() => {
    if (!focusMint) return;
    document.getElementById('mint')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusMint, fund]);

  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return <Missing title="That is not a fund address" />;
  }
  if (isLoading) {
    return (
      <div className="mx-auto flex max-w-container items-center justify-center gap-2 px-5 py-20 text-[13px] text-white/50">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading fund from Robinhood Chain
      </div>
    );
  }
  if (isError) return <Missing title="Could not read this fund" />;
  if (!fund) return <Missing title="This address is not a fund from the factory" />;

  const progress = ratioPercent(fund.raised, fund.raiseCap);
  const dust = fund.mintPrice > 0n ? fund.raiseCap % fund.mintPrice : 0n;
  const effective = fund.maxSupply * fund.mintPrice;
  const qty = /^\d+$/.test(qtyText.trim()) ? BigInt(qtyText.trim()) : 0n;
  const qtyError = qty < 1n
    ? 'Enter at least 1 NFT.'
    : qty > remaining
      ? `Only ${remaining.toString()} NFTs are left.`
      : undefined;
  const quote = qty > 0n ? quoteMint(fund.mintPrice, qty, BigInt(fund.entryFeeBps)) : null;
  const closed = fund.status === 'closed' || remaining === 0n;
  const blocked = fund.status === 'waiting' && !isManager;
  const shareBps = fund.totalMinted === 0n || fund.balance === 0n ? 0n : (fund.balance * 10_000n) / fund.totalMinted;

  const handleMint = async () => {
    if (!publicClient || !quote || qtyError) {
      toast.error(qtyError ?? 'Enter a quantity.');
      return;
    }
    setMinting(true);
    const tid = toast.loading('Confirm the mint in your wallet…');
    try {
      if (chainId !== robinhoodChain.id) await switchChainAsync({ chainId: robinhoodChain.id });
      const hash = await writeContractAsync({
        address: fund.address,
        abi: FundNFTABI,
        functionName: 'mint',
        chainId: robinhoodChain.id,
        value: quote.cost,
        args: [qty],
      });
      toast.loading('Minting on Robinhood Chain…', { id: tid });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Transaction reverted');
      await queryClient.invalidateQueries({ queryKey: ['fund'] });
      await queryClient.invalidateQueries({ queryKey: ['funds'] });
      toast.success('Minted', {
        id: tid,
        action: { label: 'View tx', onClick: () => window.open(getExplorerTxUrl(hash), '_blank') },
      });
    } catch (error) {
      const message = error instanceof Error ? (error as Error & { shortMessage?: string }).shortMessage ?? error.message : 'Transaction failed';
      toast.error(fundTxError(message), { id: tid });
    } finally {
      setMinting(false);
    }
  };

  return (
    <div className="mx-auto max-w-container space-y-5 px-5 py-6 sm:px-8 sm:py-10">
      <Link href="/funds" className="inline-flex items-center gap-1.5 text-[13px] text-white/50 hover:text-white">
        <ArrowLeft className="h-3.5 w-3.5" /> Funds
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <TokenAvatar name={fund.name} symbol={fund.symbol} imageUri={fund.imageUri} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[22px] font-semibold tracking-tight sm:text-[28px]">{fund.name}</h1>
              <span className="font-mono text-[13px] text-white/45">{fund.symbol}</span>
              <span className={cn(
                'rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                fund.status === 'open' ? 'bg-polydash-green/15 text-polydash-green' : fund.status === 'waiting' ? 'bg-yellow-400/10 text-yellow-200' : fund.status === 'investing' ? 'bg-sky-400/10 text-sky-100' : 'bg-white/10 text-white/60',
              )}>
                {FUND_STATUS_LABEL[fund.status]}
              </span>
            </div>
            <p className="mt-1 text-[12px] text-white/50">
              Manager{' '}
              <a className="font-mono text-polydash-green" href={getExplorerAddressUrl(fund.manager)} target="_blank" rel="noopener noreferrer">
                {shortenAddress(fund.manager)}
              </a>
            </p>
          </div>
        </div>
      </div>

      <p className="max-w-2xl text-[13px] leading-relaxed text-white/60">
        Each NFT is one equal unit. {fund.invest
          ? 'Swaps stay in the vault and use the allowlist. NAV uses the feed and is blank when that feed cannot be used.'
          : 'It is the ownership claim on the ETH held in the vault. This page covers the raise and the mint.'}
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Raised" value={`${formatFundEth(fund.raised)} ETH`} hint={`of ${formatFundEth(fund.raiseCap)} ETH`} />
        <Stat label="Minted" value={`${fund.totalMinted.toString()} / ${fund.maxSupply.toString()}`} hint="NFTs" />
        <Stat label="Mint price" value={`${formatFundEth(fund.mintPrice)} ETH`} hint={`Entry fee ${bpsLabel(fund.entryFeeBps)}`} />
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <div className="mb-2 flex items-center justify-between text-[12px] text-white/55">
          <span>Raise progress</span>
          <span className="font-mono">{progress.toFixed(progress >= 10 ? 1 : 2)}%</span>
        </div>
        <Progress value={progress} className="h-2 bg-white/10" />
        {dust > 0n && (
          <p className="mt-3 text-[12px] leading-relaxed text-white/50">
            The goal does not divide into whole NFTs. At most {formatFundEth(effective)} ETH can be collected across {fund.maxSupply.toString()} NFTs. {formatFundEth(dust)} ETH of the goal cannot mint another NFT.
          </p>
        )}
      </div>

      <section id="mint" className="scroll-mt-20 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <h2 className="text-[15px] font-semibold">Mint</h2>
        {fund.status === 'waiting' && (
          <p className="mt-2 text-[13px] leading-relaxed text-white/60">
            The manager has minted {fund.managerMinted.toString()} of {fund.skinRequired.toString()} NFTs required before other wallets can mint.
            {isManager ? ' That ETH goes into the vault, at the same price as later mints.' : ' Minting opens after that share is minted.'}
          </p>
        )}
        {fund.status === 'open' && (
          <p className="mt-2 text-[13px] leading-relaxed text-white/60">
            Open for minting. You pay the mint price in ETH. The protocol fee is 0.2% of that payment{fund.entryFeeBps > 0 ? `, and the entry fee is ${bpsLabel(fund.entryFeeBps)}` : ''}. The rest stays in the vault.
          </p>
        )}
        {closed && <p className="mt-2 text-[13px] text-white/60">Minting is closed. The raise reached its supply or its recorded cap.</p>}
        {blocked && !closed && <p className="mt-2 text-[13px] text-yellow-200/90">Waiting on the manager share. Other wallets cannot mint yet.</p>}

        {!closed && !blocked && (
          <div className="mt-4 space-y-3">
            <label className="block text-xs text-muted-foreground">
              How many NFTs
              <Input value={qtyText} onChange={(event) => setQtyText(event.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" className="mt-1 max-w-[160px] bg-secondary/50 font-mono" />
            </label>
            {qtyError && qtyText !== '' && <p className="text-[12px] text-red-300">{qtyError}</p>}
            {quote && !qtyError && (
              <div className="space-y-1 text-[12px] text-white/60">
                <p>You pay {formatFundEth(quote.cost)} ETH.</p>
                <p>Protocol fee (0.2%): {formatFundEth(quote.protocolFee)} ETH.</p>
                {fund.entryFeeBps > 0 && <p>Entry fee ({bpsLabel(fund.entryFeeBps)}): {formatFundEth(quote.entryFee)} ETH.</p>}
                <p>Stays in the vault: {formatFundEth(quote.staysInVault)} ETH.</p>
                <p>
                  A failed raise, where that path exists, can return {formatFundEth(quote.failedRaiseRefund)} ETH of this payment.
                  The protocol fee and the entry fee are not returned. This is not a refund of the full mint price.
                </p>
              </div>
            )}
            {!isConnected ? (
              <ConnectButton.Custom>
                {({ openConnectModal }) => <Button onClick={openConnectModal}>Connect wallet</Button>}
              </ConnectButton.Custom>
            ) : (
              <Button onClick={handleMint} disabled={minting || !!qtyError} className="gap-2">
                {minting && <Loader2 className="h-4 w-4 animate-spin" />}
                {isManager && fund.status === 'waiting' ? 'Mint your manager share' : 'Mint NFTs'}
              </Button>
            )}
            {isConnected && chainId !== robinhoodChain.id && (
              <p className="text-[12px] text-white/45">Your wallet will be asked to switch to Robinhood Chain.</p>
            )}
          </div>
        )}

        {isConnected && (
          <p className="mt-4 text-[12px] text-white/50">
            You hold {fund.balance.toString()} of these NFTs.
            {shareBps > 0n ? ` That is ${bpsLabel(Number(shareBps))} of the NFTs minted so far.` : ''}
          </p>
        )}
      </section>

      <FundTerminal
        status={fund.status}
        navPerNft={fund.navPerNft}
        totalMinted={fund.totalMinted}
        vaultEth={fund.vaultEth}
        publicOpen={fund.publicOpen}
        invest={fund.invest}
      />
      <ManagerDesk vault={fund.vault} status={fund.status} isManager={isManager} invest={fund.invest} />

      <div className="space-y-1 text-[12px] text-white/50">
        <p>
          Fund NFT{' '}
          <a className="font-mono text-polydash-green" href={getExplorerAddressUrl(fund.address)} target="_blank" rel="noopener noreferrer">{fund.address}</a>
        </p>
        <p>
          Vault{' '}
          <a className="font-mono text-polydash-green" href={getExplorerAddressUrl(fund.vault)} target="_blank" rel="noopener noreferrer">{fund.vault}</a>
        </p>
      </div>
      <FundNotice mode={fund.invest ? 'invest' : 'raise'} />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-[12px] text-white/45">{label}</p>
      <p className="mt-1 font-mono text-[16px] text-white">{value}</p>
      <p className="mt-1 text-[11px] text-white/40">{hint}</p>
    </div>
  );
}

function Missing({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-container px-5 py-20 text-center">
      <p className="text-white/70">{title}</p>
      <Link href="/funds" className="mt-3 inline-block text-[13px] text-polydash-green">Back to funds</Link>
    </div>
  );
}
