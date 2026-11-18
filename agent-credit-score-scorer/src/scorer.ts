/**
 * Scorer orchestration: for each registered agent, collect its on-chain
 * metrics, compute the five components + total score (src/score.ts), build
 * the audit inputs hash, and (unless dry-run) post updateScore on-chain.
 *
 * The inputs hash is keccak256 of the canonical metrics JSON (fixed key
 * order). Anyone can recompute the score from the metrics + the formula in
 * src/score.ts, and verify the hash matches what was posted on-chain.
 */
import { keccak256, stringToHex, formatEther } from 'viem';
import type { Account, Address, Chain, PublicClient, Transport, WalletClient } from 'viem';
import type { ScorerConfig } from './config.js';
import type { Logger } from './log.js';
import { scoreAbi } from './chain.js';
import {
  activityScore,
  bandForScore,
  conductScore,
  historyScore,
  performanceScore,
  stakeScore,
  weightedScore,
  BAND_NAMES,
  type Components,
} from './score.js';
import {
  BlockTimeCache,
  getAgentFunds,
  getDistributionCount,
  getExitsDuringWait,
  getLaunchCount,
  getNavTape,
  getNftAddress,
  getProposals,
  getRegisteredAgents,
  getStakedPolydash,
  getTradeCount,
  getVaultNavTotal,
  windowStartSeconds,
  type AgentInfo,
} from './collect.js';

export type AgentScoreResult = {
  agentId: string;
  wallet: Address;
  name: string;
  components: Components;
  score: number;
  band: number;
  bandName: string;
  inputsHash: `0x${string}`;
  metrics: Record<string, unknown>;
};

const DAY_SECONDS = 86_400n;

export async function scoreAgent(
  client: PublicClient,
  config: ScorerConfig,
  agent: AgentInfo,
  nowSeconds: bigint,
  fromBlock: bigint,
  toBlock: bigint,
  times: BlockTimeCache,
): Promise<AgentScoreResult> {
  const windowStart = windowStartSeconds(nowSeconds);
  const funds = await getAgentFunds(client, config.fundFactories, agent.wallet, fromBlock, toBlock);

  // --- Performance: NAV-weighted navPerNft return over 30d, in bps. ---
  let perfReturnBps: number | null = null;
  let hasFunds = false;
  {
    const perFund: Array<{ retBps: bigint; nav: bigint }> = [];
    for (const f of funds) {
      const tape = await getNavTape(client, f.vault, fromBlock, toBlock);
      const inWindow = tape.filter((p) => p.timestamp >= windowStart);
      if (inWindow.length < 2) continue;
      const first = inWindow[0].navPerNft;
      const last = inWindow[inWindow.length - 1].navPerNft;
      if (first === 0n) continue;
      hasFunds = true;
      const retBps = ((last - first) * 10_000n) / first;
      const nav = await getVaultNavTotal(client, f.vault).catch(() => 0n);
      perFund.push({ retBps, nav });
    }
    if (hasFunds) {
      const totalNav = perFund.reduce((s, r) => s + r.nav, 0n);
      if (totalNav > 0n) {
        const weighted = perFund.reduce((s, r) => s + r.retBps * r.nav, 0n);
        perfReturnBps = Number(weighted / totalNav);
      } else {
        // No NAV to weight by (empty funds); use the plain mean return.
        const sum = perFund.reduce((s, r) => s + r.retBps, 0n);
        perfReturnBps = Number(sum / BigInt(perFund.length));
      }
    }
  }
  const performance = performanceScore(perfReturnBps, hasFunds);

  // --- History: days since registration + funds managed. ---
  const daysActive = Number((nowSeconds - agent.registeredAt) / DAY_SECONDS);
  const history = historyScore(daysActive, funds.length);

  // --- Activity: trades + proposals + launches + funds created, last 30d. ---
  let actions = 0;
  let cleanProposals = 0;
  let waitViolations = 0;
  let distributions = 0;
  let exitsDuringWait = 0;
  for (const f of funds) {
    actions += await getTradeCount(client, f.vault, fromBlock, toBlock);
    const proposals = await getProposals(client, f.vault, fromBlock, toBlock, times);
    const recent = proposals.filter((p) => p.proposedAt >= windowStart);
    actions += recent.length;
    for (const p of recent) {
      if (p.executedAt !== null) {
        if (p.executedAt >= p.readyAt) cleanProposals++;
        else waitViolations++;
      }
    }
    distributions += await getDistributionCount(client, f.vault, fromBlock, toBlock);
    // Exits inside any proposal's wait window, via the fund NFT burns.
    const windows = recent.map((p) => [p.proposedAt, p.readyAt] as [bigint, bigint]);
    if (windows.length > 0) {
      const nft = await getNftAddress(client, f.vault).catch(() => '0x0000000000000000000000000000000000000000' as Address);
      exitsDuringWait += await getExitsDuringWait(client, nft, windows, fromBlock, toBlock, times);
    }
  }
  actions += await getLaunchCount(client, config.launchFactory, agent.wallet, fromBlock, toBlock);
  // Funds created in the 30d window count as activity.
  for (const f of funds) {
    const ts = await times.get(f.blockNumber);
    if (ts >= windowStart) actions++;
  }
  const activity = activityScore(actions);

  // --- Stake: the agent's OWN committed POLYDASH (whole tokens) — its
  //  registration bond + what it staked in the staking pools. ---
  const bondWhole = Number(formatEther(agent.stake));
  const poolStakedWei = await getStakedPolydash(
    client,
    config.stakingFactories,
    agent.wallet,
    config.polydashAddress,
  );
  const poolStakedWhole = Number(formatEther(poolStakedWei));
  const stake = stakeScore(bondWhole + poolStakedWhole);

  // --- Conduct: clean proposals + distributions earn; violations and exits cost. ---
  const conduct = conductScore({ cleanProposals, waitViolations, exitsDuringWait, distributions });

  const components: Components = { performance, history, activity, stake, conduct };
  const score = weightedScore(components);
  const band = bandForScore(score);

  const metrics: Record<string, unknown> = {
    agentId: agent.agentId.toString(),
    wallet: agent.wallet,
    name: agent.name,
    performanceReturnBps30d: perfReturnBps,
    fundsManaged: funds.length,
    daysActive,
    actions30d: actions,
    cleanProposals,
    waitViolations,
    exitsDuringWait,
    distributions,
    polydashBond: bondWhole,
    polydashPoolStaked: poolStakedWhole,
    components,
    score,
    scoredAt: Number(nowSeconds),
  };
  const inputsHash = keccak256(stringToHex(JSON.stringify(metrics))) as `0x${string}`;

  return {
    agentId: agent.agentId.toString(),
    wallet: agent.wallet,
    name: agent.name,
    components,
    score,
    band,
    bandName: BAND_NAMES[band],
    inputsHash,
    metrics,
  };
}

export async function runScorer(args: {
  publicClient: PublicClient;
  walletClient: WalletClient<Transport, Chain, Account> | null;
  config: ScorerConfig;
  log: Logger;
}): Promise<AgentScoreResult[]> {
  const { publicClient, walletClient, config, log } = args;
  const latest = await publicClient.getBlockNumber();
  const fromBlock = latest > config.lookbackBlocks ? latest - config.lookbackBlocks : 0n;
  const toBlock = latest;
  const block = await publicClient.getBlock({ blockNumber: latest });
  const nowSeconds = block.timestamp;
  const times = new BlockTimeCache(publicClient);

  const agents = await getRegisteredAgents(publicClient, config.registryAddress);
  log.log('scorer_start', { agents: agents.length, fromBlock: fromBlock.toString(), toBlock: toBlock.toString() });

  const results: AgentScoreResult[] = [];
  for (const agent of agents) {
    try {
      const r = await scoreAgent(publicClient, config, agent, nowSeconds, fromBlock, toBlock, times);
      results.push(r);
      log.log('agent_scored', {
        agentId: r.agentId,
        name: r.name,
        score: r.score,
        band: r.bandName,
        components: r.components,
        inputsHash: r.inputsHash,
      });
      if (!config.dryRun && walletClient && config.scoreAddress) {
        const hash = await walletClient.writeContract({
          address: config.scoreAddress,
          abi: scoreAbi,
          functionName: 'updateScore',
          args: [
            BigInt(r.agentId),
            r.score,
            [
              r.components.performance,
              r.components.history,
              r.components.activity,
              r.components.stake,
              r.components.conduct,
            ] as [number, number, number, number, number],
            r.inputsHash,
          ],
        });
        log.log('score_posted', { agentId: r.agentId, tx: hash });
      }
    } catch (err) {
      log.log('agent_score_failed', { agentId: agent.agentId.toString(), error: String(err) });
    }
  }
  return results;
}
