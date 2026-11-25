// A wagmi connector for a Privy embedded wallet.
//
// Why a custom connector instead of Privy's official `@privy-io/wagmi` path:
// that package's `createConfig` drops every connector that is not a mock
// (`connectors.filter(c => c.type === 'mock')`) and drives connections only
// through Privy's own modal. Adopting it would remove RainbowKit and the
// MetaMask / Coinbase / Trust Wallet deep-link wallets from the site. This
// connector does the opposite: it wraps the embedded wallet's EIP-1193
// provider so wagmi's existing hooks (`useAccount`, `useWriteContract`,
// `useSignTypedData`, …) work with it, while every existing wallet path stays
// exactly as it is.
//
// It is registered in the wagmi config (dormant: `isAuthorized` is false and
// `connect` throws until a Privy login sets the provider). The bridge sets
// the provider after login and connects it; RainbowKit never lists it, so the
// wallet dialog is unchanged.

import { createConnector } from 'wagmi';
import type { EIP1193Provider } from 'viem';
import { robinhoodChain } from '@/lib/chain';

const ROBINHOOD_CHAIN_PARAMS = {
  chainId: `0x${robinhoodChain.id.toString(16)}`,
  chainName: robinhoodChain.name,
  nativeCurrency: robinhoodChain.nativeCurrency,
  rpcUrls: robinhoodChain.rpcUrls.default.http,
  blockExplorerUrls: [robinhoodChain.blockExplorers.default.url],
};

type PrivyProvider = EIP1193Provider;

/** The logged-in user's embedded wallet provider, set by the bridge after login. */
let privyProvider: PrivyProvider | null = null;

export function setPrivyProvider(provider: PrivyProvider | null) {
  privyProvider = provider;
}

export function hasPrivyProvider() {
  return privyProvider !== null;
}

function requireProvider(): PrivyProvider {
  if (!privyProvider) throw new Error('Sign in with email first — no wallet yet.');
  return privyProvider;
}

export const privyWalletConnector = createConnector<PrivyProvider>((config) => {
  let listening = false;

  function onAccountsChanged(accounts: string[]) {
    if (accounts.length === 0) {
      config.emitter.emit('disconnect');
      return;
    }
    config.emitter.emit('change', { accounts: accounts as readonly `0x${string}`[] });
  }
  function onChainChanged(chainId: string) {
    config.emitter.emit('change', { chainId: Number(chainId) });
  }
  function onDisconnect() {
    config.emitter.emit('disconnect');
  }

  function subscribe(provider: PrivyProvider) {
    if (listening || typeof provider.on !== 'function') return;
    listening = true;
    provider.on('accountsChanged', onAccountsChanged);
    provider.on('chainChanged', onChainChanged);
    provider.on('disconnect', onDisconnect);
  }
  function unsubscribe(provider: PrivyProvider) {
    if (!listening || typeof provider.removeListener !== 'function') return;
    listening = false;
    provider.removeListener('accountsChanged', onAccountsChanged);
    provider.removeListener('chainChanged', onChainChanged);
    provider.removeListener('disconnect', onDisconnect);
  }

  return {
    id: 'privy-embedded',
    name: 'Email wallet',
    type: 'privy-embedded',
    // Matches wagmi's Connector contract (wagmi 3.7+): when the caller asks
    // for capabilities, wrap each address the same way wagmi's own injected
    // connector does. This wallet reports no capabilities, so the object is
    // empty. (No explicit generic here — like wagmi's own connectors, the
    // `withCapabilities` generic comes from the contextual Connector type.)
    async connect({ withCapabilities } = {}) {
      const provider = requireProvider();
      subscribe(provider);
      const accounts = (await provider.request({
        method: 'eth_requestAccounts',
      })) as `0x${string}`[];
      const chainIdHex = (await provider.request({ method: 'eth_chainId' })) as string;
      return {
        // `as never`: same cast wagmi's own injected connector uses — the
        // ternary's union can't be proven against the conditional return
        // type, and the branch already picks the right shape.
        accounts: (withCapabilities
          ? accounts.map((address) => ({ address, capabilities: {} }))
          : accounts) as never,
        chainId: Number(chainIdHex),
      };
    },
    async disconnect() {
      if (privyProvider) unsubscribe(privyProvider);
    },
    async getAccounts() {
      const provider = requireProvider();
      const accounts = (await provider.request({ method: 'eth_accounts' })) as `0x${string}`[];
      return accounts;
    },
    async getChainId() {
      const provider = requireProvider();
      const chainIdHex = (await provider.request({ method: 'eth_chainId' })) as string;
      return Number(chainIdHex);
    },
    async getProvider() {
      return requireProvider();
    },
    async isAuthorized() {
      // Only true once a Privy login has set the provider.
      return privyProvider !== null;
    },
    async switchChain({ chainId }) {
      const provider = requireProvider();
      if (chainId !== robinhoodChain.id) {
        throw new Error('Polypad runs on Robinhood Chain.');
      }
      try {
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: ROBINHOOD_CHAIN_PARAMS.chainId }],
        });
      } catch (e) {
        const err = e as { code?: number };
        if (err?.code !== 4902) throw e;
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [ROBINHOOD_CHAIN_PARAMS],
        });
      }
      return robinhoodChain;
    },
    onAccountsChanged(accounts: string[]) {
      onAccountsChanged(accounts);
    },
    onChainChanged(chainId: string) {
      onChainChanged(chainId);
    },
    onDisconnect() {
      onDisconnect();
    },
  };
});
