import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigin } from '../lib/sim/server.mjs';

test('the bridge takes Stellar (file:// sends null, development a loopback origin) and tools without an Origin', () => {
  assert.equal(allowedOrigin(undefined), true);
  assert.equal(allowedOrigin('null'), true);
  assert.equal(allowedOrigin('http://localhost:5199'), true);
  assert.equal(allowedOrigin('http://127.0.0.1:5299'), true);
});

test('the bridge refuses web pages', () => {
  assert.equal(allowedOrigin('https://example.com'), false);
  assert.equal(allowedOrigin('http://localhost.evil.com'), false);
  assert.equal(allowedOrigin('http://localhost:5199.evil.com'), false);
});
