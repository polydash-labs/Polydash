'use client';

import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrivyProvider } from '@privy-io/react-auth';
import { wagmiConfig } from '@/lib/wagmi-config';
import { PRIVY_APP_ID, privyClientConfig, privyEnabled } from '@/lib/privy-config';
import { PrivyWagmiBridge } from '@/components/privy/privy-auth';
import '@rainbow-me/rainbowkit/styles.css';
import { useState, type ReactNode } from 'react';

export function Web3Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        refetchOnWindowFocus: false,
      },
    },
  }));

  const tree = (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          modalSize="compact"
          theme={darkTheme({
            accentColor: '#00E676',
            accentColorForeground: '#000000',
            borderRadius: 'medium',
            fontStack: 'system',
          })}
        >
          <PrivyWagmiBridge />
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );

  // Email sign-in is off until a Privy app ID is configured — the tree above
  // is then byte-identical to the previous behaviour.
  if (!privyEnabled) return tree;
  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={privyClientConfig}>
      {tree}
    </PrivyProvider>
  );
}
