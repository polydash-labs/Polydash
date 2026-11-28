/**
 * Polypad Skills over MCP (SEP-2640, extension `io.modelcontextprotocol/skills`).
 *
 * A skill is a workflow doc: SKILL.md-style frontmatter (name + description)
 * plus Markdown instructions naming the exact MCP tool sequence for a job.
 * Skills are served over the existing Resources primitive:
 *   - `skills/list` enumerates them (uri + frontmatter + file manifest with
 *     SHA-256 digests and byte sizes, so a host can approve and verify)
 *   - `skills/get` returns one entry by URI
 *   - `resources/read` serves the file bytes; `resources/directory/read`
 *     lists a skill directory's children
 *
 * Source of truth: this module. Skill text lives here as data (not on disk)
 * so the bytes served are byte-identical to the manifest digests, and so a
 * tool rename cannot silently drift the docs away from the live tool list:
 * scripts/test-mcp-skills.mjs asserts every tool name cited in a skill body
 * exists in tools/list. If you rename a tool, update the skill bodies and
 * re-run that script.
 *
 * Non-custodial rule (stated in every skill): a skill guides the workflow,
 * it cannot sign. Every prepare_* tool returns an unsigned transaction, a
 * plain summary, and a signing link; the spend only happens when the human
 * signs in their own wallet.
 *
 * No staking skill: there is no staking tool in the 27-tool registry, so a
 * "stake POLYDASH" skill would have no tool sequence to name. It stays out
 * until a prepare_stake tool exists.
 */
import { createHash } from 'node:crypto';

export type SkillDef = { name: string; description: string; body: string };

const NON_CUSTODIAL = `Non-custodial rule (applies to every step): Polypad never holds or accepts private keys or seed phrases. Every prepare_* tool returns an unsigned transaction, a plain summary, and a signing link — never a signed transaction. Show the user the summary (what they pay, minimum they receive, fees, risks) BEFORE the signing link. The spend only happens when the human signs in their own wallet. A skill guides the workflow; it cannot sign, move funds, or approve anything on the user's behalf. If a step needs the user's wallet address, ask for the 0x address, or have them connect once on polypad.family/sign?connect=1 and pass the wallet token instead.`;

const APPROVAL = `Approval: if you call a prepare tool as an MCP Task, Polypad pauses for human approval (elicitation) before preparing the transaction — the task reports input_required with the exact spend to approve. Nothing is prepared until the human approves, and nothing moves until the human signs.`;

export const SKILLS: SkillDef[] = [
  {
    name: 'launch-token',
    description: 'Launch a new token on Polypad (Robinhood Chain): gather the token details, prepare the launch transaction, and track it to confirmation.',
    body: `Use when the user wants to launch a new token on Polypad (Robinhood Chain, chain 4663).

1. Gather the required fields. Ask for anything missing — do not invent values:
   - name (up to 64 bytes), symbol (ticker, up to 32 bytes)
   - imageUri: an https:// or ipfs:// logo — required
   - description (up to 2000 characters)
   - creatorFeeBps: creator fee in basis points, 0 to 500 — REQUIRED, 0 means 0%
   - Optional: devBuyEth (an optional buy at launch), launchDelay (seconds before trading opens, 0 to 2592000), socialLinks (up to 8 https:// links), repository (https://github.com/owner/repo), agentMark (agent-launched label, default true)
   If the request is plain language ("launch a memecoin called..."), call polypad_intent first with the text to parse it into these fields.
2. Call polypad_prepare_token_launch with from (the wallet address that will sign) and the fields above.
3. Show the user the summary FIRST — what they pay (gas, plus any optional dev buy), what they get, the agent-launched label — then the signing link.
4. After the user signs, call polypad_get_tx_status with the returned transaction hash to confirm it landed, and share the token page and explorer link from the result.

${NON_CUSTODIAL}

${APPROVAL}`,
  },
  {
    name: 'create-fund',
    description: 'Create a tokenized fund on Polypad: pick a strategy template, prepare the fund creation, and mint the manager’s skin shares so public minting can open.',
    body: `Use when the user wants to create a tokenized fund on Polypad.

1. Call polypad_list_fund_templates to show the published strategy templates: allowed assets, position and trade caps, performance fee, drawdown brake, and manager lock. Help the user pick one.
2. If the user names assets instead of a template, match them against the template list. If no template can hold those assets, say so honestly — do not invent a template.
3. Call polypad_prepare_fund_create with from (the signing wallet), name (up to 64 bytes), symbol (up to 16 bytes), and either templateId or assets, plus mintPriceEth (price per share), raiseCapEth, raiseDurationDays (1 to 30, default 7), entryFeeBps (0 to 500, default 0), minSkinBps (0 means the 5% default), imageUri, and factory (phase6 is the default).
4. Show the user the summary FIRST, then the signing link. After the user signs, the fund exists.
5. The manager must mint skin FIRST: call polypad_prepare_fund_mint with from, fund (the new fund address), and quantity equal to the required skin shares. Public minting stays closed until the manager’s skin is in — nobody else can invest before that.
6. Call polypad_get_fund to confirm: status raising, publicMintOpen true, and the raise progress. Share the fund page (polypad.family/funds/<address>).

Notes: the raise cap is mint price times max supply. A fund is not a promise of returns — never promise returns or dividends. The 2-day public wait applies to asset proposals inside a fund, not to creating the fund.

${NON_CUSTODIAL}

${APPROVAL}`,
  },
  {
    name: 'propose-fund-asset',
    description: 'Propose a new asset for a tokenized fund and track its 2-day public wait: check the fund and its rules, submit the proposal on the fund page, and watch the countdown.',
    body: `Use when a fund manager wants to propose a new asset for their tokenized fund, or when anyone wants to follow such a proposal through its 2-day public wait.

1. Find the fund: call polypad_list_funds (search by name, symbol, or address) and polypad_get_fund to read its status, template rules, current assets, manager, and fees. Only the fund’s MANAGER can propose an asset — if the user is not the manager, say so and stop.
2. Check the asset fits: it must be allowlisted and fit the template (per-asset cap 30%; Robinhood Chain only). If it does not fit, say so honestly.
3. The proposal itself is submitted on the fund’s page at polypad.family/funds/<address> by the manager, with a thesis of at most 3 lines. No MCP tool submits a proposal — do not claim otherwise.
4. The 2-day public wait starts when the proposal is submitted. During the wait, holders see the thesis on the fund page and can exit any time.
5. Track the wait: call polypad_get_fund to read the fund’s current assets and status. Run that call as an MCP Task to watch the fund until its state changes — the task completes when the wait ends and the asset is live in the fund.
6. After the wait and execution, the fund can buy the asset. Holders invest with polypad_prepare_fund_mint.

Notes: removing an asset blocks buys, never sells. A proposal is public — the thesis, the wait, and the countdown are visible to every holder.

${NON_CUSTODIAL}

${APPROVAL}`,
  },
  {
    name: 'check-fund-nav',
    description: 'Check a tokenized fund’s raise, NAV per share, and holdings — read-only, no wallet and no signing needed.',
    body: `Use when anyone wants to check a tokenized fund’s raise, NAV per share, or holdings. Read-only — no wallet and no signing needed.

1. Call polypad_list_funds to find funds: open=true for live raises, q to search by name or symbol, sort by newest, raise_progress, deadline, or shares.
2. Call polypad_get_fund for the fund: status, raise progress, price per share, netValuePerShareDisplay (NAV per share), assets held, fees, whether public minting is open, and the fund page link.
3. For a holder’s own position, call polypad_portfolio with their wallet address: fund shares with net value, alongside ETH, tokens, and NFTs.

Notes: NAV per share can be null before investing starts. Figures on the page are readings from on-chain data, not forecasts and not promises of returns. Nothing here signs or moves funds.

${NON_CUSTODIAL}`,
  },
  {
    name: 'buy-token',
    description: 'Buy a launch token with ETH on Polypad: check the token, quote the buy, prepare the transaction, and track it to confirmation.',
    body: `Use when the user wants to buy a launch token with ETH on Polypad.

1. Call polypad_get_token with the symbol, name, or token address to check the token: price reading, bonding-curve progress, creator, and fees. Optionally call polypad_token_protections for a plain-language read of the token’s on-chain protections (liquidity, fees, creator holdings, staking pool, vesting lock, bond).
2. Call polypad_quote_trade with token, side "buy", and amountEth (or amount in wei) to get the expected output, the minimum after slippage, and the fees. A quote is a reading, not a promise.
3. Call polypad_prepare_buy with token, from (the signing wallet), amountEth, and slippageBps if the user wants a custom limit. For large amounts, confirm the amount with the user first.
4. Show the user the summary FIRST — what they pay, minimum they receive, fees, risks — then the signing link.
5. After the user signs, call polypad_get_tx_status with the transaction hash to confirm it landed.

Notes: reads are free. The buy is simulated on-chain before the unsigned transaction is returned. If the quote and the prepare disagree, trust the prepare — it is the simulated result.

${NON_CUSTODIAL}

${APPROVAL}`,
  },
];

/** The SKILL.md text for a skill: YAML frontmatter (name + description) + body. */
export function skillMd(skill: SkillDef): string {
  const q = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return `---\nname: ${q(skill.name)}\ndescription: ${q(skill.description)}\n---\n\n${skill.body}\n`;
}

export function skillUri(skill: SkillDef): string {
  return `skill://${skill.name}/SKILL.md`;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export type SkillFileEntry = { uri: string; sha256: string; size: number };
export type SkillEntry = {
  uri: string;
  frontmatter: { name: string; description: string };
  resources: SkillFileEntry[];
};

/** The complete skills/list + skills/get entry for a skill. The manifest is computed from the exact bytes served. */
export function skillEntry(skill: SkillDef): SkillEntry {
  const text = skillMd(skill);
  return {
    uri: skillUri(skill),
    frontmatter: { name: skill.name, description: skill.description },
    resources: [{ uri: skillUri(skill), sha256: sha256Hex(text), size: Buffer.byteLength(text, 'utf8') }],
  };
}

export function findSkillByUri(uri: string): SkillDef | null {
  return SKILLS.find((s) => skillUri(s) === uri) ?? null;
}

/** List-caching hints (SEP-2549): skill content is public documentation, fresh for 1h. */
export const SKILL_TTL_MS = 3600_000;
export const SKILL_CACHE_SCOPE = 'public' as const;
