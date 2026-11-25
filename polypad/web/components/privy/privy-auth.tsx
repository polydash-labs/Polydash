// Email / social sign-in + the embedded wallet, via Privy.
//
// Every export here renders nothing until Privy is configured
// (NEXT_PUBLIC_PRIVY_APP_ID set): the outer components check `privyEnabled`
// before mounting anything that calls a Privy hook, so with no app ID the
// site behaves exactly as before and no Privy code runs.

'use client';

import { useEffect, useMemo, useRef } from 'react';
import { usePrivy, useWallets, type ConnectedWallet } from '@privy-io/react-auth';
import type { EIP1193Provider } from 'viem';
import { useAccount, useConnect, useDisconnect, type Connector } from 'wagmi';
import { privyEnabled } from '@/lib/privy-config';
import { setPrivyProvider } from '@/lib/privy/privy-connector';
import { cn } from '@/lib/utils';

function usePrivyEmail(): string | null {
  const { user } = usePrivy();
  return user?.email?.address ?? user?.google?.email ?? user?.apple?.email ?? null;
}

/** Connect the logged-in user's embedded wallet to wagmi (the mint/trade/sign flows). */
async function connectEmbeddedWallet(
  embedded: ConnectedWallet,
  connectAsync: ReturnType<typeof useConnect>['connectAsync'],
  connectors: readonly Connector[],
) {
  const provider = await embedded.getEthereumProvider();
  // Privy ships its own looser EIP-1193 type (request returns Promise<any>,
  // handlers are a union); at runtime the embedded provider is a full
  // EventEmitter-based EIP-1193 provider with on/removeListener/request,
  // so the cast to viem's typed provider is safe.
  setPrivyProvider(provider as unknown as EIP1193Provider);
  const target = connectors.find((c) => c.id === 'privy-embedded');
  if (!target) return;
  await connectAsync({ connector: target });
}

/**
 * Keeps wagmi in sync with the Privy session: after an email login, the
 * embedded wallet becomes the connected wallet, so the mint, trade and
 * pay flows just work. Never steals a connection: if the person is already
 * using another wallet, or disconnected on purpose, it leaves wagmi alone.
 */
function PrivyWagmiBridgeInner() {
  const { authenticated, ready } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { isConnected, connector } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const bridgedFor = useRef<string | null>(null);

  const embedded = useMemo(
    () => wallets.find((w) => w.walletClientType === 'privy') ?? null,
    [wallets],
  );

  useEffect(() => {
    if (!ready || !walletsReady) return;
    if (!authenticated) {
      if (isConnected && connector?.id === 'privy-embedded') {
        bridgedFor.current = null;
        setPrivyProvider(null);
        void disconnectAsync();
      }
      return;
    }
    if (!embedded || bridgedFor.current === embedded.address || isConnected) return;
    let cancelled = false;
    (async () => {
      try {
        await connectEmbeddedWallet(embedded, connectAsync, connectors);
        if (!cancelled) bridgedFor.current = embedded.address;
      } catch {
        // Do not retry in a loop — the person can still use the normal wallet dialog.
        bridgedFor.current = embedded.address;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, walletsReady, authenticated, embedded, isConnected, connector, connectors, connectAsync, disconnectAsync]);

  return null;
}

export function PrivyWagmiBridge() {
  if (!privyEnabled) return null;
  return <PrivyWagmiBridgeInner />;
}

/** Plain-words trust note, shown wherever email sign-in is offered. */
export function PrivyKeyNote({ className }: { className?: string }) {
  if (!privyEnabled) return null;
  return (
    <p className={cn('text-[12px] leading-relaxed text-white/50', className)}>
      Your wallet is made for you when you sign in — locked to your email, and only you can open it.
      Polypad never sees your key.
    </p>
  );
}

function EmailSignInButtonInner({ className }: { className?: string }) {
  const { login, authenticated, ready } = usePrivy();
  const { isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { wallets } = useWallets();
  const embedded = useMemo(
    () => wallets.find((w) => w.walletClientType === 'privy') ?? null,
    [wallets],
  );

  if (!ready) return null;
  if (!authenticated) {
    return (
      <button
        type="button"
        onClick={() => void login()}
        className={cn(
          'inline-flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-white/15 bg-white/[0.04] px-3.5 text-[13px] font-medium text-white hover:bg-white/10',
          className,
        )}
      >
        Continue with email
      </button>
    );
  }
  // Signed in but the wallet is not connected (e.g. disconnected on purpose):
  // offer to connect it. When connected, the header's wallet button already
  // shows the address, so this button hides.
  if (!isConnected && embedded) {
    return (
      <button
        type="button"
        onClick={() => void connectEmbeddedWallet(embedded, connectAsync, connectors)}
        className={cn(
          'inline-flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-white/15 bg-white/[0.04] px-3.5 text-[13px] font-medium text-white hover:bg-white/10',
          className,
        )}
      >
        Connect your wallet
      </button>
    );
  }
  return null;
}

/** Header sign-in: "Continue with email" when signed out, nothing once connected. */
export function EmailSignInButton({ className }: { className?: string }) {
  if (!privyEnabled) return null;
  return <EmailSignInButtonInner className={className} />;
}

function PrivySignInRowInner({ className }: { className?: string }) {
  const { login, logout, authenticated, ready } = usePrivy();
  const { isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { wallets } = useWallets();
  const email = usePrivyEmail();
  const embedded = useMemo(
    () => wallets.find((w) => w.walletClientType === 'privy') ?? null,
    [wallets],
  );

  if (!ready) return null;
  if (!authenticated) {
    return (
      <div className={cn('space-y-2', className)}>
        <p className="text-[13px] leading-relaxed text-white/60">
          No wallet yet? Continue with email — we&rsquo;ll make you a wallet.
        </p>
        <button
          type="button"
          onClick={() => void login()}
          className="inline-flex h-11 w-full items-center justify-center rounded-full border border-white/15 bg-white/[0.04] px-4 text-[13px] font-medium text-white hover:bg-white/10"
        >
          Continue with email
        </button>
        <PrivyKeyNote />
      </div>
    );
  }
  return (
    <div className={cn('space-y-2', className)}>
      <p className="text-[13px] leading-relaxed text-white/60">
        Signed in as {email ?? 'your email'}{' '}
        <button type="button" onClick={() => void logout()} className="font-medium text-white/85 underline hover:text-white">
          Sign out
        </button>
      </p>
      {!isConnected && embedded && (
        <button
          type="button"
          onClick={() => void connectEmbeddedWallet(embedded, connectAsync, connectors)}
          className="inline-flex h-11 w-full items-center justify-center rounded-full border border-white/15 bg-white/[0.04] px-4 text-[13px] font-medium text-white hover:bg-white/10"
        >
          Connect your wallet
        </button>
      )}
      <PrivyKeyNote />
    </div>
  );
}

/** Email sign-in row for buy/mint panels, with the trust note and sign-out. */
export function PrivySignInRow({ className }: { className?: string }) {
  if (!privyEnabled) return null;
  return <PrivySignInRowInner className={className} />;
}
