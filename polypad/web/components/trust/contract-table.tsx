import { ArrowUpRight } from 'lucide-react';
import { CopyButton } from '@/components/trust/copy-address';

const EXPLORER = 'https://robinhoodchain.blockscout.com/address/';
export const DEPLOYMENTS_URL = 'https://github.com/polydash-labs/Polydash/blob/main/docs/DEPLOYMENTS.md';

export type ContractRow = { name: string; address: string };

const pill =
  'inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-white/10 px-2.5 text-xs text-white/70 transition-colors hover:border-white/25 hover:text-white';

export function ContractTable({ rows }: { rows: ContractRow[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl bg-[#121212] shadow-[0_1px_0_rgba(255,255,255,0.04)_inset] ring-1 ring-white/[0.06]">
      <table className="w-full min-w-[640px] table-fixed text-left text-sm">
        <thead>
          <tr className="border-b border-white/[0.06] text-xs uppercase tracking-widest text-white/50">
            <th scope="col" className="px-4 py-3 w-[27%] font-medium sm:px-5">Name</th>
            <th scope="col" className="px-4 py-3 w-[41%] font-medium">Address</th>
            <th scope="col" className="px-4 py-3 w-[17%] font-medium">Blockscout</th>
            <th scope="col" className="px-4 py-3 w-[15%] font-medium sm:pr-5">Source</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">
          {rows.map((r) => (
            <tr key={`${r.name}-${r.address}`} className="align-middle">
              <td className="px-4 py-3 text-white/80 sm:px-5">{r.name}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <code className="break-all font-mono text-[12px] text-white/75">{r.address}</code>
                  <CopyButton value={r.address} label={`Copy ${r.name} address`} />
                </div>
              </td>
              <td className="px-4 py-3">
                <a href={`${EXPLORER}${r.address}`} target="_blank" rel="noopener noreferrer" className={pill} aria-label={`View ${r.name} on Blockscout`}>
                  Blockscout
                  <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                </a>
              </td>
              <td className="px-4 py-3 sm:pr-5">
                <a href={DEPLOYMENTS_URL} target="_blank" rel="noopener noreferrer" className={pill} aria-label={`Source for ${r.name}`}>
                  Source
                  <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
