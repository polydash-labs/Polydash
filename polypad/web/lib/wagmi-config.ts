import { connectorsForWallets, type WalletList } from '@rainbow-me/rainbowkit';
import { injectedWallet, rainbowWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets';
import { createConfig, http } from 'wagmi';
import { robinhoodChain } from './chain';
import { buildDeepLinkWallets, buildPolycube, buildRobinhoodWallet } from './deep-link-wallets';
import { privyEnabled } from './privy-config';
import { privyWalletConnector } from './privy/privy-connector';

const appName = 'Polypad';
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';
const hasWalletConnect = projectId.length >= 32;

const wallets: WalletList = [
  { groupName: 'Popular', wallets: [
      // Polycube first — our own extension. When installed it announces over
      // EIP-6963 and RainbowKit shows that entry (this one is deduped away);
      // when not installed this entry shows with the store download link.
      () => buildPolycube(),
      ...buildDeepLinkWallets().map((w) => () => w),
      // Robinhood Wallet, listed by name — only once a WalletConnect project
      // ID is configured, since it connects over WalletConnect.
      ...(hasWalletConnect ? [() => buildRobinhoodWallet(projectId)] : []),
      // Generic browser wallet: listed only when a provider is actually injected,
      // and hidden when Polycube is the injected provider (its own entry covers it).
      () => ({
        ...injectedWallet(),
        installed:
          typeof window !== 'undefined' &&
          typeof (window as Window & { ethereum?: unknown }).ethereum !== 'undefined' &&
          typeof (window as Window & { polycube?: unknown }).polycube === 'undefined',
      }),
    ],
  },
];
if (hasWalletConnect) {
  wallets.push({ groupName: 'More', wallets: [rainbowWallet, walletConnectWallet] });
}

const connectors = connectorsForWallets(wallets, {
  appName,
  // Only used by WalletConnect-based wallets, which are added only when a real ID is configured.
  projectId: hasWalletConnect ? projectId : 'unused',
});

export const wagmiConfig = createConfig({
  // The Privy embedded-wallet connector, registered dormant: it only works
  // after an email login sets its provider (see lib/privy/privy-connector).
  // RainbowKit never lists it, so the wallet dialog is unchanged.
  connectors: privyEnabled ? [...connectors, privyWalletConnector] : connectors,
  chains: [robinhoodChain],
  transports: {
    [robinhoodChain.id]: http(robinhoodChain.rpcUrls.default.http[0]),
  },
  ssr: true,
});
