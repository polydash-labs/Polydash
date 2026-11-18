'use client';

import type { ReactNode } from 'react';
import { TabBar, useUrlTab } from './url-tabs';

const KEYS = ['overview', 'stake'] as const;
const TABS = [{ k: 'overview', label: 'Overview' }, { k: 'stake', label: 'Stake' }] as const;

/** Overview | Stake tabs for a collection page's main column. Linkable via ?tab=stake. */
export function CollectionTabs({ children, stake }: { children: ReactNode; stake: ReactNode }) {
  const [tab, setTab] = useUrlTab(KEYS, 'overview');
  return (
    <>
      <TabBar tabs={TABS} value={tab} onChange={setTab} label="Collection sections" />
      {tab === 'stake' ? stake : children}
    </>
  );
}
