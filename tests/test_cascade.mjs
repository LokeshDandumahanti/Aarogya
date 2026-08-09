// Unit test for the proxy's failover cascade — no network, injected legs.
import assert from 'node:assert';
import { runCascade, PRIMARY_MODEL, FALLBACK_OPENROUTER_MODEL, GEMINI_MODEL } from '../netlify/functions/openrouter.js';

// Build N legs from canned statuses ('throw' simulates a network error).
function legMaker(statuses) {
  const calls = [];
  const legs = statuses.map((s) => ({
    label: `leg${calls.length}`,
    run: async () => {
      calls.push(1);
      if (s === 'throw') throw new Error('boom');
      return { status: s, body: { ok: 1 } };
    },
  }));
  return { calls, legs };
}

// First leg 2xx → used alone.
{
  const { calls, legs } = legMaker(['200']);
  const out = await runCascade(legs);
  assert.equal(out.status, 200);
  assert.equal(calls.length, 1);
}

// First leg 429 → fallback wins.
{
  const { calls, legs } = legMaker(['429', '200']);
  const out = await runCascade(legs);
  assert.equal(out.status, 200);
  assert.equal(calls.length, 2);
}

// All legs fail → clean 503.
{
  const { calls, legs } = legMaker(['500', '500']);
  const out = await runCascade(legs);
  assert.equal(out.status, 503);
  assert.equal(calls.length, 2);
}

// Network throw on first leg → fallback answers.
{
  const { calls, legs } = legMaker(['throw', '200']);
  const out = await runCascade(legs);
  assert.equal(out.status, 200);
  assert.equal(calls.length, 2);
}

// Constants are the agreed models.
assert.equal(PRIMARY_MODEL, 'google/gemma-4-26b-a4b-it');
assert.equal(FALLBACK_OPENROUTER_MODEL, 'google/gemma-4-31b-it');
assert.equal(GEMINI_MODEL, 'gemini-flash-latest');

console.log('cascade tests OK');
