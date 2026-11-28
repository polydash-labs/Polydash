import Image from 'next/image';
import Link from 'next/link';

/* Cap-proof demo page — Mason's #3. Same dark commercial card system as
 * the Agent security page: a dark hero card, one big number, plain
 * language, itemized rows, big pill buttons. All demo facts are real
 * on-chain results from Nov 26, 2026 (Robinhood Chain 4663) — see the
 * receipts. Dollar figures use ETH at $1,702.88 (CoinGecko, Nov 26, 2026). */

const EXPLORER = 'https://robinhoodchain.blockscout.com';
const sourcify = (addr: string) => `https://repo.sourcify.dev/4663/${addr}`;
const tx = (hash: string) => `${EXPLORER}/tx/${hash}`;
const addr = (a: string) => `${EXPLORER}/address/${a}`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const card =
  'rounded-[20px] border border-white/10 bg-[#151a1f] p-4 text-white shadow-[0_16px_40px_rgba(0,0,0,0.4)] sm:p-5';
const darkCard = 'rounded-2xl border border-white/10 bg-white/[0.03]';
const sectionTitle = 'text-[18px] font-semibold text-white';
const row = 'flex items-center justify-between gap-3 rounded-xl bg-white/[0.05] px-3.5 py-2.5';
const greenPill =
  'inline-flex items-center justify-center rounded-full bg-polydash-green px-5 py-3 text-[14px] font-semibold text-black transition-colors hover:bg-polydash-green-light';
const grayPill =
  'inline-flex items-center justify-center rounded-full border border-white/15 bg-white/[0.04] px-5 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-white/[0.08]';
const monoLink = 'font-mono text-[12px] text-[#00E676] hover:underline break-all';

const DEMO = {
  wallet: '0xE36AF524B15AD3e6F321EC76B1f7cBd52e7c5FB1',
  agentKey: '0x7B907f99F9b0Ad311864970C4c3AB9473aeD577c',
  owner: '0x9a21c75aC263cC43125E70200636f6397f8776d0',
  module: '0xB8A927dfd18D87f5a041706b14424CBBA59Db270',
  factory: '0x944E225D5f53c25aa4C019CFD9B42f0a40b9AC22',
  agent4337: '0x49F49C72FE7B3A7EE418c5936Bd84af2dB57c8E5',
  paymaster: '0x03db6aaf03CAb9B4DA5fc27BF3C20fAC333e86EA',
  safeSingleton: '0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552',
  entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  identity: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  reputation: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
  createTx: '0xb2ee7942aca5d18fdfa0c8b5ed0975126b2a88824fa9c05955ac21855b0e67c3',
  fundTx: '0x194b5b9b34c658c86cb581583570c14c0d7e1c5430bbe6d0b73df04d5a4b2912',
  overCapTx: '0x2af919d38bb15cb3539cee7c5e506a5afc6faf2b7b502e69d01d08447e275b90',
  withinCapTx: '0x0bf813f9b18e6d2d0f8615a7088fd0e40b64e0c6dd95b7850e19e3d01d12b383',
};

const CONTRACTS: { name: string; address: string; role: string; note?: string }[] = [
  { name: 'SessionKeyModuleV2', address: DEMO.module, role: 'Checks every spend against the cap — the enforcer' },
  { name: 'WalletFactoryV2', address: DEMO.factory, role: 'Creates wallets with their policy attached' },
  { name: 'Agent4337Module', address: DEMO.agent4337, role: 'Lets the agent pay gas through ERC-4337' },
  { name: 'Paymaster', address: DEMO.paymaster, role: 'Sponsors gas for agent transactions', note: 'Inactive and unfunded — do not fund it.' },
  { name: 'Safe singleton v1.3.0', address: DEMO.safeSingleton, role: 'The wallet code itself' },
  { name: 'EntryPoint v0.7', address: DEMO.entryPoint, role: 'The ERC-4337 entry point' },
  { name: 'ERC-8004 Identity', address: DEMO.identity, role: 'The wallet’s on-chain identity' },
  { name: 'ERC-8004 Reputation', address: DEMO.reputation, role: 'The wallet’s on-chain reputation' },
];

export function CapProofContent() {
  return (
    <div className="mx-auto max-w-container px-5 py-8 sm:px-8">
      <h1 className="text-[22px] font-semibold tracking-tight text-white sm:text-[28px]">
        An allowance, not your keys.
      </h1>
      <p className="mt-2 max-w-[640px] text-[13px] leading-relaxed text-white/55">
        An AI agent with a wallet sounds risky — what stops it from draining the wallet? On Polypad,
        the answer is a number written into a smart contract: a daily allowance the agent cannot
        exceed, no matter what it tries. We proved it on-chain. We built a real wallet, gave its
        agent an allowance of 0.00005 ETH a day — about 9 cents — then told the agent to spend
        double. The chain said no. Then we told it to spend exactly its allowance. That went
        through. Both attempts are public transactions below — check them yourself.
      </p>

      {/* Dark hero card — one big number as the hero. */}
      <div className={`${card} mt-6`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Image src="/polydash-logo-200.png" alt="Polypad" width={30} height={30} className="h-[30px] w-[30px]" />
            <span className="text-[19px] font-bold tracking-tight">Polypad</span>
          </div>
          <span className="rounded-full bg-[#00E676]/15 px-2.5 py-1 text-[11px] font-semibold text-[#00E676]">
            Proven on-chain
          </span>
        </div>

        <p className="mt-6 text-center text-[40px] font-extrabold leading-none tracking-tight sm:text-[52px]">
          0.00005 ETH
        </p>
        <p className="mt-3 text-center text-[15px] leading-relaxed text-white/50">
          the daily allowance we gave the agent — about 9 cents. It tried to spend double.
          The chain stopped it.
        </p>

        <div className="mt-6 space-y-2">
          <div className={row}>
            <div>
              <p className="text-[15px] font-semibold leading-tight">Agent tries to spend 0.0001 ETH — twice its allowance</p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                Transaction reverted on-chain with CapExceeded — nothing moved
              </p>
            </div>
            <p className="flex-none text-right text-[15px] font-bold leading-tight text-[#00E676]">Blocked</p>
          </div>
          <div className={row}>
            <div>
              <p className="text-[15px] font-semibold leading-tight">Agent spends 0.00005 ETH — exactly its allowance</p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                The cap check passed and the money moved to the owner
              </p>
            </div>
            <p className="flex-none text-right text-[15px] font-bold leading-tight text-[#00E676]">Went through</p>
          </div>
          <div className={row}>
            <div>
              <p className="text-[15px] font-semibold leading-tight">Most the agent could ever take in a day</p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                The cap is the only bound — one payment may use the full daily allowance
              </p>
            </div>
            <p className="flex-none text-right text-[15px] font-bold leading-tight">0.00005 ETH</p>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
          <Link href="/agents/wallets/new" className={`${greenPill} flex-1`}>
            Create your agent wallet
          </Link>
          <Link href="/agents/security" className={`${grayPill} flex-1`}>
            How agent security works
          </Link>
        </div>
      </div>

      <h2 className={`${sectionTitle} mt-10`}>The demo, step by step</h2>
      <p className="mt-2 max-w-[640px] text-[13px] leading-relaxed text-white/55">
        Demo ran Nov 26, 2026 on Robinhood Chain (chain 4663). Every step below is a real
        transaction — click any hash to see it on the explorer.
      </p>

      <div className="mt-4 space-y-4">
        <div className={darkCard + ' p-4 sm:p-5'}>
          <p className="text-[15px] font-semibold text-white">1. We created a real wallet</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-white/55">
            A Safe smart-contract wallet, made by WalletFactoryV2 with the v2 session-key module
            enabled. Owner: the deployer. Agent key: a throwaway made for this demo. Daily caps:
            0.00005 ETH and $1.00 in USDG. Allowed to send to: the owner only. Expires Feb 24, 2027.
          </p>
          <p className="mt-3 text-[12.5px] text-white/50">
            Wallet:{' '}
            <a className={monoLink} href={addr(DEMO.wallet)} target="_blank" rel="noopener noreferrer">
              {DEMO.wallet}
            </a>
          </p>
          <p className="mt-1.5 text-[12.5px] text-white/50">
            Create transaction (block 123747210, gas 1,206,888):{' '}
            <a className={monoLink} href={tx(DEMO.createTx)} target="_blank" rel="noopener noreferrer">
              {short(DEMO.createTx)}
            </a>
          </p>
        </div>

        <div className={darkCard + ' p-4 sm:p-5'}>
          <p className="text-[15px] font-semibold text-white">2. We funded it with 0.0001 ETH</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-white/55">
            About 17 cents — deliberately more than the double-spend attempt, so the only reason
            the attempt could fail was the cap, not an empty wallet.
          </p>
          <p className="mt-3 text-[12.5px] text-white/50">
            Fund transaction (block 123747217):{' '}
            <a className={monoLink} href={tx(DEMO.fundTx)} target="_blank" rel="noopener noreferrer">
              {short(DEMO.fundTx)}
            </a>
          </p>
        </div>

        <div className={darkCard + ' p-4 sm:p-5'}>
          <p className="text-[15px] font-semibold text-white">3. The agent tried to spend double — the chain said no</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-white/55">
            The agent key called the wallet to send 0.0001 ETH to the owner. The session-key module
            checked the daily cap on-chain first and reverted with <span className="font-mono text-[12.5px] text-white">CapExceeded</span>.
            The transaction failed, nothing moved, and the wallet still held 0.0001 ETH. A reverted
            transaction still costs gas — this one cost 0.0000009 ETH. The chain charges for the
            attempt even when it says no.
          </p>
          <p className="mt-3 text-[12.5px] text-white/50">
            Reverted transaction (block 123747238, gas 45,197, revert data{' '}
            <span className="font-mono text-[12px] text-white">0xa4875a49</span>):{' '}
            <a className={monoLink} href={tx(DEMO.overCapTx)} target="_blank" rel="noopener noreferrer">
              {short(DEMO.overCapTx)}
            </a>
          </p>
        </div>

        <div className={darkCard + ' p-4 sm:p-5'}>
          <p className="text-[15px] font-semibold text-white">4. The agent spent exactly its allowance — it went through</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-white/55">
            Same agent, same wallet, 0.00005 ETH. The module checked the cap, it fit, and the money
            moved to the owner. Afterward the wallet held 0.00005 ETH and the day&apos;s spent total
            read 0.00005 ETH — the allowance, used exactly once.
          </p>
          <p className="mt-3 text-[12.5px] text-white/50">
            Successful transaction (block 123747249, gas 109,143):{' '}
            <a className={monoLink} href={tx(DEMO.withinCapTx)} target="_blank" rel="noopener noreferrer">
              {short(DEMO.withinCapTx)}
            </a>
          </p>
        </div>
      </div>

      <h2 className={`${sectionTitle} mt-10`}>How the cap actually works</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className={darkCard + ' p-4 sm:p-5'}>
          <p className="text-[15px] font-semibold text-white">The money lives in a contract, not an account</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-white/55">
            The wallet is a Safe (v1.3.0) — audited smart-contract wallet code. The agent never
            holds the money. It only holds a session key that can ask the contract to pay.
          </p>
        </div>
        <div className={darkCard + ' p-4 sm:p-5'}>
          <p className="text-[15px] font-semibold text-white">The rules live in the contract, not in an app</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-white/55">
            SessionKeyModuleV2 checks every spend on-chain, before the money moves: is the key
            still active and unexpired? Is the destination on the allowlist? Does the amount fit
            the day&apos;s remaining allowance? If any answer is no, the transaction reverts and
            nothing moves. There is no API to bypass and no promise to trust.
          </p>
        </div>
        <div className={darkCard + ' p-4 sm:p-5'}>
          <p className="text-[15px] font-semibold text-white">You pick the allowance</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-white/55">
            $1 to $5,000 a day in USDG — or a per-token cap in the token&apos;s own units (ETH in
            wei). One payment can use the full daily cap. Caps reset at midnight UTC.
          </p>
        </div>
        <div className={darkCard + ' p-4 sm:p-5'}>
          <p className="text-[15px] font-semibold text-white">You can stop it instantly</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-white/55">
            Freeze the wallet, revoke the key, or swap in a new key — all immediate, all yours.
            If your own key is lost, a backup key plus a two-day wait recovers the wallet.
          </p>
        </div>
        <div className={darkCard + ' p-4 sm:p-5 md:col-span-2'}>
          <p className="text-[15px] font-semibold text-white">Every move leaves a receipt</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-white/55">
            Each attempt is a public transaction with a hash anyone can check — including the failed
            one. That is the point of this page: the proof is the transaction, not our word for it.
          </p>
        </div>
      </div>

      <h2 className={`${sectionTitle} mt-10`}>The contracts</h2>
      <p className="mt-2 max-w-[640px] text-[13px] leading-relaxed text-white/55">
        All verified on Sourcify (exact match). Click a name to read the source.
      </p>
      <div className="mt-4 space-y-2">
        {CONTRACTS.map((c) => (
          <div key={c.address} className={row}>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold leading-tight">
                <a className="text-white hover:underline" href={sourcify(c.address)} target="_blank" rel="noopener noreferrer">
                  {c.name}
                </a>
              </p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-white/50">
                {c.role}
                {c.note ? ` — ${c.note}` : ''}
              </p>
              <p className="mt-1">
                <a className={monoLink} href={addr(c.address)} target="_blank" rel="noopener noreferrer">
                  {c.address}
                </a>
              </p>
            </div>
            <a
              className="flex-none rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-white/[0.08]"
              href={sourcify(c.address)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Source
            </a>
          </div>
        ))}
      </div>

      <h2 className={`${sectionTitle} mt-10`}>Honest notes</h2>
      <div className="mt-4 space-y-2">
        <div className={row}>
          <p className="text-[13px] leading-relaxed text-white/55">
            The demo allowance is tiny on purpose — about 9 cents a day — so you can watch the cap
            bite. Real wallets use $1 to $5,000 a day.
          </p>
        </div>
        <div className={row}>
          <p className="text-[13px] leading-relaxed text-white/55">
            Warden, Polypad&apos;s in-house audit team, reviewed these contracts on Nov 22, 2026.
            That is an internal review, not a third-party audit — the contracts have not had a
            formal third-party audit.
          </p>
        </div>
        <div className={row}>
          <p className="text-[13px] leading-relaxed text-white/55">
            The demo wallet is real and still exists, owned by the deployer. The agent key was a
            throwaway made for this demo and discarded afterward. The wallet still holds 0.00005 ETH
            (about 9 cents) of the deployer&apos;s money.
          </p>
        </div>
        <div className={row}>
          <p className="text-[13px] leading-relaxed text-white/55">
            The whole demo cost 0.0000282 ETH in gas — about 5 cents. Dollar figures use ETH at
            $1,702.88 on Nov 26, 2026.
          </p>
        </div>
      </div>

      <div className="mt-8 flex flex-col gap-2.5 sm:flex-row">
        <Link href="/agents/wallets/new" className={`${greenPill} flex-1`}>
          Create your agent wallet
        </Link>
        <Link href="/audits" className={`${grayPill} flex-1`}>
          Read the audit
        </Link>
      </div>
    </div>
  );
}
