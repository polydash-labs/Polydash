'use client';

import { useState } from 'react';
import { useAccount, useBalance } from 'wagmi';
import { formatEther } from 'viem';
import { ArrowUpRight, ChevronDown, CreditCard, RefreshCw } from 'lucide-react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { cn } from '@/lib/utils';
import { relayBridgeUrl, relayOnrampUrl } from '@/lib/onramp';
import { robinhoodChain } from '@/lib/chain';

export const RELAY_CARD_LABEL = 'Buy ETH on Robinhood Chain with a card (Relay)';

function ExtLink({ href, children, primary, testId }: { href: string; children: React.ReactNode; primary?: boolean; testId?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-onramp={testId}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition-colors',
        primary ? 'bg-polydash-green text-black hover:bg-polydash-green/90' : 'border border-white/10 bg-white/[0.03] text-white/85 hover:bg-white/[0.07]',
      )}
    >
      <span>{children}</span>
      <ArrowUpRight className="h-4 w-4 shrink-0" />
    </a>
  );
}

/** Shown when no wallet is connected: a Relay link needs a destination address, so connect first. */
function ConnectFirst({ compact = false }: { compact?: boolean }) {
  return (
    <div className="space-y-1.5">
      <ConnectButton.Custom>
        {({ openConnectModal }) => (
          <button
            type="button"
            onClick={openConnectModal}
            className="inline-flex items-center gap-2 rounded-full bg-polydash-green px-4 py-2 text-[13px] font-semibold text-black hover:bg-polydash-green/90"
          >
            Step 1: Connect a wallet
          </button>
        )}
      </ConnectButton.Custom>
      {!compact && <p className="text-[12px] text-white/50">Connect a wallet first — Relay needs your wallet address to know where to send the ETH.</p>}
    </div>
  );
}

/** All ways to get ETH, used inside buy and mint flows. Relay is the only buy-ETH path. */
export function OnrampOptions({ className }: { className?: string }) {
  const { address } = useAccount();
  if (!address) {
    return (
      <div className={cn('space-y-2.5', className)}>
        <p className="text-[12px] text-white/55">Get ETH on Robinhood Chain, then come back here to buy.</p>
        <ConnectFirst compact />
        <p className="text-[12px] text-white/50">Relay needs your wallet address to know where to send the ETH.</p>
      </div>
    );
  }
  return (
    <div className={cn('space-y-2.5', className)}>
      <p className="text-[12px] text-white/55">Get ETH on Robinhood Chain, then come back here to buy.</p>
      <ExtLink primary href={relayOnrampUrl(address)} testId="relay-onramp-eth">
        <span className="inline-flex items-center gap-2"><CreditCard className="h-4 w-4" />{RELAY_CARD_LABEL}</span>
      </ExtLink>
      <p className="-mt-1 text-[11px] text-white/40">Arrives as ETH on Robinhood Chain. No bridge or swap needed.</p>

      <p className="pt-1 text-[11px] font-medium uppercase tracking-wide text-white/40">Already have ETH on Base?</p>
      <ExtLink href={relayBridgeUrl(address)} testId="relay-bridge">Bridge ETH (Relay)</ExtLink>
    </div>
  );
}

/** Collapsed "Step 0: need ETH?" toggle for trade/mint panels. Does not touch the panel's own buy logic. */
export function OnrampInline({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn('rounded-xl border border-white/10 bg-white/[0.02]', className)}>
      <button
        type="button"
        data-onramp="toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-[13px]"
      >
        <span><span className="font-medium text-white/90">Step 0: need ETH?</span> <span className="text-white/55">Buy with a card</span></span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-white/50 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <OnrampOptions className="border-t border-white/10 px-3 pb-3 pt-3" />}
    </div>
  );
}

/**
 * Main "Buy ETH" action for Tokenized Fund, stake and portfolio pages: the Relay card on-ramp.
 * Never renders a Relay link without a connected wallet — there would be nowhere to send the ETH.
 */
export function BuyEthButton({ className }: { className?: string }) {
  const { address } = useAccount();
  if (!address) {
    return (
      <div className={cn('flex flex-col items-start gap-1.5', className)}>
        <ConnectFirst />
      </div>
    );
  }
  return (
    <div className={cn('flex flex-col items-start gap-1.5', className)}>
      <a
        href={relayOnrampUrl(address)}
        target="_blank"
        rel="noopener noreferrer"
        data-onramp="relay-onramp-eth"
        className="inline-flex items-center gap-2 rounded-full bg-polydash-green px-4 py-2 text-[13px] font-semibold text-black hover:bg-polydash-green/90"
      >
        <CreditCard className="h-4 w-4" />
        {RELAY_CARD_LABEL}
        <ArrowUpRight className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

/** Standalone Relay bridge link, no amount. Needs a connected wallet for the destination address. */
export function BridgeEthLink({ className }: { className?: string }) {
  const { address } = useAccount();
  if (!address) {
    return <span className={cn('text-[13px] text-white/50', className)}>Connect a wallet to bridge ETH</span>;
  }
  return (
    <a href={relayBridgeUrl(address)} target="_blank" rel="noopener noreferrer" data-onramp="relay-bridge"
      className={cn('inline-flex items-center gap-1.5 rounded-full border border-white/15 px-4 py-2 text-[13px] font-medium text-white/85 hover:bg-white/[0.06]', className)}>
      Bridge ETH (Relay) <ArrowUpRight className="h-3.5 w-3.5" />
    </a>
  );
}

/**
 * In-flow card on-ramp: shown inside a buy/mint panel when the connected
 * wallet is short of the ETH the purchase needs. It opens Relay's card
 * on-ramp prefilled with the wallet address, and refreshes the balance when
 * the user comes back — so the buy button unblocks without a page reload.
 *
 * Honest limits, stated in the panel: Relay's card form lives on Relay's own
 * page (its payment form cannot live inside this panel), and Relay's fee
 * depends on the card and country, so the exact fee is shown by Relay before
 * the user pays — this card says so instead of inventing a number.
 */
export function RelayBuyCard({ totalNeededWei, className }: { totalNeededWei: bigint; className?: string }) {
  const { address } = useAccount();
  const { data: ethBalance, refetch } = useBalance({ address, chainId: robinhoodChain.id, query: { enabled: !!address } });
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  if (!address || !ethBalance || totalNeededWei <= 0n) return null;
  const shortfall = ethBalance.value < totalNeededWei ? totalNeededWei - ethBalance.value : 0n;
  if (shortfall <= 0n && !checkedAt) return null;

  async function checkBalance() {
    setChecking(true);
    try {
      await refetch();
      setCheckedAt(new Date().toLocaleTimeString());
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className={cn('space-y-2.5 rounded-xl border border-polydash-green/30 bg-polydash-green/[0.06] p-3', className)}>
      {shortfall > 0n ? (
        <p className="text-[13px] leading-relaxed text-white/85">
          You need <span className="font-medium text-white">{Number(formatEther(shortfall)).toFixed(4)} more ETH</span> to buy this.
        </p>
      ) : (
        <p className="text-[13px] leading-relaxed text-white/85">
          Your balance covers it now — go ahead and buy.
        </p>
      )}
      {shortfall > 0n && (
        <>
          <ExtLink primary href={relayOnrampUrl(address)} testId="relay-onramp-eth">
            <span className="inline-flex items-center gap-2"><CreditCard className="h-4 w-4" />Buy {Number(formatEther(shortfall)).toFixed(4)} ETH with a card (Relay)</span>
          </ExtLink>
          <p className="text-[11px] leading-relaxed text-white/50">
            Relay shows the exact fee before you pay — it depends on your card and country. The ETH lands
            straight in this wallet on Robinhood Chain.
          </p>
          <ExtLink href={relayBridgeUrl(address)} testId="relay-bridge">Already have ETH on Base? Bridge it (Relay)</ExtLink>
        </>
      )}
      <button
        type="button"
        onClick={() => void checkBalance()}
        disabled={checking}
        className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-[12px] font-medium text-white/85 hover:bg-white/[0.06] disabled:opacity-60"
      >
        <RefreshCw className={cn('h-3.5 w-3.5', checking && 'animate-spin')} />
        {checking ? 'Checking your balance…' : "I've paid — check my balance"}
      </button>
      {checkedAt && (
        <p className="text-[12px] text-white/55">
          Balance now: {Number(formatEther(ethBalance.value)).toFixed(4)} ETH · checked {checkedAt}
        </p>
      )}
    </div>
  );
}
