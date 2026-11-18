'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, Check, Copy } from 'lucide-react';
import { TokenAvatar } from '@/components/token-avatar';
import { StakingBadgeFull } from '@/components/staking-badge';
import { shortenAddress } from '@/lib/format';
import { getExplorerAddressUrl } from '@/lib/contracts/addresses';
import type { LaunchToken } from '@/lib/token-types';
import { dexScreenerUrl } from './bonding-curve-chart';
import { CtoSection } from './cto-section';
import { TokenSecurityReport } from '@/components/security-report';

// Same value as POLYDASH in lib/buyback.ts (kept local so this page does not load the buyback contract artifacts).
const POLYDASH = '0x319525528f42167eF7fC18b77b889958080568e4';

export interface ExternalTokenView { address: string; symbol: string; name: string; imageUri: string; creator: string }

/** Token page for a listed token launched outside the Polypad factory. No curve, graduation or launch-fairness data. */
export function ExternalTokenContent({ token }: { token: ExternalTokenView }) {
  const [copied, setCopied] = useState(false);
  const addr = token.address.toLowerCase();
  // CtoSection reads only identity fields; factory-only numbers stay zero and are never rendered for external tokens.
  const launchLike: LaunchToken = {
    launchAddress: addr, tokenAddress: token.address, name: token.name, symbol: token.symbol, imageUri: token.imageUri,
    description: '', creator: token.creator, creatorFeeBps: 0, curveProgress: 0, marketCapUsd: 0, volumeUsd: null, priceEth: 0,
    ethRaised: 0, graduationThreshold: 0, graduated: true, totalSupply: '0', socialLinks: [], createdAt: 0, phase: 0, launchTime: 0,
    totalCommitted: 0, committers: 0, commitmentCursor: 0, virtualEthWei: '0', curveSupplyWei: '0', tokensSoldWei: '0', kWei: '0',
  };

  const handleCopy = () => {
    navigator?.clipboard?.writeText?.(token.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mx-auto max-w-container space-y-4 px-4 py-5 sm:space-y-5 sm:px-8 sm:py-8">
      <Link href="/" className="inline-flex items-center gap-1.5 text-[13px] text-white/55 transition-colors hover:text-white">
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} /> Tokens
      </Link>

      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <TokenAvatar name={token.name} symbol={token.symbol} imageUri={token.imageUri} size="lg" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="truncate text-[22px] font-semibold tracking-tight sm:text-[28px]">{token.name}</h1>
            <span className="font-mono text-[13px] text-white/55">${token.symbol}</span>
            <span className="inline-flex items-center rounded-full bg-white/[0.07] px-2.5 py-0.5 text-[11px] font-medium text-white/80">Listed token</span>
            <StakingBadgeFull token={token.address} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-white/55">
            <button onClick={handleCopy} className="inline-flex items-center gap-1 font-mono transition-colors hover:text-white">
              {shortenAddress(token.address)}
              {copied ? <Check className="h-3 w-3 text-polydash-green" strokeWidth={1.75} /> : <Copy className="h-3 w-3" strokeWidth={1.75} />}
            </button>
            <a href={getExplorerAddressUrl(token.address)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 transition-colors hover:text-white">
              Explorer <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
            </a>
            <a href={dexScreenerUrl(token.address)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-polydash-green hover:text-polydash-green-light">
              DexScreener <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
            </a>
            <Link href="/stake" className="inline-flex items-center rounded-full border border-polydash-green/40 px-2.5 py-0.5 text-polydash-green transition-colors hover:border-polydash-green hover:text-polydash-green-light">
              Stake
            </Link>
            {token.address.toLowerCase() === POLYDASH.toLowerCase() && (
              <Link href="/buybacks" className="inline-flex items-center rounded-full border border-polydash-green/40 px-2.5 py-0.5 text-polydash-green transition-colors hover:border-polydash-green hover:text-polydash-green-light">
                Buybacks
              </Link>
            )}
            <Link href={`/agents?agent=polycto&token=${token.address}`} className="inline-flex items-center rounded-full border border-white/15 px-2.5 py-0.5 text-white/70 transition-colors hover:border-polydash-green/50 hover:text-white">
              Analyze with PolyCTO
            </Link>
          </div>
        </div>
      </div>

      <TokenSecurityReport token={launchLike} external />

      <CtoSection token={launchLike} external />
    </div>
  );
}
