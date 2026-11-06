'use client';

import Link from 'next/link';
import { TokenAvatar } from './token-avatar';
import { BondingCurveBar } from './bonding-curve-bar';
import { formatUsd, formatEth } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { LaunchToken as MockToken } from '@/lib/token-types';
import { isAgentLaunched } from '@/lib/agent-mark';
import { AgentLaunchedBadge } from '@/components/agent-launched-badge';
import { HoverLift } from '@/components/ui/animate';

export function TokenCard({ token }: { token: MockToken }) {
  const t = token;
  return (
    <HoverLift>
      <Link href={`/token/${t?.launchAddress ?? ''}`} className="block">
        <div className="glass-card p-4 sm:p-5 transition-all duration-300 group h-full">
          <div className="flex items-start gap-3 mb-3">
            <TokenAvatar name={t?.name} symbol={t?.symbol} imageUri={t?.imageUri} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-[15px] tracking-tight text-white truncate">{t?.name ?? 'Unknown'}</h3>
                {t?.graduated && (
                  <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
                    Graduated
                  </span>
                )}
                {isAgentLaunched(t?.socialLinks) && <AgentLaunchedBadge />}
              </div>
              <p className="text-xs text-muted-foreground font-mono">${t?.symbol ?? '???'}</p>
            </div>
          </div>

          <BondingCurveBar progress={t?.curveProgress ?? 0} />

          <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
            <div className="bg-secondary/50 rounded-lg px-2.5 py-1.5">
              <span className="text-muted-foreground">MCap</span>
              <p className="font-mono font-semibold text-foreground">{formatUsd(t?.marketCapUsd)}</p>
            </div>
            <div className="bg-secondary/50 rounded-lg px-2.5 py-1.5">
              <span className="text-muted-foreground">Volume</span>
              <p className="font-mono font-semibold text-foreground">{formatUsd(t?.volumeUsd)}</p>
            </div>
          </div>

          <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
            <span className="font-mono">{formatEth(BigInt(Math.floor((t?.ethRaised ?? 0) * 1e18)))} ETH raised</span>
            <span>{getTimeAgo(t?.createdAt)}</span>
          </div>
        </div>
      </Link>
    </HoverLift>
  );
}

function getTimeAgo(ts: number | undefined | null): string {
  if (!ts) return 'just now';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}
