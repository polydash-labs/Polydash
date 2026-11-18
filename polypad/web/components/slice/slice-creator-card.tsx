'use client';

import Link from 'next/link';
import { useAccount } from 'wagmi';
import { sameAddress, sliceLive } from '@/lib/slice';

/** Creator tool entry on the token page. Shown only to the launch creator while the feature is live. */
export function SliceCreatorCard({ token, creator }: { token: string; creator?: string | null }) {
  const { address } = useAccount();
  if (!sliceLive() || !sameAddress(address, creator)) return null;
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h3 className="text-[14px] font-semibold text-white">Airdrop slice</h3>
      <p className="mt-1 text-[12px] text-white/60">Add an airdrop slice for POLYDASH stakers.</p>
      <Link href={`/slice/create?token=${token}`} className="mt-3 inline-block rounded-full bg-white px-4 py-1.5 text-[12px] font-medium text-black">Add a slice</Link>
    </section>
  );
}
