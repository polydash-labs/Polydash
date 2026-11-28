// Verifier for Polypad agent action receipts (format polypad.agent-receipt/1).
//
// A third party needs only the receipt JSON and a public Robinhood Chain RPC
// (no key, no private data). Every claimed fact is re-read on-chain and
// reported pass/fail per field, plus an overall verdict.
//
// Two viem 2.58 quirks this code works around (documented in
// docs/agent-receipts.md):
//  - readContract mis-decodes struct returns that contain a dynamic string
//    (AgentRegistry.getAgent). The verifier reads the raw return data with
//    client.call and decodes the tuple explicitly with decodeAbiParameters.
//  - readContract returns multi-output results positionally, not by name.
//    The verifier maps tuple positions to names explicitly.

import {
  createPublicClient,
  decodeAbiParameters,
  decodeEventLog,
  decodeFunctionData,
  encodeFunctionData,
  http,
  parseAbiParameters,
  type PublicClient,
} from 'viem';
import type { AgentReceipt } from './types';
import { isAgentScorePostedReceipt, isAllowlistExecutedReceipt } from './types';
import {
  AGENT_REGISTRY_ADDRESS,
  AGENT_SCORE_ADDRESS,
  FUND_ALLOWLIST_ADDRESS,
  REGISTRATION_STAKE,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_RPC_URL,
  agentRegistryVerifierAbi,
  agentScoreVerifierAbi,
  agentTupleAbiParameters,
  allowlistCallAbi,
  fundAllowlistVerifierAbi,
  getAgentCallAbi,
  receiptEventsAbi,
  scorePostedCallAbi,
} from './receipts-abi';

export type CheckStatus = 'pass' | 'fail' | 'skip';
export type CheckSection = 'format' | 'identity' | 'authority' | 'approval' | 'settlement' | 'intent';

export interface ReceiptCheck {
  id: string;
  section: CheckSection;
  label: string;
  status: CheckStatus;
  expected?: string;
  actual?: string;
  detail?: string;
}

export interface VerificationResult {
  receiptId: string;
  actionType: string;
  verdict: 'verified' | 'failed' | 'incomplete';
  checks: ReceiptCheck[];
  checkedAt: string;
  rpcUrl: string;
}

const DISCLAIMER =
  'This receipt records what happened on-chain. It is not a guarantee, reimbursement, or insurance promise.';

const eqAddr = (a?: string, b?: string) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

function check(
  id: string,
  section: CheckSection,
  label: string,
  ok: boolean,
  expected?: string,
  actual?: string,
  detail?: string,
): ReceiptCheck {
  return { id, section, label, status: ok ? 'pass' : 'fail', expected, actual, detail };
}

function skipped(id: string, section: CheckSection, label: string, detail: string): ReceiptCheck {
  return { id, section, label, status: 'skip', detail };
}

async function readAgent(client: PublicClient, agentId: number) {
  const raw = await client.call({
    to: AGENT_REGISTRY_ADDRESS,
    data: encodeFunctionData({
      abi: getAgentCallAbi,
      functionName: 'getAgent',
      args: [BigInt(agentId)],
    }),
  });
  const [agent] = decodeAbiParameters(parseAbiParameters([agentTupleAbiParameters]), raw.data as `0x${string}`);
  return {
    wallet: agent.wallet as string,
    agentAccount: agent.agentAccount as string,
    name: agent.name as string,
    stake: agent.stake as bigint,
    registeredAt: agent.registeredAt as bigint,
    active: agent.active as boolean,
  };
}

async function readScore(client: PublicClient, agentId: number) {
  const r = await client.readContract({
    address: AGENT_SCORE_ADDRESS,
    abi: agentScoreVerifierAbi,
    functionName: 'getScore',
    args: [BigInt(agentId)],
  });
  // Positional: [score, performance, history, activity, stake, conduct, updatedAt, inputsHash, exists]
  return {
    score: r[0],
    performance: r[1],
    history: r[2],
    activity: r[3],
    stake: r[4],
    conduct: r[5],
    updatedAt: r[6],
    inputsHash: r[7],
    exists: r[8],
  };
}

async function readProposal(client: PublicClient, proposalId: number) {
  const r = await client.readContract({
    address: FUND_ALLOWLIST_ADDRESS,
    abi: fundAllowlistVerifierAbi,
    functionName: 'proposals',
    args: [BigInt(proposalId)],
  });
  // Positional: [target, isRouter, allowed, readyAt, executed, canceled, feed, maxStale, minPriceX18, maxPriceX18]
  return {
    target: r[0],
    isRouter: r[1],
    allowed: r[2],
    readyAt: r[3],
    executed: r[4],
    canceled: r[5],
    feed: r[6],
    maxStale: r[7],
    minPriceX18: r[8],
    maxPriceX18: r[9],
  };
}

function decodeReceiptLogs(
  logs: { data: `0x${string}`; topics: [`0x${string}`, ...`0x${string}`[]] }[],
) {
  const decoded: { eventName: string; args: Record<string, unknown> }[] = [];
  for (const log of logs) {
    try {
      const d = decodeEventLog({ abi: receiptEventsAbi, data: log.data, topics: log.topics });
      decoded.push({ eventName: d.eventName, args: d.args as Record<string, unknown> });
    } catch {
      // Not one of the receipt events; ignore.
    }
  }
  return decoded;
}

async function verifyScorePosted(
  receipt: Extract<AgentReceipt, { action: { type: 'agent-score-posted' } }>,
  client: PublicClient,
  checks: ReceiptCheck[],
) {
  const { identity, authority, approval, settlement } = receipt;
  const components = [
    approval.components.performance,
    approval.components.history,
    approval.components.activity,
    approval.components.stake,
    approval.components.conduct,
  ];

  // Identity: the agent must be registered, active, bonded, and match the receipt.
  try {
    const agent = await readAgent(client, identity.agentId);
    checks.push(
      check(
        'identity.registered',
        'identity',
        'Agent is registered, active, and matches the receipt',
        eqAddr(agent.wallet, identity.wallet) &&
          agent.name === identity.name &&
          agent.active === true &&
          agent.stake === REGISTRATION_STAKE &&
          agent.registeredAt.toString() === identity.registeredAt,
        `wallet ${identity.wallet}, name "${identity.name}", active, stake 1000 POLYDASH, registeredAt ${identity.registeredAt}`,
        `wallet ${agent.wallet}, name "${agent.name}", active=${agent.active}, stake ${agent.stake}, registeredAt ${agent.registeredAt}`,
        'Source: AgentRegistry.getAgent(agentId).',
      ),
    );
    const mapped = await client.readContract({
      address: AGENT_REGISTRY_ADDRESS,
      abi: agentRegistryVerifierAbi,
      functionName: 'agentIdByWallet',
      args: [identity.wallet as `0x${string}`],
    });
    checks.push(
      check(
        'identity.wallet-maps',
        'identity',
        'Registry maps the wallet back to this agent id',
        mapped === BigInt(identity.agentId),
        `agentId ${identity.agentId}`,
        `agentId ${mapped}`,
        'Source: AgentRegistry.agentIdByWallet(wallet).',
      ),
    );
  } catch (e) {
    checks.push(skipped('identity.registered', 'identity', 'Agent is registered, active, and matches the receipt', `Read failed: ${(e as Error).message}`));
    checks.push(skipped('identity.wallet-maps', 'identity', 'Registry maps the wallet back to this agent id', `Read failed: ${(e as Error).message}`));
  }

  // Authority: only the registered updater may post scores, and the settlement
  // transaction must have been sent by that updater.
  let updater: string | undefined;
  try {
    updater = await client.readContract({ address: AGENT_SCORE_ADDRESS, abi: agentScoreVerifierAbi, functionName: 'updater' });
    checks.push(
      check('authority.updater', 'authority', 'Registered updater matches the receipt', eqAddr(updater, authority.updater), authority.updater, updater, 'Source: AgentScore.updater().'),
    );
  } catch (e) {
    checks.push(skipped('authority.updater', 'authority', 'Registered updater matches the receipt', `Read failed: ${(e as Error).message}`));
  }

  // Approval: the score must equal the contract formula over the components,
  // and the recorded inputs hash and components must match the live state.
  try {
    const weighted = await client.readContract({
      address: AGENT_SCORE_ADDRESS,
      abi: agentScoreVerifierAbi,
      functionName: 'weightedScore',
      args: components as [number, number, number, number, number],
    });
    checks.push(
      check(
        'approval.formula',
        'approval',
        'Score equals the on-chain weightedScore of the posted components',
        weighted === approval.weightedScore && weighted === settlement.score,
        `weightedScore ${approval.weightedScore}`,
        `weightedScore ${weighted}`,
        'Source: AgentScore.weightedScore(components), recomputed on-chain.',
      ),
    );
    const live = await readScore(client, identity.agentId);
    const compsMatch =
      live.performance === components[0] &&
      live.history === components[1] &&
      live.activity === components[2] &&
      live.stake === components[3] &&
      live.conduct === components[4];
    checks.push(
      check('approval.components', 'approval', 'Posted components match the live on-chain score', compsMatch, JSON.stringify(approval.components), JSON.stringify({ performance: live.performance, history: live.history, activity: live.activity, stake: live.stake, conduct: live.conduct }), 'Source: AgentScore.getScore(agentId).'),
    );
    checks.push(
      check('approval.inputs-hash', 'approval', 'Inputs hash matches the live on-chain score', live.inputsHash.toLowerCase() === approval.inputsHash.toLowerCase(), approval.inputsHash, live.inputsHash, 'Source: AgentScore.getScore(agentId).inputsHash.'),
    );
    checks.push(
      check('settlement.state', 'settlement', 'Live score, updatedAt and exists flag match the receipt', live.score === settlement.score && live.updatedAt.toString() === settlement.updatedAt && live.exists === true, `score ${settlement.score}, updatedAt ${settlement.updatedAt}, exists`, `score ${live.score}, updatedAt ${live.updatedAt}, exists=${live.exists}`, 'Source: AgentScore.getScore(agentId).'),
    );
    const band = await client.readContract({ address: AGENT_SCORE_ADDRESS, abi: agentScoreVerifierAbi, functionName: 'bandOf', args: [BigInt(identity.agentId)] });
    checks.push(check('settlement.band', 'settlement', 'Score band matches the receipt', band === settlement.band, `band ${settlement.band}`, `band ${band}`, 'Source: AgentScore.bandOf(agentId).'));
  } catch (e) {
    for (const [id, section, label] of [
      ['approval.formula', 'approval', 'Score equals the on-chain weightedScore of the posted components'],
      ['approval.components', 'approval', 'Posted components match the live on-chain score'],
      ['approval.inputs-hash', 'approval', 'Inputs hash matches the live on-chain score'],
      ['settlement.state', 'settlement', 'Live score, updatedAt and exists flag match the receipt'],
      ['settlement.band', 'settlement', 'Score band matches the receipt'],
    ] as const) {
      checks.push(skipped(id, section, label, `Read failed: ${(e as Error).message}`));
    }
  }

  // Settlement: the transaction itself.
  try {
    const tx = await client.getTransaction({ hash: settlement.transactionHash as `0x${string}` });
    const txReceipt = await client.getTransactionReceipt({ hash: settlement.transactionHash as `0x${string}` });
    checks.push(
      check(
        'authority.sender-is-updater',
        'authority',
        'Settlement transaction was sent by the registered updater',
        !!updater && eqAddr(tx.from, updater) && eqAddr(tx.from, settlement.from),
        `from ${authority.updater}`,
        `from ${tx.from}`,
        'Source: settlement transaction sender.',
      ),
    );
    checks.push(
      check(
        'settlement.tx',
        'settlement',
        'Settlement transaction succeeded to the AgentScore contract',
        txReceipt.status === 'success' && eqAddr(tx.to ?? undefined, AGENT_SCORE_ADDRESS) && settlement.status === 1,
        `to ${AGENT_SCORE_ADDRESS}, status success`,
        `to ${tx.to}, status ${txReceipt.status}`,
        'Source: settlement transaction receipt.',
      ),
    );
    let inputOk = false;
    let inputDetail = '';
    let settlementInputsHash: string | undefined;
    try {
      const decoded = decodeFunctionData({ abi: scorePostedCallAbi, data: tx.input });
      const [aId, score, comps, hash] = decoded.args as unknown as [bigint, number, readonly number[], string];
      settlementInputsHash = hash;
      inputOk =
        decoded.functionName === 'updateScore' &&
        aId === BigInt(identity.agentId) &&
        score === settlement.score &&
        comps[0] === components[0] && comps[1] === components[1] && comps[2] === components[2] && comps[3] === components[3] && comps[4] === components[4] &&
        hash.toLowerCase() === approval.inputsHash.toLowerCase();
      inputDetail = `updateScore(agentId=${aId}, score=${score}, inputsHash=${hash})`;
    } catch (e) {
      inputDetail = `Input could not be decoded: ${(e as Error).message}`;
    }
    checks.push(check('settlement.input', 'settlement', 'Transaction input is updateScore with the receipt values', inputOk, 'updateScore(agentId, score, components, inputsHash) as in the receipt', inputDetail, 'Source: settlement transaction input data.'));
    // Intent (Nov 24, 2026): the authorization behind the receipt — the
    // registered updater, and the inputs hash recorded in the settlement
    // transaction itself. Checked against the transaction, not the live
    // score, because the score may have been re-posted since this receipt.
    const intent = receipt.intent;
    if (!intent) {
      checks.push(skipped('intent.authorization', 'intent', 'The authorization behind this receipt checks out (updater + inputs hash)', 'This receipt predates the intent field (Nov 24, 2026).'));
    } else {
      checks.push(
        check(
          'intent.authorization',
          'intent',
          'The authorization behind this receipt checks out (updater + inputs hash)',
          !!updater && eqAddr(intent.authorizedBy, updater) && intent.authorizationHashKind === 'inputs-hash' && !!settlementInputsHash && settlementInputsHash.toLowerCase() === intent.authorizationHash.toLowerCase(),
          `authorizedBy ${authority.updater}, inputs hash ${approval.inputsHash}`,
          `authorizedBy ${intent.authorizedBy}, inputs hash ${intent.authorizationHash}`,
          'Source: settlement transaction input (updateScore inputsHash) + AgentScore.updater().',
        ),
      );
    }
    const events = decodeReceiptLogs(txReceipt.logs as { data: `0x${string}`; topics: [`0x${string}`, ...`0x${string}`[]] }[]);
    const scoreEvent = events.find((ev) => ev.eventName === 'ScoreUpdated');
    const eventOk =
      !!scoreEvent &&
      scoreEvent.args.agentId === BigInt(identity.agentId) &&
      scoreEvent.args.score === settlement.score &&
      (scoreEvent.args.inputsHash as string).toLowerCase() === approval.inputsHash.toLowerCase() &&
      (scoreEvent.args.updatedAt as bigint).toString() === settlement.updatedAt;
    checks.push(
      check('settlement.event', 'settlement', 'ScoreUpdated event in the receipt matches', eventOk, `ScoreUpdated(agentId=${identity.agentId}, score=${settlement.score}, updatedAt=${settlement.updatedAt})`, scoreEvent ? `ScoreUpdated(agentId=${String(scoreEvent.args.agentId)}, score=${String(scoreEvent.args.score)}, updatedAt=${String(scoreEvent.args.updatedAt)})` : 'no ScoreUpdated event found', 'Source: logs of the settlement transaction.'),
    );
  } catch (e) {
    for (const [id, section, label] of [
      ['authority.sender-is-updater', 'authority', 'Settlement transaction was sent by the registered updater'],
      ['settlement.tx', 'settlement', 'Settlement transaction succeeded to the AgentScore contract'],
      ['settlement.input', 'settlement', 'Transaction input is updateScore with the receipt values'],
      ['intent.authorization', 'intent', 'The authorization behind this receipt checks out (updater + inputs hash)'],
      ['settlement.event', 'settlement', 'ScoreUpdated event in the receipt matches'],
    ] as const) {
      checks.push(skipped(id, section as CheckSection, label, `Read failed: ${(e as Error).message}`));
    }
  }
}

async function verifyAllowlistExecuted(
  receipt: Extract<AgentReceipt, { action: { type: 'allowlist-executed' } }>,
  client: PublicClient,
  checks: ReceiptCheck[],
) {
  const { identity, approval, settlement } = receipt;

  // Authority: execute has no caller restriction; the receipt's claim is
  // demonstrated by the fact that a non-owner address executed it successfully.
  let owner: string | undefined;
  try {
    owner = await client.readContract({ address: FUND_ALLOWLIST_ADDRESS, abi: fundAllowlistVerifierAbi, functionName: 'owner' });
    const tx = await client.getTransaction({ hash: settlement.transactionHash as `0x${string}` });
    checks.push(
      check('identity.executor', 'identity', 'Settlement transaction sender matches the receipt executor', eqAddr(tx.from, identity.executor) && eqAddr(tx.from, settlement.from), identity.executor, tx.from, 'Source: settlement transaction sender.'),
    );
    checks.push(
      check('authority.permissionless', 'authority', 'Executor was not the contract owner, yet the call succeeded', !eqAddr(tx.from, owner), `executor != owner (${owner})`, `executor ${tx.from}`, 'Source: settlement transaction sender vs FundAllowlist.owner(). execute() has no caller restriction in the contract.'),
    );
  } catch (e) {
    checks.push(skipped('identity.executor', 'identity', 'Settlement transaction sender matches the receipt executor', `Read failed: ${(e as Error).message}`));
    checks.push(skipped('authority.permissionless', 'authority', 'Executor was not the contract owner, yet the call succeeded', `Read failed: ${(e as Error).message}`));
  }

  // Approval: the proposal record, the proposer, and the wait arithmetic.
  try {
    const proposal = await readProposal(client, approval.proposalId);
    const recordOk =
      eqAddr(proposal.target, approval.target) &&
      eqAddr(proposal.feed, approval.feed) &&
      proposal.maxStale.toString() === approval.maxStaleSeconds &&
      proposal.minPriceX18.toString() === approval.minPriceX18 &&
      proposal.maxPriceX18.toString() === approval.maxPriceX18 &&
      proposal.readyAt.toString() === approval.readyAt &&
      proposal.executed === true &&
      proposal.canceled === false;
    checks.push(
      check('approval.proposal-record', 'approval', 'On-chain proposal matches the receipt', recordOk, `target ${approval.target}, feed ${approval.feed}, readyAt ${approval.readyAt}, executed`, `target ${proposal.target}, feed ${proposal.feed}, readyAt ${proposal.readyAt}, executed=${proposal.executed}, canceled=${proposal.canceled}`, 'Source: FundAllowlist.proposals(id).'),
    );
    const proposeTx = await client.getTransaction({ hash: approval.proposeTransactionHash as `0x${string}` });
    const proposeReceipt = await client.getTransactionReceipt({ hash: approval.proposeTransactionHash as `0x${string}` });
    const proposeBlock = await client.getBlock({ blockNumber: proposeReceipt.blockNumber });
    checks.push(
      check('approval.proposer-is-owner', 'approval', 'Proposal was sent by the contract owner', !!owner && eqAddr(proposeTx.from, owner) && eqAddr(proposeTx.from, approval.proposedBy), `from ${owner}`, `from ${proposeTx.from}`, 'Source: propose transaction sender vs FundAllowlist.owner(). proposeAsset is onlyOwner.'),
    );
    // Intent (Nov 24, 2026): the proposal that authorized this execution —
    // the proposer, and the propose transaction itself.
    const intent = receipt.intent;
    if (!intent) {
      checks.push(skipped('intent.authorization', 'intent', 'The proposal that authorized this execution checks out (proposer + propose transaction)', 'This receipt predates the intent field (Nov 24, 2026).'));
    } else {
      checks.push(
        check(
          'intent.authorization',
          'intent',
          'The proposal that authorized this execution checks out (proposer + propose transaction)',
          !!owner && eqAddr(intent.authorizedBy, owner) && eqAddr(intent.authorizedBy, proposeTx.from) && intent.authorizationHashKind === 'transaction' && proposeTx.hash.toLowerCase() === intent.authorizationHash.toLowerCase(),
          `authorizedBy ${approval.proposedBy}, propose tx ${approval.proposeTransactionHash}`,
          `authorizedBy ${intent.authorizedBy}, propose tx ${intent.authorizationHash}`,
          'Source: propose transaction sender + hash.',
        ),
      );
    }
    const delay = await client.readContract({ address: FUND_ALLOWLIST_ADDRESS, abi: fundAllowlistVerifierAbi, functionName: 'delay' });
    checks.push(
      check('approval.wait-arithmetic', 'approval', 'readyAt equals the propose time plus the delay', BigInt(proposeBlock.timestamp) + delay === BigInt(approval.readyAt) && delay.toString() === approval.delaySeconds, `proposeTs ${approval.proposedAt} + delay ${approval.delaySeconds} = readyAt ${approval.readyAt}`, `proposeTs ${proposeBlock.timestamp} + delay ${delay} = ${BigInt(proposeBlock.timestamp) + delay}`, 'Source: propose block timestamp + FundAllowlist.delay().'),
    );
    checks.push(
      check('approval.wait-elapsed', 'approval', 'Execution happened at or after readyAt', BigInt(settlement.blockTimestamp) >= BigInt(approval.readyAt) && BigInt(approval.executedAt) - BigInt(approval.readyAt) === BigInt(approval.waitElapsedSeconds), `executedAt ${approval.executedAt} >= readyAt ${approval.readyAt} (wait elapsed ${approval.waitElapsedSeconds}s)`, `executedAt ${approval.executedAt}, readyAt ${approval.readyAt}`, 'Source: settlement block timestamp vs FundAllowlist.proposals(id).readyAt.'),
    );
    const feed = await client.readContract({ address: FUND_ALLOWLIST_ADDRESS, abi: fundAllowlistVerifierAbi, functionName: 'feedOf', args: [approval.target as `0x${string}`] });
    const feedOk =
      eqAddr(feed[0], approval.feed) &&
      feed[1].toString() === approval.maxStaleSeconds &&
      feed[2].toString() === approval.minPriceX18 &&
      feed[3].toString() === approval.maxPriceX18;
    checks.push(check('approval.band-stored', 'approval', 'Stored feed and price band match the receipt', feedOk, `feed ${approval.feed}, band ${approval.minPriceX18}-${approval.maxPriceX18}`, `feed ${feed[0]}, band ${feed[2]}-${feed[3]}`, 'Source: FundAllowlist.feedOf(target).'));
  } catch (e) {
    for (const [id, section, label] of [
      ['approval.proposal-record', 'approval', 'On-chain proposal matches the receipt'],
      ['approval.proposer-is-owner', 'approval', 'Proposal was sent by the contract owner'],
      ['intent.authorization', 'intent', 'The proposal that authorized this execution checks out (proposer + propose transaction)'],
      ['approval.wait-arithmetic', 'approval', 'readyAt equals the propose time plus the delay'],
      ['approval.wait-elapsed', 'approval', 'Execution happened at or after readyAt'],
      ['approval.band-stored', 'approval', 'Stored feed and price band match the receipt'],
    ] as const) {
      checks.push(skipped(id, section, label, `Read failed: ${(e as Error).message}`));
    }
  }

  // Settlement: the transaction, the resulting state, and the events.
  try {
    const tx = await client.getTransaction({ hash: settlement.transactionHash as `0x${string}` });
    const txReceipt = await client.getTransactionReceipt({ hash: settlement.transactionHash as `0x${string}` });
    checks.push(
      check('settlement.tx', 'settlement', 'Settlement transaction succeeded to the FundAllowlist contract', txReceipt.status === 'success' && eqAddr(tx.to ?? undefined, FUND_ALLOWLIST_ADDRESS) && settlement.status === 1, `to ${FUND_ALLOWLIST_ADDRESS}, status success`, `to ${tx.to}, status ${txReceipt.status}`, 'Source: settlement transaction receipt.'),
    );
    let inputOk = false;
    try {
      const decoded = decodeFunctionData({ abi: allowlistCallAbi, data: tx.input });
      const [id] = decoded.args as unknown as [bigint];
      inputOk = decoded.functionName === 'execute' && id === BigInt(approval.proposalId);
    } catch {
      inputOk = false;
    }
    checks.push(check('settlement.input', 'settlement', 'Transaction input is execute(proposalId)', inputOk, `execute(${approval.proposalId})`, tx.input.slice(0, 18) + '…', 'Source: settlement transaction input data.'));
    const allowed = await client.readContract({ address: FUND_ALLOWLIST_ADDRESS, abi: fundAllowlistVerifierAbi, functionName: 'assetAllowed', args: [approval.target as `0x${string}`] });
    const proposal = await readProposal(client, approval.proposalId);
    checks.push(
      check('settlement.state', 'settlement', 'Asset is allowlisted and the proposal is marked executed', allowed === true && proposal.executed === true, 'assetAllowed=true, executed=true', `assetAllowed=${allowed}, executed=${proposal.executed}`, 'Source: FundAllowlist.assetAllowed(target) + proposals(id).'),
    );
    const events = decodeReceiptLogs(txReceipt.logs as { data: `0x${string}`; topics: [`0x${string}`, ...`0x${string}`[]] }[]);
    const executedEvent = events.find((ev) => ev.eventName === 'Executed');
    const feedSetEvent = events.find((ev) => ev.eventName === 'FeedSet');
    const eventsOk =
      !!executedEvent &&
      executedEvent.args.id === BigInt(approval.proposalId) &&
      eqAddr(executedEvent.args.target as string, approval.target) &&
      !!feedSetEvent &&
      eqAddr(feedSetEvent.args.asset as string, approval.target) &&
      eqAddr(feedSetEvent.args.feed as string, approval.feed);
    checks.push(
      check('settlement.events', 'settlement', 'Executed and FeedSet events in the receipt match', eventsOk, `Executed(id=${approval.proposalId}, target=${approval.target}) + FeedSet(asset, feed=${approval.feed})`, executedEvent && feedSetEvent ? `Executed(id=${String(executedEvent.args.id)}) + FeedSet(feed=${String(feedSetEvent.args.feed)})` : 'one or both events missing', 'Source: logs of the settlement transaction.'),
    );
  } catch (e) {
    for (const [id, label] of [
      ['settlement.tx', 'Settlement transaction succeeded to the FundAllowlist contract'],
      ['settlement.input', 'Transaction input is execute(proposalId)'],
      ['settlement.state', 'Asset is allowlisted and the proposal is marked executed'],
      ['settlement.events', 'Executed and FeedSet events in the receipt match'],
    ] as const) {
      checks.push(skipped(id, 'settlement', label, `Read failed: ${(e as Error).message}`));
    }
  }
}

export async function verifyReceipt(
  receipt: AgentReceipt,
  opts?: { rpcUrl?: string; client?: PublicClient },
): Promise<VerificationResult> {
  const rpcUrl = opts?.rpcUrl ?? ROBINHOOD_RPC_URL;
  const client =
    opts?.client ??
    createPublicClient({ transport: http(rpcUrl) });
  const checks: ReceiptCheck[] = [];

  checks.push(
    check('format.receipt-format', 'format', 'Receipt format is polypad.agent-receipt/1', receipt.receiptFormat === 'polypad.agent-receipt/1', 'polypad.agent-receipt/1', receipt.receiptFormat),
  );
  checks.push(
    check('format.chain', 'format', 'Receipt is for Robinhood Chain (4663)', receipt.chain?.id === ROBINHOOD_CHAIN_ID, '4663', String(receipt.chain?.id)),
  );
  checks.push(
    check('format.disclaimer', 'format', 'Receipt carries the no-guarantee disclaimer', receipt.disclaimer === DISCLAIMER, DISCLAIMER, receipt.disclaimer),
  );

  const actionType = receipt.action.type;
  if (isAgentScorePostedReceipt(receipt)) {
    await verifyScorePosted(receipt, client, checks);
  } else if (isAllowlistExecutedReceipt(receipt)) {
    await verifyAllowlistExecuted(receipt, client, checks);
  } else {
    checks.push(skipped('format.action-type', 'format', 'Action type is supported by this verifier', `Unknown action type: ${actionType}`));
  }

  const failed = checks.some((c) => c.status === 'fail');
  const skippedAny = checks.some((c) => c.status === 'skip');
  return {
    receiptId: receipt.receiptId,
    actionType: receipt.action.type,
    verdict: failed ? 'failed' : skippedAny ? 'incomplete' : 'verified',
    checks,
    checkedAt: new Date().toISOString(),
    rpcUrl,
  };
}
