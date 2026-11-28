import type { Wallet } from '@rainbow-me/rainbowkit';
import { getWalletConnectConnector } from '@rainbow-me/rainbowkit';
import { metaMaskWallet, coinbaseWallet, trustWallet } from '@rainbow-me/rainbowkit/wallets';
import { createConnector } from 'wagmi';
import { injected } from 'wagmi/connectors';

type EthWindow = Window & { ethereum?: unknown };

function hasInjected(): boolean {
  return typeof window !== 'undefined' && typeof (window as EthWindow).ethereum !== 'undefined';
}

/**
 * A wallet that connects through the injected provider when one exists (desktop extension or the
 * wallet's in-app browser). Without one (e.g. mobile Safari/Chrome), it opens this page inside the
 * wallet app's browser via its official deep link, where the injected provider is available.
 * Needs no WalletConnect project ID.
 */
function deepLinkWallet(opts: {
  id: string;
  name: string;
  iconUrl: Wallet['iconUrl'];
  iconBackground: string;
  downloadUrls?: Wallet['downloadUrls'];
  buildUrl: (pageUrl: string) => string;
}): Wallet {
  return {
    id: opts.id,
    name: opts.name,
    iconUrl: opts.iconUrl,
    iconBackground: opts.iconBackground,
    downloadUrls: opts.downloadUrls,
    createConnector: (walletDetails) =>
      createConnector((config) => {
        const base = injected()(config);
        return {
          ...base,
          ...walletDetails,
          // RainbowKit calls getChainId() before connect(); without a provider it would throw and the
          // deep link would never open.
          async getChainId() {
            if (!hasInjected()) return config.chains[0].id;
            return base.getChainId();
          },
          async connect(params) {
            if (!hasInjected()) {
              window.location.href = opts.buildUrl(window.location.href);
              throw new Error(`Opening ${opts.name}…`);
            }
            return base.connect(params);
          },
        } as typeof base;
      }),
  };
}

function hasPolycube(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as Window & { polycube?: unknown }).polycube !== 'undefined'
  );
}

/**
 * Polycube — Polypad's own browser extension (Rabby fork). The extension
 * announces itself over EIP-6963 as Polycube (rdns family.polypad.polycube,
 * Polydash logo icon) via the patched @rabby-wallet/page-provider, so when it
 * is installed RainbowKit shows the EIP-6963 entry and this entry is deduped
 * away. When it is not installed, this entry shows with the Chrome Web Store
 * download link. The connector is a fallback for the not-discovered case; the
 * EIP-6963 path is what connects when installed.
 */
export function buildPolycube(): Wallet {
  return {
    id: 'polycube',
    name: 'Polycube',
    rdns: 'family.polypad.polycube',
    iconUrl: '/polycube-icon.png',
    iconBackground: '#000000',
    downloadUrls: {
      chrome:
        'https://chromewebstore.google.com/detail/polywallet/eiffolfghfbiacfghddfkgkholeemglp',
      browserExtension:
        'https://chromewebstore.google.com/detail/polywallet/eiffolfghfbiacfghddfkgkholeemglp',
    },
    installed: hasPolycube(),
    createConnector: (walletDetails) =>
      createConnector((config) => {
        const base = injected()(config);
        return {
          ...base,
          ...walletDetails,
          // RainbowKit calls getChainId() before connect(); without a provider it would throw and the
          // install UI would never show.
          async getChainId() {
            if (!hasPolycube()) return config.chains[0].id;
            return base.getChainId();
          },
          async connect(params) {
            if (!hasPolycube()) {
              throw new Error('Install Polycube to connect.');
            }
            return base.connect(params);
          },
        } as typeof base;
      }),
  };
}

export function buildDeepLinkWallets(): Wallet[] {
  // Reuse RainbowKit's official icons; the WalletConnect connectors behind these are never created.
  const ref = { projectId: 'unused', appName: 'Polypad' };
  const mm = metaMaskWallet(ref);
  const cb = coinbaseWallet({ appName: ref.appName });
  const tw = trustWallet(ref);

  return [
    deepLinkWallet({
      id: 'polydash-metamask',
      name: 'MetaMask',
      iconUrl: mm.iconUrl,
      iconBackground: mm.iconBackground,
      downloadUrls: mm.downloadUrls,
      buildUrl: (u) => `https://metamask.app.link/dapp/${u.replace(/^https?:\/\//, '')}`,
    }),
    deepLinkWallet({
      id: 'polydash-coinbase',
      name: 'Coinbase / Base',
      iconUrl: cb.iconUrl,
      iconBackground: cb.iconBackground,
      downloadUrls: cb.downloadUrls,
      buildUrl: (u) => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(u)}`,
    }),
    deepLinkWallet({
      id: 'polydash-trust',
      name: 'Trust Wallet',
      iconUrl: tw.iconUrl,
      iconBackground: tw.iconBackground,
      downloadUrls: tw.downloadUrls,
      buildUrl: (u) => `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(u)}`,
    }),
  ];
}

/**
 * Robinhood Wallet, listed by name. RainbowKit 2.2.11 ships no Robinhood
 * connector, and Robinhood publishes no deep link for opening a dapp, so
 * this entry runs on WalletConnect — the path Robinhood's own docs describe:
 * scan the QR code with Robinhood Wallet, or pick it from the WalletConnect
 * list on your phone. Needs a Reown Cloud project ID (NEXT_PUBLIC_
 * WALLETCONNECT_PROJECT_ID); without one the entry is hidden, exactly like
 * the other WalletConnect wallets.
 */
export function buildRobinhoodWallet(projectId: string): Wallet {
  return {
    id: 'polydash-robinhood',
    name: 'Robinhood Wallet',
    iconUrl: '/robinhood-wallet.svg',
    iconBackground: '#00C805',
    downloadUrls: {
      android: 'https://play.google.com/store/apps/details?id=com.robinhood.gateway',
    },
    qrCode: { getUri: (uri: string) => uri },
    createConnector: getWalletConnectConnector({ projectId }),
  };
}
