'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { ArrowUpRight, Check, ChevronDown, Copy, CreditCard, Loader2, Smartphone, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  MOONPAY_API_KEY, MOONPAY_BUY_URL, MOONPAY_ETH_BASE, MOONPAY_USDG_ROBINHOOD, USDG_4663, WETH_4663,
  moonpayKeyIsPlaceholder, moonpayRedirectUrl, relayBridgeUrl, relayOnrampUrl, type MoonpayCode,
} from '@/lib/onramp';

export const TAP_PAY_LABEL = 'Buy ETH with Apple Pay or Google Pay';
export const RELAY_CARD_LABEL = 'Buy ETH on Robinhood Chain with a card (Relay)';

type After = { kind: 'bridge'; amount: string } | { kind: 'swap'; amount: string } | null;

/** Opens the embedded MoonPay overlay. Returns the follow-up step via onDone. */
function useMoonPay(wallet?: string) {
  const [opening, setOpening] = useState<MoonpayCode | null>(null);
  const [after, setAfter] = useState<After>(null);

  const open = async (currencyCode: MoonpayCode) => {
    setOpening(currencyCode);
    try {
      const { loadMoonPay } = await import('@moonpay/moonpay-js');
      const moonPay = await loadMoonPay();
      if (!moonPay) throw new Error('MoonPay did not load');
      const params: Record<string, string> = {
        apiKey: MOONPAY_API_KEY,
        currencyCode,
        baseCurrencyCode: 'usd',
        redirectURL: moonpayRedirectUrl(),
      };
      if (wallet) params.walletAddress = wallet;
      const widget = moonPay({
        flow: 'buy',
        environment: 'production',
        variant: 'overlay',
        params: params as any,
        handlers: {
          async onTransactionCompleted(props: any) {
            const amount = String(props?.quoteCurrencyAmount ?? '');
            setAfter(currencyCode === MOONPAY_ETH_BASE ? { kind: 'bridge', amount } : { kind: 'swap', amount });
          },
        },
      } as any);
      widget?.show();
    } catch (e) {
      console.error('MoonPay widget error', e);
      toast.error('Could not open MoonPay. Try the card option (Relay) instead.');
    } finally {
      setOpening(null);
    }
  };
  return { open, opening, after, setAfter };
}

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

function CopyAddr({ label, addr }: { label: string; addr: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.04] px-2.5 py-2">
      <div className="min-w-0">
        <p className="text-[11px] text-white/45">{label}</p>
        <p className="break-all font-mono text-[11.5px] text-white/85">{addr}</p>
      </div>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        onClick={() => { navigator?.clipboard?.writeText?.(addr); setDone(true); setTimeout(() => setDone(false), 1500); }}
        className="shrink-0 rounded-md p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
      >
        {done ? <Check className="h-3.5 w-3.5 text-polydash-green" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

/** Shown after a MoonPay purchase: bridge (ETH on Base) or swap (USDG on Robinhood Chain). */
function AfterPurchase({ after, wallet, onClose }: { after: NonNullable<After>; wallet?: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-white/10 bg-[#111] p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[16px] font-semibold">
            {after.kind === 'bridge' ? 'Your ETH is on Base — bridge it to Robinhood Chain to use it here' : 'Your USDG is on Robinhood Chain — swap it for ETH'}
          </h3>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-md p-1 text-white/50 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        {after.kind === 'bridge' ? (
          <>
            <ol className="list-decimal space-y-1.5 pl-5 text-[13px] text-white/70">
              <li>Open Relay. Your wallet{after.amount ? ` and the amount (${after.amount} ETH)` : ''} are filled in.</li>
              <li>Confirm the bridge from Base to Robinhood Chain in your wallet.</li>
              <li>When the ETH arrives, come back to this page and finish your purchase.</li>
            </ol>
            <ExtLink primary href={relayBridgeUrl(wallet, after.amount)} testId="bridge-after">Bridge ETH (Relay)</ExtLink>
          </>
        ) : (
          <>
            <p className="text-[13px] text-white/70">
              Buying here needs ETH, so swap your USDG{after.amount ? ` (${after.amount} USDG)` : ''} for ETH on Robinhood Chain first. Polypad does not have its own swap, so use a swap app on Robinhood Chain that you trust and check these exact token addresses:
            </p>
            <div className="space-y-2">
              <CopyAddr label="You sell: USDG (Global Dollar) on Robinhood Chain" addr={USDG_4663} />
              <CopyAddr label="You get: WETH (wrapped ETH) on Robinhood Chain" addr={WETH_4663} />
            </div>
            <p className="text-[12px] text-white/50">If the swap gives you WETH instead of ETH, unwrap it to ETH (most swap apps have an unwrap button). Then come back to this page and finish your purchase.</p>
          </>
        )}
        <button type="button" onClick={onClose} className="w-full rounded-xl border border-white/10 py-2.5 text-[13px] text-white/80 hover:bg-white/[0.06]">
          Back to this page
        </button>
      </div>
    </div>
  );
}

/** MoonPay UI renders only with a real pk_ key. With the placeholder key nothing MoonPay-related is shown. */
const MOONPAY_LIVE = !moonpayKeyIsPlaceholder();

function MoonPayButton({ code, label, sub, mp }: { code: MoonpayCode; label: string; sub: string; mp: ReturnType<typeof useMoonPay> }) {
  return (
    <button
      type="button"
      data-onramp={`moonpay-${code}`}
      onClick={() => mp.open(code)}
      disabled={!!mp.opening}
      className="flex w-full items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left hover:bg-white/[0.07] disabled:opacity-60"
    >
      {mp.opening === code ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-polydash-green" />}
      <span>
        <span className="block text-[13px] font-medium text-white/90">{label}</span>
        <span className="block text-[11.5px] text-white/50">{sub}</span>
      </span>
    </button>
  );
}

/** All ways to get ETH, used inside buy and mint flows. */
export function OnrampOptions({ className }: { className?: string }) {
  const { address } = useAccount();
  const mp = useMoonPay(address);
  return (
    <div className={cn('space-y-2.5', className)}>
      <p className="text-[12px] text-white/55">Get ETH on Robinhood Chain, then come back here to buy.</p>
      <ExtLink primary href={relayOnrampUrl(address)} testId="relay-onramp-eth">
        <span className="inline-flex items-center gap-2"><CreditCard className="h-4 w-4" />{RELAY_CARD_LABEL}</span>
      </ExtLink>
      <p className="-mt-1 text-[11px] text-white/40">Arrives as ETH on Robinhood Chain. No bridge or swap needed.</p>
      <ExtLink href={relayOnrampUrl(address, true)} testId="relay-onramp-usdg">Buy USDG on Robinhood Chain with a card (Relay)</ExtLink>

      {MOONPAY_LIVE && (
        <>
          <p className="pt-1 text-[11px] font-medium uppercase tracking-wide text-white/40">Apple Pay or Google Pay (MoonPay)</p>
          <MoonPayButton mp={mp} code={MOONPAY_ETH_BASE} label={TAP_PAY_LABEL} sub="You get ETH on Base, then bridge it here with Relay (we show you how)." />
          <MoonPayButton mp={mp} code={MOONPAY_USDG_ROBINHOOD} label="Buy USDG on Robinhood Chain with Apple Pay or Google Pay" sub="Arrives on Robinhood Chain, then you swap it for ETH. Not available in New York or Canada." />
        </>
      )}

      <p className="pt-1 text-[11px] font-medium uppercase tracking-wide text-white/40">Already have ETH on Base?</p>
      <div className={cn('grid gap-2', MOONPAY_LIVE && 'sm:grid-cols-2')}>
        {MOONPAY_LIVE && <ExtLink href={MOONPAY_BUY_URL} testId="moonpay-link">Buy USDG on Robinhood Chain (MoonPay)</ExtLink>}
        <ExtLink href={relayBridgeUrl(address)} testId="relay-bridge">Bridge ETH (Relay)</ExtLink>
      </div>
      {MOONPAY_LIVE && mp.after && <AfterPurchase after={mp.after} wallet={address} onClose={() => mp.setAfter(null)} />}
    </div>
  );
}

/** Collapsed "Need ETH?" toggle for trade/mint panels. Does not touch the panel's own buy logic. */
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
        <span><span className="font-medium text-white/90">Need ETH?</span> <span className="text-white/55">{MOONPAY_LIVE ? 'Buy with a card, Apple Pay or Google Pay' : 'Buy with a card'}</span></span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-white/50 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <OnrampOptions className="border-t border-white/10 px-3 pb-3 pt-3" />}
    </div>
  );
}

/** Main "Buy ETH" action for Tokenized Fund, stake and portfolio pages: the Relay card on-ramp. MoonPay is added only when live. */
export function BuyEthButton({ className }: { className?: string; showRelay?: boolean }) {
  const { address } = useAccount();
  const mp = useMoonPay(address);
  return (
    <div className={cn('flex flex-col items-start gap-1.5', className)}>
      <div className="flex flex-wrap items-center gap-2">
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
        {MOONPAY_LIVE && (
          <button
            type="button"
            data-onramp="buy-eth"
            onClick={() => mp.open(MOONPAY_ETH_BASE)}
            disabled={!!mp.opening}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-[13px] font-medium text-white/85 hover:bg-white/[0.06] disabled:opacity-60"
          >
            {mp.opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
            {TAP_PAY_LABEL}
          </button>
        )}
      </div>
      {MOONPAY_LIVE && mp.after && <AfterPurchase after={mp.after} wallet={address} onClose={() => mp.setAfter(null)} />}
    </div>
  );
}

/** Standalone Relay bridge link, no amount. */
export function BridgeEthLink({ className }: { className?: string }) {
  const { address } = useAccount();
  return (
    <a href={relayBridgeUrl(address)} target="_blank" rel="noopener noreferrer" data-onramp="relay-bridge"
      className={cn('inline-flex items-center gap-1.5 rounded-full border border-white/15 px-4 py-2 text-[13px] font-medium text-white/85 hover:bg-white/[0.06]', className)}>
      Bridge ETH (Relay) <ArrowUpRight className="h-3.5 w-3.5" />
    </a>
  );
}
