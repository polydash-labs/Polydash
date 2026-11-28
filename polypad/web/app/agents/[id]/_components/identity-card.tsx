// "Know your agent" identity card (Scout proposal #1, Nov 24, 2026).
// Server component — every field comes from lib/agents/identity.ts, read
// live from Robinhood Chain. A field with no on-chain source renders as
// "Not published", never invented.
//
// The four sections map explicitly to MAS SAFR's four points, with the
// Agentic AI Foundation working-group term in each card's kicker:
//   1. Who this agent is (Identity)
//   2. What it can spend (Spending limits)
//   3. What it is allowed to do (Mandate / auditable consent)
//   4. Why you can believe it (Assurance / auditable consent logs)

import type { ReactNode } from 'react';
import Link from 'next/link';
import type { AgentIdentity } from '@/lib/agents/identity';
import { AgentCard, AgentCardSub, AgentCardTitle, AgentStat, PageHero } from '@/app/agents/_components/agent-cards';

const EXPLORER = 'https://robinhoodchain.blockscout.com';

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function AddrLink({ addr, label }: { addr: string; label?: string }) {
  return (
    <a
      href={`${EXPLORER}/address/${addr}`}
      target="_blank"
      rel="noreferrer"
      className="break-all font-mono text-[13px] text-[#00E676] hover:underline"
    >
      {label ?? short(addr)}
    </a>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-white/5 py-3 first:border-t-0 first:pt-0 last:pb-0 sm:grid-cols-[220px_1fr] sm:gap-4">
      <dt className="text-[13px] font-semibold text-white/60">{label}</dt>
      <dd className="text-[14px] leading-relaxed text-white/90">{children}</dd>
    </div>
  );
}

/** A field with no on-chain source. Shown as-is, never invented. */
function NotPublished({ children }: { children: ReactNode }) {
  return (
    <span>
      <span className="font-semibold text-amber-300">Not published</span>
      <span className="text-white/60"> — {children}</span>
    </span>
  );
}

function Kicker({ children }: { children: ReactNode }) {
  return (
    <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#00E676]">{children}</p>
  );
}

export function IdentityCard({ identity }: { identity: AgentIdentity }) {
  const id = identity.agentId;
  const key = identity.sessionKey;
  const activeHours =
    key && (key.activeHours.start !== 0 || key.activeHours.end !== 24)
      ? `${key.activeHours.start}:00 – ${key.activeHours.end}:00 UTC`
      : key
        ? 'Any time of day'
        : null;
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-8 sm:px-6">
      <PageHero
        title={`Know your agent: ${identity.name}`}
        lede={
          <>
            A public identity card for registered agent #{id}. Who it is, who controls it,
            what it can spend, and what its owner authorized — read live from Robinhood Chain.
            Fields with no on-chain source say so instead of guessing.
          </>
        }
      />

      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <AgentStat label="Credit score" value={identity.score ?? '—'} note={identity.scoreBand ? `${identity.scoreBand} band` : 'Not scored yet'} />
        <AgentStat label="Bond posted" value={`${Number(identity.stakePolydash).toLocaleString()} POLYDASH`} note="Staked in the registry" />
        <AgentStat label="Registered" value={fmtDate(identity.registeredAtIso)} note={identity.active ? 'Active' : 'Inactive'} />
        <AgentStat label="ERC-8004 identity" value={identity.erc8004 ? `#${identity.erc8004.agentId}` : '—'} note={identity.erc8004 ? 'Registered on-chain' : 'Not published'} />
      </div>

      {/* 1 — MAS SAFR: Identity */}
      <AgentCard className="mt-6" label="Who this agent is">
        <Kicker>1 · Identity — who this agent is, and whom it represents</Kicker>
        <AgentCardTitle>Who this agent is</AgentCardTitle>
        <AgentCardSub>
          The registry entry is the agent&apos;s public identity. The wallet is the address
          it acts from. If the wallet is a Safe, the people who control it are listed too.
        </AgentCardSub>
        <dl className="mt-5">
          <Row label="Agent name">{identity.name}</Row>
          <Row label="Agent ID">#{id} in the Polypad agent registry</Row>
          <Row label="Wallet">
            <AddrLink addr={identity.wallet} label={identity.wallet} />{' '}
            <span className="text-white/50">(the address this agent acts from)</span>
          </Row>
          <Row label="Agent account (token-bound wallet)">
            {identity.agentAccount ? (
              <>
                <AddrLink addr={identity.agentAccount} label={identity.agentAccount} />{' '}
                <span className="text-white/50">(an ERC-6551 wallet owned by the agent&apos;s NFT)</span>
              </>
            ) : (
              <NotPublished>This agent has no token-bound (ERC-6551) account yet.</NotPublished>
            )}
          </Row>
          <Row label="ERC-8004 identity">
            {identity.erc8004 ? (
              <>
                Agent #{identity.erc8004.agentId} ·{' '}
                <a href={identity.erc8004.agentURI} target="_blank" rel="noreferrer" className="break-all text-[#00E676] hover:underline">
                  {identity.erc8004.agentURI}
                </a>{' '}
                <span className="text-white/50">(the agent&apos;s public identity record)</span>
              </>
            ) : (
              <NotPublished>
                This wallet has no ERC-8004 identity registered. A merchant checking this agent
                can&apos;t confirm its public identity record yet.
              </NotPublished>
            )}
          </Row>
          <Row label="Controlled by">
            {identity.controlledBy ? (
              <>
                {identity.controlledBy.map((o) => (
                  <span key={o} className="mr-3">
                    <AddrLink addr={o} />
                  </span>
                ))}{' '}
                <span className="text-white/50">(the owners of this agent&apos;s Safe wallet)</span>
              </>
            ) : (
              <NotPublished>
                This agent runs from a plain wallet, not a Safe, so there is no on-chain owner
                list. Who holds the wallet&apos;s key is not published on-chain.
              </NotPublished>
            )}
          </Row>
          <Row label="Registered">{fmtDate(identity.registeredAtIso)}</Row>
          <Row label="Bond">{Number(identity.stakePolydash).toLocaleString()} POLYDASH staked in the registry</Row>
        </dl>
      </AgentCard>

      {/* 2 — MAS SAFR: Authority */}
      <AgentCard className="mt-6" label="What it can spend">
        <Kicker>2 · Authority — what it is allowed to spend</Kicker>
        <AgentCardTitle>What it can spend</AgentCardTitle>
        <AgentCardSub>
          The agent acts through a session key — a key the owner gave it with hard limits.
          The key can&apos;t spend more than its daily caps, can&apos;t spend outside its hours,
          and stops working when it expires or the owner freezes the wallet.
        </AgentCardSub>
        {key ? (
          <dl className="mt-5">
            <Row label="Session key">
              <AddrLink addr={key.key} label={key.key} />
            </Row>
            <Row label="Daily spending caps">
              {key.tokens.length > 0 ? (
                <ul className="space-y-1">
                  {key.tokens.map((t) => (
                    <li key={t.address}>
                      <span className="font-semibold">{Number(t.dailyCapFormatted).toLocaleString()} {t.symbol}</span>
                      {' '}per day · <AddrLink addr={t.address} />
                    </li>
                  ))}
                </ul>
              ) : (
                'No token caps set on this key.'
              )}
            </Row>
            <Row label="Active hours">{activeHours}</Row>
            <Row label="Key expires">{fmtDate(key.expiryIso)}</Row>
            <Row label="Emergency stop">
              {key.frozen ? (
                <span className="font-semibold text-red-400">Frozen — this wallet is stopped right now.</span>
              ) : (
                <span>
                  <span className="font-semibold text-[#00E676]">Not frozen.</span>{' '}
                  The owner can freeze the wallet at any time, which stops the key immediately.
                  The owner can also revoke the key, or start a 2-day owner change.
                </span>
              )}
            </Row>
            <Row label="Key active right now">{key.isActive ? 'Yes — inside its hours and not expired.' : 'No — outside its hours, expired, or frozen.'}</Row>
            <Row label="Backup key">
              {key.backupKey ? (
                <span>
                  Set — <AddrLink addr={key.backupKey} /> <span className="text-white/50">(can recover the wallet after the 2-day wait)</span>
                </span>
              ) : (
                <NotPublished>No backup key is set on this wallet.</NotPublished>
              )}
            </Row>
          </dl>
        ) : (
          <p className="mt-5 text-[14px] leading-relaxed text-white/80">
            <NotPublished>
              No session-key policy was found for this wallet on the v2 module. This agent
              either runs from a plain wallet with no published key, or from a v1 wallet —
              v1 keys don&apos;t publish their policy on-chain, so their limits can&apos;t be
              shown here. The agent&apos;s own wallet page shows what it can do.
            </NotPublished>
          </p>
        )}
      </AgentCard>

      {/* 3 — MAS SAFR: Mandate */}
      <AgentCard className="mt-6" label="What it is allowed to do">
        <Kicker>3 · Mandate — what it is allowed to do</Kicker>
        <AgentCardTitle>What it is allowed to do</AgentCardTitle>
        <AgentCardSub>
          The agent&apos;s mandate is what its owner authorized it to do — the limits above,
          plus any tokenized fund it manages. Nothing outside the mandate is authorized.
        </AgentCardSub>
        <dl className="mt-5">
          <Row label="Tokenized funds it manages">
            {identity.fundsManaged.length > 0 ? (
              <ul className="space-y-1">
                {identity.fundsManaged.map((f) => (
                  <li key={f.address}>
                    <Link href={`/funds/${f.address}`} className="font-semibold text-[#00E676] hover:underline">
                      {f.name} ({f.symbol})
                    </Link>{' '}
                    <span className="text-white/50">· manager</span>
                  </li>
                ))}
              </ul>
            ) : identity.fundsChecked ? (
              <NotPublished>This agent does not manage any tokenized fund on Polypad.</NotPublished>
            ) : (
              <span className="text-white/60">Could not be read right now — the funds list was unavailable.</span>
            )}
          </Row>
          <Row label="The mandate, in plain words">
            {key ? (
              <>
                This agent may act through its session key only within the caps, hours, and
                expiry in section 2 above. It may not spend above its daily caps, act outside
                its hours, or spend tokens that aren&apos;t on its list.
              </>
            ) : (
              <>
                No on-chain mandate is published for this agent. Its authority, if any, is not
                recorded in a form this card can read.
              </>
            )}
          </Row>
          <Row label="How consent is recorded">
            Every action this agent takes under its key is checked against the policy on-chain
            before it executes. Receipts for its actions are published at{' '}
            <Link href="/agents/receipts" className="text-[#00E676] hover:underline">
              /agents/receipts
            </Link>
            , showing the authorization it acted under, the action, and the settlement.
          </Row>
        </dl>
      </AgentCard>

      {/* 4 — MAS SAFR: Assurance */}
      <AgentCard className="mt-6" label="Why you can believe it">
        <Kicker>4 · Assurance — why you can believe it</Kicker>
        <AgentCardTitle>Why you can believe it</AgentCardTitle>
        <AgentCardSub>
          The credit score is computed on-chain from five components, and the exact inputs
          are hashed into the score record — so anyone can check that the published score
          matches the published inputs. The bond backs it up: 1,000 POLYDASH is staked.
        </AgentCardSub>
        {identity.scored && identity.scoreComponents ? (
          <dl className="mt-5">
            <Row label="Credit score">
              <span className="font-semibold">{identity.score}</span> · {identity.scoreBand} band
            </Row>
            <Row label="Score components (0–1000 each)">
              Performance {identity.scoreComponents.performance} · History {identity.scoreComponents.history} ·{' '}
              Activity {identity.scoreComponents.activity} · Stake {identity.scoreComponents.stake} · Conduct{' '}
              {identity.scoreComponents.conduct}
            </Row>
            <Row label="Inputs hash">
              <span className="break-all font-mono text-[13px]">{identity.scoreInputsHash}</span>{' '}
              <span className="text-white/50">(binds the score to its exact inputs)</span>
            </Row>
            <Row label="Score last updated">
              {identity.scoreUpdatedAt ? fmtDate(new Date(identity.scoreUpdatedAt * 1000).toISOString()) : '—'}
            </Row>
          </dl>
        ) : (
          <p className="mt-5 text-[14px] leading-relaxed text-white/80">
            <NotPublished>This agent has no credit score posted yet.</NotPublished>
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/agents/scores" className="rounded-full border border-white/15 px-4 py-2 text-[13px] font-semibold hover:border-[#00E676] hover:text-[#00E676]">
            All agent scores →
          </Link>
          <Link href="/agents/receipts" className="rounded-full border border-white/15 px-4 py-2 text-[13px] font-semibold hover:border-[#00E676] hover:text-[#00E676]">
            Verifiable receipts →
          </Link>
          <a href={`${EXPLORER}/address/${identity.wallet}`} target="_blank" rel="noreferrer" className="rounded-full border border-white/15 px-4 py-2 text-[13px] font-semibold hover:border-[#00E676] hover:text-[#00E676]">
            Wallet on the explorer ↗
          </a>
        </div>
      </AgentCard>

      {/* Machine-readable */}
      <AgentCard className="mt-6" label="Machine-readable identity">
        <Kicker>For websites and merchants</Kicker>
        <AgentCardTitle>Machine-readable identity</AgentCardTitle>
        <AgentCardSub>
          If this agent calls your website, fetch the same identity as JSON — so you know
          which agent is calling and who stands behind it, before you let it in.
        </AgentCardSub>
        <p className="mt-4 break-all rounded-[12px] bg-black/40 px-4 py-3 font-mono text-[13px] text-[#00E676]">
          GET https://polypad.family/api/agents/{id}/identity
        </p>
        <p className="mt-3 text-[13px] text-white/50">
          Same fields as this card. Cached for 60 seconds. No API key needed.
        </p>
      </AgentCard>

      <p className="mt-6 text-[12.5px] leading-relaxed text-white/40">
        This card reads live on-chain data from Robinhood Chain — it is not a guarantee of
        how the agent will behave. Fields marked &ldquo;Not published&rdquo; have no on-chain
        source; they are not hidden, they simply aren&apos;t recorded on-chain yet. The
        ERC-8004 identity scan covers blocks from {Number(identity.identityScanFromBlock).toLocaleString()} onward.
        Identity generated {new Date(identity.generatedAt).toLocaleString('en-US')}.
      </p>
    </div>
  );
}
