// Email / social sign-in + embedded wallet, via Privy.
//
// Privy is the default provider (chosen Nov 2026; Dynamic was the other
// option — no concrete technical reason to switch: Privy supports the exact
// wagmi-bridge pattern used here and its embedded wallets are recoverable by
// email/passkey, which is what the newcomer flow needs).
//
// The Privy app ID is a PUBLIC client ID, not a secret — but there is no app
// yet. Until Jon creates the Privy app and sets NEXT_PUBLIC_PRIVY_APP_ID,
// every Privy path in the site is off and the site behaves exactly as before:
// `privyEnabled` is false, no Privy provider mounts, no sign-in button
// renders, and no Privy code runs.

import type { PrivyClientConfig } from '@privy-io/react-auth';
import { robinhoodChain } from './chain';

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';
export const privyEnabled = PRIVY_APP_ID.length > 0;

export const privyClientConfig: PrivyClientConfig = {
  // Email first, then the two social logins most newcomers already have.
  loginMethods: ['email', 'google', 'apple'],
  appearance: {
    theme: 'dark',
    accentColor: '#00E676',
    logo: '/polydash-mark-white.png',
  },
  // A wallet is made for the person when they sign in, but only if they do
  // not already have one — someone connecting MetaMask keeps using MetaMask.
  embeddedWallets: {
    ethereum: { createOnLogin: 'users-without-wallets' },
  },
  supportedChains: [robinhoodChain],
  defaultChain: robinhoodChain,
};
