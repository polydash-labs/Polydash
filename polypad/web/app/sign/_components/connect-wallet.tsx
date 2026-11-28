'use client';

import { useMemo, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useSignMessage } from 'wagmi';
import { WALLET_TOKEN_TTL_SECONDS, bindingMessage, buildWalletToken } from '@/lib/agents-api/v2/wallet-token-shared';
import { validReturnUrlParam } from '../_lib/link';

const card = 'rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5';
const primary = 'w-full rounded-full bg-white px-5 py-3 text-[15px] font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40';
const secondary = 'w-full rounded-full border border-white/20 px-5 py-3 text-[14px] font-medium text-white transition hover:bg-white/10 disabled:opacity-40';

function short(a: string) {
  return a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;
}

function expiryLabel(exp: number): string {
  return new Date(exp * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Connect-on-/sign: bind a wallet to the agent API once, with a signature, and get a token the
 * agent stores. No transaction, no funds move — the signature only proves the wallet is yours.
 * The token lasts 90 days; after that, connect again. It cannot be revoked from the server, so
 * treat it like a password for this one wallet: keep it in the agent's own storage, never in chat.
 */
export function ConnectWallet({ search }: { search: URLSearchParams }) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync, isPending: signing } = useSignMessage();
  const returnUrl = useMemo(() => validReturnUrlParam(search.get('r')), [search]);

  const [token, setToken] = useState<string | null>(null);
  const [exp, setExp] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const sign = async () => {
    if (!address) return;
    setError(null);
    const expires = Math.floor(Date.now() / 1000) + WALLET_TOKEN_TTL_SECONDS;
    try {
      const sig = await signMessageAsync({ message: bindingMessage(address, expires) });
      setToken(buildWalletToken(address, expires, sig));
      setExp(expires);
    } catch (e) {
      setError((e as { shortMessage?: string })?.shortMessage ?? 'The wallet did not sign. Try again.');
    }
  };

  const copy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const backHref = useMemo(() => {
    if (!returnUrl || !token || !address) return null;
    try {
      const u = new URL(returnUrl);
      u.searchParams.set('walletToken', token);
      u.searchParams.set('wallet', address);
      return u.toString();
    } catch {
      return null;
    }
  }, [returnUrl, token, address]);

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 px-4 py-8 sm:py-12">
      <h1 className="text-[22px] font-bold tracking-tight text-white">Connect your wallet to the agent API</h1>

      <div className={card}>
        <p className="text-[14px] leading-relaxed text-white/70">
          Connect once, and your agent can prepare actions for this wallet without you pasting the address every
          time. You sign one message — not a transaction, no funds move — and get a token that lasts 90 days.
          The agent stores the token; Polypad stores nothing.
        </p>
        {address && <p className="mt-2 text-[14px] text-white">Wallet: <span className="font-mono text-[13px]">{short(address)}</span></p>}
      </div>

      {!isConnected || !address ? (
        <div className={card}>
          <p className="text-[14px] font-medium text-white">Connect your wallet</p>
          <p className="mt-1 text-[13px] text-white/55">On a phone, pick your wallet app and this same page reopens inside it.</p>
          <div className="mt-4">
            <ConnectButton.Custom>{({ openConnectModal }) => <button type="button" className={primary} onClick={openConnectModal}>Connect wallet</button>}</ConnectButton.Custom>
          </div>
        </div>
      ) : !token ? (
        <div className={card}>
          <p className="text-[14px] font-medium text-white">Sign to connect</p>
          <p className="mt-1 text-[13px] leading-relaxed text-white/55">
            Your wallet will ask you to sign a short message. It names this wallet and an expiry date 90 days from
            now. It is not a transaction and it cannot move funds.
          </p>
          {error && <p className="mt-3 text-[13px] text-white/80" role="alert">{error}</p>}
          <button type="button" className={`${primary} mt-4`} onClick={sign} disabled={signing}>
            {signing ? 'Waiting for your wallet…' : 'Sign the connection message'}
          </button>
        </div>
      ) : (
        <div className={card}>
          <p className="text-[12px] uppercase tracking-wider text-white/45">Connected</p>
          <p className="mt-2 text-[15px] font-semibold text-white">This wallet is connected to the agent API</p>
          <p className="mt-1 text-[13px] text-white/60">Valid until {exp ? expiryLabel(exp) : '—'}. After that, connect again here.</p>
          <p className="mt-3 text-[13px] leading-relaxed text-white/70">
            Give this token to your agent (or save it as <span className="font-mono text-[12px]">POLYPAD_WALLET_TOKEN</span>).
            The agent passes it instead of a wallet address. Treat it like a password for this wallet — never paste
            it in a public chat.
          </p>
          <pre className="mt-3 max-h-32 overflow-auto break-all rounded-xl bg-black/40 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-white/80">{token}</pre>
          <div className="mt-4 space-y-3">
            <button type="button" className={primary} onClick={copy}>{copied ? 'Copied' : 'Copy the token'}</button>
            {backHref && (
              <a className={`${secondary} block text-center`} href={backHref}>Back to the agent</a>
            )}
            <button
              type="button"
              className={secondary}
              onClick={() => { setToken(null); setExp(null); }}
            >
              Connect a different wallet
            </button>
          </div>
        </div>
      )}

      <p className="text-center text-[12px] text-white/40">Polypad never asks for a private key or seed phrase. Not audited.</p>
    </div>
  );
}
