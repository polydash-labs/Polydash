import { blockscoutAddr, sourcifyUrl } from '@/lib/slice';
import { SLICE_DISTRIBUTOR_EXPECTED_ADDRESS, SLICE_ESCROW_EXPECTED_ADDRESS } from '@/lib/sliceArtifacts';

export function SourcifyLink({ address }: { address: string }) {
  return (
    <a href={sourcifyUrl(address)} target="_blank" rel="noopener noreferrer" className="text-[11px] text-white/60 underline hover:text-white">
      Verified on Sourcify
    </a>
  );
}

/** Slice contract addresses with explorer and Sourcify links. */
export function SliceContracts() {
  const rows = [
    { label: 'SliceDistributor', address: SLICE_DISTRIBUTOR_EXPECTED_ADDRESS },
    { label: 'SliceEscrow', address: SLICE_ESCROW_EXPECTED_ADDRESS },
  ];
  return (
    <div className="space-y-1.5" data-testid="slice-contracts">
      {rows.map((r) => (
        <div key={r.label} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12px]">
          <span className="text-white/55">{r.label}</span>
          <span className="flex flex-wrap items-center gap-3">
            <a href={blockscoutAddr(r.address)} target="_blank" rel="noopener noreferrer" className="break-all font-mono text-white/80 underline">{r.address}</a>
            <SourcifyLink address={r.address} />
          </span>
        </div>
      ))}
    </div>
  );
}
