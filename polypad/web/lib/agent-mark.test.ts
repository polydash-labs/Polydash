import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_LAUNCH_MARK,
  applyAgentMark,
  isAgentLaunched,
  normalizeRepository,
  partitionLaunchLinks,
} from './agent-mark';

test('agent mark is the docs anchor and nothing else counts', () => {
  assert.equal(isAgentLaunched([AGENT_LAUNCH_MARK]), true);
  assert.equal(isAgentLaunched(['https://polypad.family/docs']), false);
  assert.equal(isAgentLaunched([`${AGENT_LAUNCH_MARK}/extra`]), false);
  assert.equal(isAgentLaunched(undefined), false);
});

test('applyAgentMark appends once and refuses an eleventh link', () => {
  const added = applyAgentMark(['https://example.com'], true);
  assert.deepEqual(added.links, ['https://example.com', AGENT_LAUNCH_MARK]);
  assert.equal(added.error, undefined);

  const already = applyAgentMark(['https://example.com', AGENT_LAUNCH_MARK], true);
  assert.equal(already.links.filter((link) => link === AGENT_LAUNCH_MARK).length, 1);

  const off = applyAgentMark(['https://example.com'], false);
  assert.deepEqual(off.links, ['https://example.com']);

  const full = applyAgentMark(Array.from({ length: 10 }, (_, i) => `https://example.com/${i}`), true);
  assert.equal(full.links.length, 10);
  assert.match(full.error ?? '', /10/);
});

test('GitHub repository normalization rejects extra paths and partition hides the mark', () => {
  assert.equal(normalizeRepository('https://github.com/polydash-labs/Polydash.git'), 'https://github.com/polydash-labs/Polydash');
  assert.equal(normalizeRepository('https://github.com/polydash-labs/Polydash/'), 'https://github.com/polydash-labs/Polydash');
  assert.equal(normalizeRepository('https://github.com/polydash-labs/Polydash/tree/main'), null);
  assert.equal(normalizeRepository('http://github.com/polydash-labs/Polydash'), null);

  const split = partitionLaunchLinks([
    'https://example.com',
    'https://github.com/polydash-labs/Polydash',
    'https://github.com/other/second',
    AGENT_LAUNCH_MARK,
  ]);
  assert.equal(split.agentLaunched, true);
  assert.equal(split.buildUrl, 'https://github.com/polydash-labs/Polydash');
  assert.deepEqual(split.links, ['https://example.com', 'https://github.com/other/second']);
});
