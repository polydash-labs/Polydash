/**
 * Unit tests for the pure scoring math (src/score.ts). No chain access.
 * Run: npm test
 *
 * These values must match the on-chain AgentScore.weightedScore exactly —
 * the contract enforces score == weightedScore(components), so a mismatch
 * here would make every updateScore revert with ScoreMismatch.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  weightedScore,
  bandForScore,
  performanceScore,
  historyScore,
  activityScore,
  stakeScore,
  conductScore,
} from '../src/score.ts';

describe('weightedScore (must match AgentScore.weightedScore)', () => {
  it('all-zero components give 300', () => {
    assert.equal(weightedScore({ performance: 0, history: 0, activity: 0, stake: 0, conduct: 0 }), 300);
  });
  it('all-1000 components give 850', () => {
    assert.equal(
      weightedScore({ performance: 1000, history: 1000, activity: 1000, stake: 1000, conduct: 1000 }),
      850,
    );
  });
  it('the spec example gives 738', () => {
    assert.equal(
      weightedScore({ performance: 800, history: 900, activity: 700, stake: 600, conduct: 950 }),
      738,
    );
  });
  it('a brand-new agent scores near the floor', () => {
    // Perf 0, History 0, Activity 0, Stake 10 (1,000 bond / 100), Conduct 500.
    // W = 15*10 + 15*500 = 7650; score = 300 + 7650*550/100000 = 342.
    assert.equal(
      weightedScore({ performance: 0, history: 0, activity: 0, stake: 10, conduct: 500 }),
      342,
    );
  });
  it('all-500 components give 575', () => {
    assert.equal(
      weightedScore({ performance: 500, history: 500, activity: 500, stake: 500, conduct: 500 }),
      575,
    );
  });
});

describe('bandForScore', () => {
  it('band boundaries', () => {
    assert.equal(bandForScore(300), 0);
    assert.equal(bandForScore(499), 0);
    assert.equal(bandForScore(500), 1);
    assert.equal(bandForScore(599), 1);
    assert.equal(bandForScore(600), 2);
    assert.equal(bandForScore(699), 2);
    assert.equal(bandForScore(700), 3);
    assert.equal(bandForScore(799), 3);
    assert.equal(bandForScore(800), 4);
    assert.equal(bandForScore(850), 4);
  });
});

describe('component scorers', () => {
  it('performance: no funds scores 0; -20% scores 0; +50% scores 1000', () => {
    assert.equal(performanceScore(null, false), 0);
    assert.equal(performanceScore(-2000, true), 0);
    assert.equal(performanceScore(-3000, true), 0);
    assert.equal(performanceScore(5000, true), 1000);
    assert.equal(performanceScore(6000, true), 1000);
    // Breakeven (0 bps) -> (0+2000)*1000/7000 = 285.
    assert.equal(performanceScore(0, true), 285);
  });
  it('history: days and funds add up, capped at 1000', () => {
    assert.equal(historyScore(0, 0), 0);
    assert.equal(historyScore(30, 2), 350); // 30*5 + 2*100
    assert.equal(historyScore(100, 5), 1000); // capped
  });
  it('activity: 20 actions in 30d saturates', () => {
    assert.equal(activityScore(0), 0);
    assert.equal(activityScore(10), 500);
    assert.equal(activityScore(20), 1000);
    assert.equal(activityScore(100), 1000);
  });
  it('stake: 100,000 POLYDASH saturates; the 1,000 bond alone is 10', () => {
    assert.equal(stakeScore(0), 0);
    assert.equal(stakeScore(1000), 10);
    assert.equal(stakeScore(50_000), 500);
    assert.equal(stakeScore(100_000), 1000);
    assert.equal(stakeScore(1_000_000), 1000);
  });
  it('conduct: neutral 500 with no history; clean proposals earn; violations cost', () => {
    assert.equal(conductScore({ cleanProposals: 0, waitViolations: 0, exitsDuringWait: 0, distributions: 0 }), 500);
    assert.equal(conductScore({ cleanProposals: 10, waitViolations: 0, exitsDuringWait: 0, distributions: 0 }), 1000);
    assert.equal(conductScore({ cleanProposals: 0, waitViolations: 1, exitsDuringWait: 0, distributions: 0 }), 300);
    assert.equal(conductScore({ cleanProposals: 2, waitViolations: 0, exitsDuringWait: 4, distributions: 0 }), 500);
    assert.equal(conductScore({ cleanProposals: 0, waitViolations: 5, exitsDuringWait: 0, distributions: 0 }), 0);
  });
});
