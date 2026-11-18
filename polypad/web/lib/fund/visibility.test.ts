import assert from 'node:assert/strict';
import test from 'node:test';
import { fundsPublicEnabled } from './visibility';

test('fund routes are public unless the server flag is exactly disabled', () => {
  const previous = process.env.FUND_ROUTES_ENABLED;
  delete process.env.FUND_ROUTES_ENABLED;
  assert.equal(fundsPublicEnabled(), true);
  process.env.FUND_ROUTES_ENABLED = 'enabled';
  assert.equal(fundsPublicEnabled(), true);
  process.env.FUND_ROUTES_ENABLED = 'disabled';
  assert.equal(fundsPublicEnabled(), false);
  if (previous === undefined) delete process.env.FUND_ROUTES_ENABLED;
  else process.env.FUND_ROUTES_ENABLED = previous;
});
