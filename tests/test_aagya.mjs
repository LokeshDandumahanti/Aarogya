// N5 — Sister Aagya (the report copilot). Blinding re-assert, per-case
// isolation, persona + ranked schema, lazy on-entry sync, and the address
// regex. Pure JS extracted from index.html, run offline.
//
//   node tests/test_aagya.mjs
//
// Covers: (a) prompt isolation — case B's Aagya prompt contains none of case
// A's clue texts; (b) blinding — buildAssistantPrompt never reads
// `expectation`, the sanitizer still redacts the diagnosis; (c) lazy sync —
// confirmClue/assistantIngestImage only set the dirty flag, and flushAssistant
// runs the update exactly once when the panel is entered.

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
  grab(/function detectAssistantAddress\(msg\) \{[\s\S]*?\n\}/),
  grab(/function sanitizeTranscriptForAuditor\(\) \{[\s\S]*?\n\}/),
  grab(/function buildAssistantPrompt\(\) \{[\s\S]*?\n\}/),
  grab(/function isDiagnosticCase\(\) \{[\s\S]*?\n\}/),
].join('\n');

const api = (state, CASE_DATA, ALL_CLUES, getGameEndClue) =>
  new Function('state', 'CASE_DATA', 'ALL_CLUES', 'getGameEndClue',
    code + '\nreturn { buildAssistantPrompt, sanitizeTranscriptForAuditor, detectAssistantAddress };'
  )(state, CASE_DATA, ALL_CLUES, getGameEndClue);

const loadCase = (name) => JSON.parse(fs.readFileSync(path.join(here, '..', 'data', name), 'utf8'));
const buildClues = (caseData) => { const m = {}; for (const c of caseData.clues) m[c.id] = { id: c.id, ...c }; return m; };
const gameEndOf = (caseData) => caseData.clues.find(c => c.gameEnd) || null;
const mkState = (pathEntries) => ({
  path: pathEntries,
  assistantReport: { imagesSeen: [] },
  uploads: [],
  transcript: [],
});

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (got === want) pass++;
  else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};
const ok = (name, cond) => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}`); }
};

// ── Scenario 1: prompt isolation — case B never sees case A's clues ──
{
  const sc = loadCase('case_scabies.json');
  const rm = loadCase('case_remote.json');
  const rmPath = rm.clues.filter(c => !c.gameEnd).slice(0, 3).map(c => ({ clueId: c.id }));
  const rmState = mkState(rmPath);
  const pRm = api(rmState, rm, buildClues(rm), () => gameEndOf(rm)).buildAssistantPrompt();
  ok('remote prompt shows its own evidence', rmPath.some(p => pRm.includes(buildClues(rm)[p.clueId].label)));
  ok('remote prompt has NO scabies clue text', !pRm.includes('scabies') && !pRm.includes('burrow') && !pRm.includes('Sarcoptes'));

  const scPath = ['finger_webs', 'scabies_visual', 'koh_prep'].map(clueId => ({ clueId }));
  const pSc = api(mkState(scPath), sc, buildClues(sc), () => gameEndOf(sc)).buildAssistantPrompt();
  ok('scabies prompt shows its own evidence', scPath.some(p => pSc.includes(buildClues(sc)[p.clueId].label)));
  ok('scabies prompt has NO remote clue text', !pSc.includes('HbA1c') && !pSc.includes('glucose'));
}

// ── Scenario 2: blinding + persona + ranked schema (source-level) ──
{
  const start = src.indexOf('function buildAssistantPrompt');
  const end = src.indexOf('\nfunction ', start + 1);
  const body = src.slice(start, end === -1 ? src.length : end);
  ok('prompt body never reads expectation', !body.includes('expectation'));
  ok('prompt filters the gameEnd clue out of findings', body.includes('!c.gameEnd'));
  ok('prompt sanitizes the transcript', body.includes('sanitizeTranscriptForAuditor'));
  ok('persona is Sister Aagya, never gives diagnosis', body.includes('Sister Aagya') && body.includes('never give the diagnosis'));
  ok('schema is ranked', body.includes('"reasoning"') && body.includes('"supporting"') && body.includes('"refuting"'));
}

// ── Scenario 3: sanitizer still redacts the diagnosis at runtime ──
{
  const sc = loadCase('case_scabies.json');
  const s = api(
    { transcript: [
      { role: 'assistant', text: 'I think it may be Scabies, sir.' },
      { role: 'user', text: 'What else could it be?' },
    ] },
    sc, {}, () => gameEndOf(sc)
  );
  const out = s.sanitizeTranscriptForAuditor();
  ok('diagnosis redacted from forwarded transcript', !out.some(m => m.text.includes('Scabies')));
  ok('banned string replaced with [redacted]', out.some(m => m.text.includes('[redacted]')));
}

// ── Scenario 4: address detection — Aagya + legacy aliases ──
{
  const { detectAssistantAddress } = api({}, {}, {}, () => null);
  ok('@aagya detected', detectAssistantAddress('@aagya what do you think?'));
  ok('bare aagya detected', detectAssistantAddress('aagya, what do you think?'));
  ok('@auditor still works', detectAssistantAddress('@auditor'));
  ok('care auditor works', detectAssistantAddress('care auditor please'));
  ok('reviewer works', detectAssistantAddress('reviewer'));
  ok('plain question NOT detected', !detectAssistantAddress('what do you think?'));
}

// ── Scenario 5: lazy on-entry sync — dirty flag, flush runs once ──
{
  const syncCode = [
    grab(/let assistantTimer = null;[\s\S]*?let assistantPendingImage = null;/),
    grab(/function flushAssistant\(\) \{[\s\S]*?\n\}/),
  ].join('\n') + '\nfunction runAssistantUpdate() { __calls++; }\nvar __calls = 0;';
  const s = new Function(syncCode + '\nreturn { flushAssistant, calls: () => __calls, dirty: () => assistantDirty, running: () => assistantRunning, setDirty: v => { assistantDirty = v; }, setRunning: v => { assistantRunning = v; } };')();
  eq('clean by default', s.dirty(), false);
  s.setDirty(true);
  s.flushAssistant();
  eq('flush runs the update once', s.calls(), 1);
  eq('flush clears the dirty flag', s.dirty(), false);
  s.setDirty(true); s.setRunning(true);
  s.flushAssistant();
  eq('in-flight run blocks a second run', s.calls(), 1);
  eq('dirty preserved while running', s.dirty(), true);
  s.setRunning(false); s.setDirty(false);
  s.flushAssistant();
  eq('clean state does not flush', s.calls(), 1);
}

// ── Scenario 6: on-entry sync wiring + multimodal gap (source-level) ──
{
  const confirm = src.slice(src.indexOf('function confirmClue'), src.indexOf('function sendMessage'));
  ok('confirmClue only marks dirty (no eager LLM call)', /assistantDirty = true/.test(confirm) && !confirm.includes('scheduleAssistantUpdate'));
  const ingest = src.slice(src.indexOf('function assistantIngestImage'), src.indexOf('\n// ═══', src.indexOf('function assistantIngestImage')));
  ok('assistantIngestImage only marks dirty (no eager LLM call)', /assistantDirty = true/.test(ingest) && !ingest.includes('scheduleAssistantUpdate'));
  ok('showPanelTab flushes on the Aagya tab', /if \(tab === 'auditor'\) flushAssistant\(\);/.test(src));
  ok('toggleAssistantPanel flushes on open', /classList\.toggle\('open'\);\n  flushAssistant\(\);/.test(src));
  ok('selectSuspect flushes when the Aagya character is picked', /kind === 'records'\) flushAssistant\(\); \/\/ N5/.test(src));
  ok('handleMultimodalBeat ingests the X-ray into the report', /assistantIngestImage\(\{ caption: 'Chest X-ray/.test(src));
}

console.log(`\naagya: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
