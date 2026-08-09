// P3 — fixed 20-utterance eval set for the SPIKES/Calgary-Cambridge-anchored
// empathy judge. Pure JS extracted from index.html, run offline.
//
//   node tests/test_eval_set.mjs            → deterministic + mock legs (always green)
//   node tests/test_eval_set.mjs --live     → + live leg vs OpenRouter (needs OPENROUTER_API_KEY)
//
// The measured claim is the LIVE agreement (exact label + score within ±10);
// the deterministic leg is a coarse offline guard (no threshold asserted) and
// the mock leg proves the harness plumbing (must be 20/20, else the harness is
// broken). A network/429 failure in the live leg counts as a non-agreement —
// the rule-based fallback stands, mirroring the app.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const inline = html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/);
if (!inline) throw new Error('no inline script found in index.html');
const src = inline[1];
const grab = (re) => {
  const m = src.match(re);
  if (!m) throw new Error('pattern not found: ' + re);
  return m[0];
};

const code = [
  grab(/const TONE_DICT = \{[\s\S]*?\n\};/),
  grab(/const TONE_DELTA = .*?;/),
  grab(/const JUDGE_LABELS = .*?;/),
  grab(/function classifyTone\(msg\) \{[\s\S]*?\n\}/),
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

const EVAL = JSON.parse(fs.readFileSync(path.join(here, 'eval_set.json'), 'utf8'));
const loadCase = (name) => JSON.parse(fs.readFileSync(path.join(root, 'data', `case_${name}.json`), 'utf8'));

// Fresh per-entry context: the entry is committed by the rule-based classifier
// first (tone = classifyTone), then the LLM judge may correct it.
function makeCtx(entry) {
  const CASE_DATA = loadCase(entry.case);
  const ctx = { state: { empathy: { score: 100, messages: [], remote: { signals: {} } } }, CASE_DATA };
  const api = new Function(
    'state', 'callOpenRouter', 'parseModelJson', 'saveState', 'updateEmpathyHud', 'CASE_DATA',
    code + '\nreturn { classifyTone, buildJudgePrompt, judgeEmpathy };'
  )(
    ctx.state,
    (...a) => (ctx.callOpenRouter || (() => Promise.resolve('{}')))(...a),
    parseModelJson,
    () => {},
    () => {},
    CASE_DATA
  );
  const fallback = api.classifyTone(entry.msg);
  ctx.state.empathy.messages.push({ text: entry.msg, tone: fallback, ts: '00:00' });
  return { ctx, api, fallback };
}

const agrees = (entry, tone, score) => {
  const labelOk = tone === entry.reference.label;
  const scoreOk = typeof score === 'number' && Math.abs(score - entry.reference.score) <= 10;
  return labelOk && scoreOk;
};

// ── Deterministic leg: keyword classifier vs reference labels (informational) ──
function deterministicLeg() {
  const mism = [];
  let agree = 0;
  for (const e of EVAL) {
    const { api } = makeCtx(e);
    const t = api.classifyTone(e.msg);
    if (t === e.reference.label) agree++; else mism.push(`${e.id}(${t}/${e.reference.label})`);
  }
  console.log(`deterministic leg: ${agree}/${EVAL.length} exact-label agreement` + (mism.length ? ` — mismatches: ${mism.join(', ')}` : ''));
}

// ── Mock leg: stubbed model returns the reference grade → must reproduce it ──
async function mockLeg() {
  const mism = [];
  for (const e of EVAL) {
    const { ctx, api, fallback } = makeCtx(e);
    ctx.callOpenRouter = () => Promise.resolve(JSON.stringify({
      score: e.reference.score, label: e.reference.label, rationale: 'mock',
    }));
    await api.judgeEmpathy(e.msg, fallback);
    const entry = ctx.state.empathy.messages[0];
    if (!agrees(e, entry.tone, entry.score)) mism.push(e.id);
  }
  const agree = EVAL.length - mism.length;
  console.log(`mock leg: ${agree}/${EVAL.length} agreement (harness plumbing — must be 20/20)`);
  if (agree !== EVAL.length) {
    console.log(`EVAL HARNESS BROKEN — mock responses must reproduce the reference grades. failed: ${mism.join(', ')}`);
    process.exit(1);
  }
}

// ── Live leg: real Gemma via OpenRouter (the measured P3 claim) ──
async function liveLeg() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!process.argv.includes('--live') || !key) {
    console.log('live leg: skipped (run with --live and OPENROUTER_API_KEY set)');
    return;
  }
  const mism = [];
  for (let i = 0; i < EVAL.length; i++) {
    const e = EVAL[i];
    const { ctx, api, fallback } = makeCtx(e);
    ctx.callOpenRouter = async (system, userMsgs) => {
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: 'google/gemma-4-26b-a4b-it',
          temperature: 0,
          max_tokens: 200,
          messages: [{ role: 'system', content: system }, { role: 'user', content: userMsgs[0].content }],
        }),
      });
      const data = await resp.json();
      return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    };
    try {
      await api.judgeEmpathy(e.msg, fallback);
    } catch (err) { /* network/429 → non-agreement; rule-based fallback stands */ }
    const entry = ctx.state.empathy.messages[0];
    if (!agrees(e, entry.tone, entry.score)) {
      mism.push(`${e.id}(${entry.tone}/${e.reference.label} score ${entry.score ?? '—'} vs ${e.reference.score})`);
    }
    if (i < EVAL.length - 1) await new Promise((r) => setTimeout(r, 1100));
  }
  const agree = EVAL.length - mism.length;
  console.log(`live leg: ${agree}/${EVAL.length} agreement (measured against OPENROUTER_API_KEY — the P3 claim)`);
  if (mism.length) console.log(`  disagreements: ${mism.join('\n  ')}`);
}

(async () => {
  console.log(`eval set: ${EVAL.length} utterances (${EVAL.filter(e => e.reference.label === 'empathetic').length} empathetic / ${EVAL.filter(e => e.reference.label === 'neutral').length} neutral / ${EVAL.filter(e => e.reference.label === 'rude').length} rude)`);
  deterministicLeg();
  await mockLeg();
  await liveLeg();
})();
