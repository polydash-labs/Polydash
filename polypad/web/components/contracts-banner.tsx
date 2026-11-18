'use client';

import { AlertTriangle } from 'lucide-react';
import { getFactoryAddress } from '@/lib/contracts/addresses';

export function ContractsBanner() {
  const factory = getFactoryAddress();
  if (factory) return null;

  return (
    <div className="border border-yellow-500/30 bg-yellow-500/10 text-yellow-200 rounded-lg px-4 py-3 flex items-center gap-3 text-sm">
      <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0" />
      <div>
        <span className="font-semibold">Contracts not yet deployed.</span>{' '}
        Contract addresses are not configured. The app is in preview mode with simulated data.
      </div>
    </div>
  );
}
