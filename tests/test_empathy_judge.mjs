// N1 — LLM empathy judge (non-blocking, both input paths via sendMessage).
// Pure JS extracted from index.html, run offline.
//
//   node tests/test_empathy_judge.mjs
//
// Covers: judge contract (parse, label validation, score correction, rationale
// stored), fallback (judge failure → rule-based tone + score preserved), the
// fire-and-forget call site (no await in sendMessage), and the judge prompt.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8');
const inline = html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/);
if (!inline) throw new Error('no inline script found in index.html');
const src = inline[1];
const grab = (re) => {
  const m = src.match(re);
  if (!m) throw new Error('pattern not found: ' + re);
  return m[0];
};

const code = [
  grab(/const TONE_DELTA = .*?;/),
  grab(/const JUDGE_LABELS = .*?;/),
  grab(/function buildJudgePrompt\(msg\) \{[\s\S]*?\n\}/),
  grab(/async function judgeEmpathy\([\s\S]*?\n\}/),
  grab(/function applyJudgeResult\([\s\S]*?\n\}/),
].join('\n');

// parseModelJson stub (mirrors the real one — JSON extraction from a string).
const parseModelJson = (text) => {
  const m = String(text || '').trim().match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
};

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (got === want) pass++;
  else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};
const ok = (name, cond) => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}`); }
};

const makeCtx = (over = {}) => {
  const ctx = {
    state: { empathy: { score: 100, messages: [], remote: { signals: {} } } },
    hud: [],
    saves: 0,
    CASE_DATA: { characters: { P: { kind: 'patient', fullName: 'Madhav', publicProfile: '32, three-week cough' } } },
  };
  Object.assign(ctx, over);
  const api = new Function(
    'state', 'callOpenRouter', 'parseModelJson', 'saveState', 'updateEmpathyHud', 'CASE_DATA',
    code + '\nreturn { buildJudgePrompt, judgeEmpathy, applyJudgeResult };'
  )(
    ctx.state,
    // Proxy: read ctx.callOpenRouter at call time so scenarios can swap mocks.
    (...a) => (ctx.callOpenRouter || (() => Promise.resolve('{}')))(...a),
    parseModelJson,
    () => ctx.saves++,
    (delta) => ctx.hud.push(delta),
    ctx.CASE_DATA
  );
  return { ctx, api };
};

// ── Scenario 1: judge resolves empathetic → entry corrected + rationale stored ──
(async () => {
  const { ctx, api } = makeCtx();
  // Simulate the synchronous rule-based commit (judgeTone pushed a neutral entry).
  ctx.state.empathy.messages.push({ text: 'Tell me more about your cough', tone: 'neutral', ts: '00:00' });
  ctx.callOpenRouter = () => Promise.resolve(JSON.stringify({
    score: 90, label: 'empathetic',
    rationale: '"Tell me more" opens the door kindly.',
  }));
  await api.judgeEmpathy('Tell me more about your cough', 'neutral');
  const entry = ctx.state.empathy.messages[0];
  eq('label corrected to empathetic', entry.tone, 'empathetic');
  eq('LLM score stored', entry.score, 90);
  eq('rationale stored', entry.rationale, '"Tell me more" opens the door kindly.');
  eq('source marked llm', entry.source, 'llm');
  eq('score corrected by delta diff, clamped to 100 (100 + 1 - 0)', ctx.state.empathy.score, 100);
  ok('saveState called', ctx.saves >= 1);
  ok('HUD refreshed with the LLM delta', ctx.hud.length >= 1);
})();

// ── Scenario 2: judge says rude where rules said neutral → score drops ──
(async () => {
  const { ctx, api } = makeCtx();
  ctx.state.empathy.messages.push({ text: 'answer the question', tone: 'neutral', ts: '00:00' });
  ctx.callOpenRouter = () => Promise.resolve(JSON.stringify({
    score: 10, label: 'rude', rationale: '"answer the question" demands rather than asks.',
  }));
  await api.judgeEmpathy('answer the question', 'neutral');
  eq('label corrected to rude', ctx.state.empathy.messages[0].tone, 'rude');
  eq('score drops by 5 (100 + -5 - 0)', ctx.state.empathy.score, 95);
})();

// ── Scenario 3: judge failure → rule-based tone + score preserved ──
(async () => {
  const { ctx, api } = makeCtx();
  ctx.state.empathy.messages.push({ text: 'hello', tone: 'neutral', ts: '00:00' });
  ctx.callOpenRouter = () => Promise.reject(new Error('502'));
  await api.judgeEmpathy('hello', 'neutral');
  const entry = ctx.state.empathy.messages[0];
  eq('rule-based tone preserved', entry.tone, 'neutral');
  eq('no source field', entry.source, undefined);
  eq('score untouched', ctx.state.empathy.score, 100);
  eq('no saves on failure', ctx.saves, 0);
})();

// ── Scenario 4: judge returns invalid label → ignored (rule-based stands) ──
(async () => {
  const { ctx, api } = makeCtx();
  ctx.state.empathy.messages.push({ text: 'hi', tone: 'neutral', ts: '00:00' });
  ctx.callOpenRouter = () => Promise.resolve(JSON.stringify({ score: 80, label: 'doctor', rationale: 'x' }));
  await api.judgeEmpathy('hi', 'neutral');
  eq('invalid label ignored', ctx.state.empathy.messages[0].tone, 'neutral');
})();

// ── Scenario 5: judge prompt contract ──
{
  const { ctx, api } = makeCtx();
  const p = api.buildJudgePrompt('how long has the cough been?');
  ok('prompt names the patient', p.includes('Madhav'));
  ok('prompt includes the profile', p.includes('three-week cough'));
  ok('prompt has JSON schema', p.includes('"label"') && p.includes('0-100'));
  ok('prompt quotes doctor words requirement', p.includes('quote'));
  const empty = makeCtx({ CASE_DATA: null }).api.buildJudgePrompt('x');
  ok('no patient → generic fallback', empty.includes('the patient'));
}

// ── Scenario 6: fire-and-forget call site (no await) + covers both paths ──
{
  const m = src.match(/judgeEmpathy\(msg, tone\);/);
  ok('sendMessage calls judgeEmpathy(msg, tone) without await', !!m);
  const aw = src.match(/await judgeEmpathy\(/);
  ok('never awaited (latency guarantee)', !aw);
  const ta = src.match(/async function transcribeAndSend[\s\S]*?sendMessage\(\)/);
  ok('voice path routes through sendMessage', !!ta);
}

// ── Scenario 7: score clamps at bounds ──
{
  const { ctx, api } = makeCtx();
  ctx.state.empathy.score = 99;
  ctx.state.empathy.messages.push({ text: 'hi', tone: 'neutral', ts: '00:00' });
  ctx.callOpenRouter = () => Promise.resolve(JSON.stringify({ score: 95, label: 'empathetic', rationale: 'kind' }));
  await api.judgeEmpathy('hi', 'neutral');
  eq('empathetic caps at 100', ctx.state.empathy.score, 100);
}

setTimeout(() => {
  console.log(`\nempathy-judge: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}, 50);
