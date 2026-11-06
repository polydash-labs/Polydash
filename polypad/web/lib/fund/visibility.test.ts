import assert from 'node:assert/strict';
import test from 'node:test';
import { fundsPublicEnabled } from './visibility';

test('fund routes stay off unless the server flag is exactly enabled', () => {
  const previous = process.env.FUND_ROUTES_ENABLED;
  delete process.env.FUND_ROUTES_ENABLED;
  assert.equal(fundsPublicEnabled(), false);
  process.env.FUND_ROUTES_ENABLED = '1';
  assert.equal(fundsPublicEnabled(), false);
  process.env.FUND_ROUTES_ENABLED = 'true';
  assert.equal(fundsPublicEnabled(), false);
  process.env.FUND_ROUTES_ENABLED = 'enabled';
  assert.equal(fundsPublicEnabled(), true);
  if (previous === undefined) delete process.env.FUND_ROUTES_ENABLED;
  else process.env.FUND_ROUTES_ENABLED = previous;
});
