import type { Metadata } from 'next';
import { TrustShell, TrustSection, ExtLink, EmailLink } from '@/components/trust/trust-shell';
import { ContractTable, type ContractRow } from '@/components/trust/contract-table';
import { CONTACT_EMAIL, POLYDASH_TOKEN, trustMetadata } from '@/lib/trust';
import { LEGACY_FACTORY_ADDRESS } from '@/lib/contracts/addresses';
import { POLYPAD_FACTORY } from '@/lib/agent-launch';
import { STAKING_V1_FACTORY, STAKING_V2_FACTORY } from '@/lib/staking-status';
import { NFT_STAKING_FACTORY_ADDRESS, FIXED_NFT_FACTORY, CURVE_NFT_FACTORY } from '@/lib/nftStaking';
import { VESTING_FACTORY_ADDRESS } from '@/lib/vesting';
import { BOND_FACTORY_ADDRESS } from '@/lib/bond';
import { GATED_FACTORY_ADDRESS } from '@/lib/gatedMint';
import { TREASURY_FACTORY_ADDRESS } from '@/lib/treasury';
import { TOKEN_FLOOR_FACTORY_ADDRESS } from '@/lib/floorVault';
import { SLICE_DISTRIBUTOR_ADDRESS, SLICE_ESCROW_ADDRESS } from '@/lib/slice';
import { FUND_FACTORY_ADDRESS } from '@/lib/fund/address';
import { FUND_ALLOWLIST, FUND_FACTORY_PHASE3, FUND_SWAP_FACET_PHASE3, STRATEGY_TEMPLATE } from '@/lib/fund/phase3';

export const metadata: Metadata = trustMetadata({
  title: 'Contracts | Polypad',
  description: 'Live Polypad contract addresses on Robinhood Chain (chain ID 4663), with Blockscout links and source on GitHub.',
  path: '/contracts',
});

const REPO_URL = 'https://github.com/polydash-labs/Polydash';
const FUND_PHASE2_FACTORY = '0xd3c6ae470c25989cC8d2876c1855fB570B98894E';

type Row = { name: string; address: string | null | undefined };
const live = (rows: Row[]): ContractRow[] => rows.filter((r): r is ContractRow => Boolean(r.address));

const groups: { title: string; rows: ContractRow[] }[] = [
  { title: 'Token', rows: live([{ name: 'POLYDASH token', address: POLYDASH_TOKEN }]) },
  {
    title: 'Token launch factories',
    rows: live([
      { name: 'Launch factory (current)', address: POLYPAD_FACTORY },
      { name: 'Launch implementation (current)', address: '0x2e0026da8f2E151f63A4313aCD1a579172D9D2Ad' },
      { name: 'Uniswap V4 hook (current)', address: '0x4d3066bBfF889023def912D2fDe36c44357fA0cC' },
      { name: 'Commit vault (current)', address: '0xF013bF17D511E2f65D0dA4Bd320948646F567Ae4' },
      { name: 'Launch factory (earlier, launches still listed)', address: LEGACY_FACTORY_ADDRESS },
      { name: 'Launch implementation (earlier)', address: '0xef7684268f13bc06cb02755642ceabef422b8b70' },
      { name: 'Uniswap V4 hook (earlier)', address: '0x04990E6671C98e1B43034E52366Af11396d960CC' },
      { name: 'Commit vault (earlier)', address: '0x8f125c9ec7acd52b9cd39f2a7441085559d84104' },
    ]),
  },
  {
    title: 'Staking',
    rows: live([
      { name: 'Staking factory v2', address: STAKING_V2_FACTORY },
      { name: 'Staking factory v1 (legacy, not for new pools)', address: STAKING_V1_FACTORY },
      { name: 'NFT staking factory', address: NFT_STAKING_FACTORY_ADDRESS },
    ]),
  },
  { title: 'Vesting', rows: live([{ name: 'Vesting factory', address: VESTING_FACTORY_ADDRESS }]) },
  { title: 'Bond', rows: live([{ name: 'Creator bond factory', address: BOND_FACTORY_ADDRESS }]) },
  { title: 'Treasury rules', rows: live([{ name: 'Treasury rules factory', address: TREASURY_FACTORY_ADDRESS }]) },
  {
    title: 'Floor factory',
    rows: live([
      { name: 'Token-backed floor vault factory', address: TOKEN_FLOOR_FACTORY_ADDRESS },
      { name: 'Floor vault implementation', address: TOKEN_FLOOR_FACTORY_ADDRESS ? '0xFa23E496f7244d1674fA8bE5C42556bd054140EA' : null },
    ]),
  },
  {
    title: 'NFTs',
    rows: live([
      { name: 'NFT factory', address: FIXED_NFT_FACTORY },
      { name: 'NFT bonding-curve factory', address: CURVE_NFT_FACTORY },
      { name: 'NFT marketplace', address: '0x4Ff1d0E3Aa767C05b2D9983e14dDbC243CB0120A' },
      { name: 'NFT token rewards', address: '0xCD96D8e10a82b41A08342c03a176c20336bD0b38' },
      { name: 'Holder mint factory', address: GATED_FACTORY_ADDRESS },
    ]),
  },
  {
    title: 'Airdrop slice',
    rows: live([
      { name: 'Slice distributor', address: SLICE_DISTRIBUTOR_ADDRESS },
      { name: 'Slice escrow', address: SLICE_ESCROW_ADDRESS },
    ]),
  },
  {
    title: 'Funds',
    rows: live([
      { name: 'FundFactory', address: FUND_FACTORY_ADDRESS },
      { name: 'Phase 2 factory', address: FUND_PHASE2_FACTORY },
      { name: 'Phase 2 allowlist', address: FUND_ALLOWLIST },
      { name: 'FundFactoryPhase3', address: FUND_FACTORY_PHASE3 },
      { name: 'StrategyTemplate', address: STRATEGY_TEMPLATE },
      { name: 'FundSwapFacetPhase3', address: FUND_SWAP_FACET_PHASE3 },
    ]),
  },
].filter((g) => g.rows.length > 0);

export default function ContractsPage() {
  return (
    <TrustShell
      title="Contracts"
      intro={
        <>
          Polypad is built by Polydash. These are the contracts behind polypad.family, with source on GitHub. All addresses are on Robinhood Chain
          (chain ID 4663). Always check the address before you interact. GitHub repo: <ExtLink href={REPO_URL}>{REPO_URL}</ExtLink>
        </>
      }
    >
      {groups.map((g) => (
        <TrustSection key={g.title} title={g.title}>
          <ContractTable rows={g.rows} />
        </TrustSection>
      ))}

      <TrustSection title="How to report a vulnerability">
        <p>
          Email <EmailLink email={CONTACT_EMAIL} subject="Security report" /> with the subject &quot;Security report&quot;. Include the contract
          address, a description, steps to reproduce and the potential impact. Please do not disclose the issue publicly or exploit it beyond what is
          needed to show it. We will acknowledge your report and keep you updated while we investigate.
        </p>
      </TrustSection>

      <p className="border-t border-white/10 pt-6 text-sm text-white/60">New contracts are not audited. Not financial advice.</p>
    </TrustShell>
  );
}
