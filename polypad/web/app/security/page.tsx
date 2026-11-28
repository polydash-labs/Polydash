import type { Metadata } from 'next';
import Link from 'next/link';
import { TrustShell, TrustSection, ExtLink, EmailLink } from '@/components/trust/trust-shell';
import { CONTACT_EMAIL, trustMetadata } from '@/lib/trust';

export const metadata: Metadata = trustMetadata({
  title: 'Security | Polypad',
  description: 'How Polypad handles security: responsible disclosure, SEAL Safe Harbor, automated scans of live contracts, and known issues. Contracts are unaudited.',
  path: '/security',
});

const REPO_URL = 'https://github.com/polydash-labs/Polydash';
const SECURITY_MD_URL = `${REPO_URL}/blob/main/SECURITY.md`;
const SAFE_HARBOR_GUIDE_URL = 'https://frameworks.securityalliance.org/safe-harbor/overview/';

// Scanner results — verified live Nov 18, 2026. Only scanners that actually
// cover Robinhood Chain (4663) have results here. Token Sniffer, De.Fi
// Scanner, QuillCheck and CertiK Skynet do not cover this chain, so no scan
// exists there — we publish only results that exist. All of these are token
// scanners: POLYDASH is the only ERC-20 token in the list. The fund NFTs,
// factories, vaults and registries cannot be scanned by them; their stamp is
// Sourcify verification — 26 of 27 tokenized fund contracts verified, rendered
// in the Automated scans section below with a link to /contracts.
type ScanResult = { scanner: string; covers: string; url: string; result: string };
const SCAN_RESULTS: ScanResult[] = [
  {
    scanner: 'GoPlus',
    covers: 'POLYDASH token (ERC-20)',
    url: 'https://gopluslabs.io/token-security/4663/0x319525528f42167eF7fC18b77b889958080568e4',
    result:
      'Clean — no honeypot, not mintable, source verified, owner renounced, 0% buy/sell/transfer tax, 461 holders (checked Nov 18, 2026).',
  },
  {
    scanner: 'Tok{In} by Dedaub',
    covers: 'POLYDASH token (ERC-20)',
    url: 'https://tokin.dedaub.com/scan/robinhood/0x319525528f42167eF7fC18b77b889958080568e4',
    result:
      'Caution — 21 of 23 checks passed, 0 danger flags. Two flags: a Mint/Burn warning and an Owner Privileges note. Note on the Mint/Burn flag: the verified ClankerToken source has no public mint function — the full supply was minted once in the constructor; only standard holder burn functions exist. Honeypot simulation: buyable and sellable (checked Nov 18, 2026).',
  },
];

export default function SecurityPage() {
  return (
    <TrustShell
      title="Security"
      intro={
        <>
          Polypad contracts are <strong>unaudited</strong>. Source code is public and verified on Sourcify where applicable. This page is our
          public security commitment: how to report a problem, what protects researchers who rescue funds during an exploit, what the automated
          scanners say, and the issues we already know about. Full policy: <ExtLink href={SECURITY_MD_URL}>SECURITY.md</ExtLink>. Live contract
          addresses: <ExtLink href="/contracts">polypad.family/contracts</ExtLink>.
        </>
      }
    >
      <TrustSection title="Report a vulnerability">
        <p>
          Email <EmailLink email={CONTACT_EMAIL} subject="Security report" /> with the subject &quot;Security report&quot;, or open a private
          advisory from the Security tab of <ExtLink href={REPO_URL}>{REPO_URL}</ExtLink>. Include the contract address, the impact, and a proof
          of concept. Please do not open public issues for security problems, and allow reasonable time for a fix before disclosing. We aim to
          acknowledge reports within 72 hours.
        </p>
        <p className="mt-3">
          <strong>No monetary rewards.</strong> Polydash does not offer money for vulnerability reports — there is no bug bounty budget.
          Researchers who report valid issues in good faith receive public credit in the fix notes if they wish to be named. Good-faith research
          that follows this policy will not be pursued legally.
        </p>
      </TrustSection>

      <TrustSection title="SEAL Safe Harbor">
        <p>
          Polypad is adopting the <ExtLink href={SAFE_HARBOR_GUIDE_URL}>SEAL Safe Harbor Agreement for Whitehats</ExtLink> (v3). During an
          active exploit, whitehats may rescue funds under the agreement and keep a rescue reward deducted from the rescued funds: 10% of rescued
          funds, capped at $2,500 per whitehat, with no aggregate cap. No payment comes from the project&apos;s funds. Pseudonymous whitehats are
          accepted, subject to sanctions screening. Rescued funds must reach the asset recovery address within 72 hours.
        </p>
        <p className="mt-3">
          Status: terms published; on-chain registration in progress. The agreement address and registration transaction will be listed here once
          registered. The rescue reward is not a bug bounty — it only applies when a whitehat rescues funds during an active exploit.
        </p>
      </TrustSection>

      <TrustSection title="Automated scans">
        <p className="mb-3 text-[13px] text-white/55">Last checked Nov 18, 2026 — re-checked weekly.</p>
        {SCAN_RESULTS.length === 0 ? (
          <p>
            We run the free scanners that cover Robinhood Chain and publish the links here. Scanner results are being verified and will appear on
            this page as they complete. A clean scan is not an audit.
          </p>
        ) : (
          <ul className="space-y-2">
            {SCAN_RESULTS.map((s) => (
              <li key={s.scanner}>
                <strong>{s.scanner}</strong> — {s.covers}: <ExtLink href={s.url}>{s.url}</ExtLink> — {s.result}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3">
          Sourcify verification: 26 of 27 tokenized fund contracts verified — see the{' '}
          <Link href="/contracts" className="text-[#00E676] hover:underline">Contracts page</Link>.
        </p>
      </TrustSection>

      <TrustSection title="Known issues">
        <p>
          <strong>Staking factory v1 — fee recipient can freeze exits.</strong> In the v1 pool, a non-zero unstake fee is sent to the factory fee
          recipient before the staker&apos;s principal is returned. If that transfer reverts, withdraw, exit and emergencyWithdraw all revert. V1
          is legacy with a single third-party pool; the owner keeps the fee recipient set to an address the stake token will transfer to. V2 pools
          are not affected.
        </p>
        <p className="mt-3">
          <strong>Staking factory v2 (legacy) — fee-on-transfer reward tokens can freeze claims.</strong> In the legacy v2 pool, a fee-on-transfer
          reward token makes a claim near the remaining balance revert, freezing rewards. No live impact: all live pools on the legacy v2 factory
          use POLYDASH as both stake and reward token. Fixed in the current factory (
          <ExtLink href="https://robinhoodchain.blockscout.com/address/0x4C87aff7009DE1c58E052FEe202349a10b28Be9c">
            0x4C87aff7009DE1c58E052FEe202349a10b28Be9c
          </ExtLink>
          ), which new pools use. Full detail in <ExtLink href={SECURITY_MD_URL}>SECURITY.md</ExtLink>.
        </p>
      </TrustSection>

      <TrustSection title="Active-exploit emergency">
        <p>
          If an exploit is happening right now, contact SEAL 911: <ExtLink href="https://t.me/seal_911_bot">t.me/seal_911_bot</ExtLink> (free
          24/7 emergency triage).
        </p>
      </TrustSection>

      <p className="border-t border-white/10 pt-6 text-sm text-white/60">
        Contracts are unaudited. Automated scans are not audits. Not financial advice.
      </p>
    </TrustShell>
  );
}
