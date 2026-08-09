// M1 — per-case isolation (bucket model) + N7 case switching.
// Pure JS extracted from index.html, run offline.
//
//   node tests/test_case_switch.mjs
//
// Simulates: start case A → confirm 3 clues → switch to B (fresh) → confirm
// 1 clue → return to A. Asserts each case's clues/path/empathy/chat survive
// independently, Sets are rebuilt on restore, and snapshots exclude the
// non-per-case fields (currentCaseId / cases).

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
  grab(/const DEFAULT_EMPATHY = .*?;/),
  grab(/const DEFAULT_REPORT = .*?;/),
  grab(/function caseSnapshot\(\) \{[\s\S]*?\n\}/),
  grab(/function restoreCaseState\(snap\) \{[\s\S]*?\n\}/),
  grab(/function persistActiveCase\(\) \{[\s\S]*?\n\}/),
].join('\n');

const api = new Function('state', code + '\nreturn { caseSnapshot, restoreCaseState, persistActiveCase };');

// A freshly-started case A (TB) with 3 confirmed clues.
const freshCaseA = () => ({
  discoveredClues: new Set(['tb_1', 'tb_2', 'tb_3']),
  path: [{ clueId: 'tb_1' }, { clueId: 'tb_2' }, { clueId: 'tb_3' }],
  gameWon: false,
  currentCharacter: 'M',
  currentClue: 'tb_3',
  currentSuspect: 'M',
  conversationHistory: { M: [{ role: 'user', content: 'how long has the cough?' }] },
  pendingClues: [{ id: 'tb_4' }],
  denialCount: { 'M:tb_x': 1 },
  wrongGuesses: 0,
  leadingCount: 1,
  regionShown: new Set(['xray']),
  transcript: [{ role: 'user', text: 'hi' }],
  assistantReport: { findings: ['cough'], imagesSeen: [], uploads: [], differential: [], notes: [], lastUpdate: null },
  assistantHistory: [],
  empathy: { score: 99, messages: [{ text: 'hi', tone: 'empathetic' }], remote: { signals: {} } },
  uploads: [],
  sessionStartTs: 1000,
  caseTitle: 'TB',
  isStreaming: false,
  currentCaseId: 'tb',
  cases: {},
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

// ── Scenario 1: A → B → A, state preserved per case ──
{
  const st = freshCaseA();
  const a = api(st);
  a.persistActiveCase();
  ok('snapshot stored under caseId', !!(st.cases.tb && st.cases.tb.discoveredClues.length === 3));
  ok('snapshot excludes currentCaseId', !('currentCaseId' in st.cases.tb));
  ok('snapshot excludes cases', !('cases' in st.cases.tb));
  ok('updatedAt stamped', typeof st.cases.tb.updatedAt === 'number' && st.cases.tb.updatedAt > 0);

  // Switch to B (goitre): what resetPlayState + loadCase would do to flat fields.
  st.currentCaseId = 'goitre';
  st.caseTitle = 'Goitre';
  st.discoveredClues = new Set();
  st.path = [];
  st.currentSuspect = null;
  st.conversationHistory = {};
  st.regionShown = new Set();
  st.assistantReport = { findings: [], imagesSeen: [], uploads: [], differential: [], notes: [], lastUpdate: null };
  st.assistantHistory = [];
  st.empathy = { score: 100, messages: [], remote: { signals: {} } };
  st.isStreaming = false;

  // Confirm 1 clue in B.
  st.discoveredClues = new Set(['g_1']);
  st.path = [{ clueId: 'g_1' }];
  a.persistActiveCase();
  ok('B snapshot independent (1 clue)', st.cases.goitre.discoveredClues.length === 1);
  ok('A snapshot still intact (3 clues)', st.cases.tb.discoveredClues.length === 3);

  // Switch back to A: restore its snapshot.
  st.currentCaseId = 'tb';
  a.restoreCaseState(st.cases.tb);
  ok('restored A: 3 clues', st.discoveredClues.size === 3);
  ok('restored A: discoveredClues is a Set', st.discoveredClues instanceof Set);
  ok('restored A: regionShown is a Set', st.regionShown instanceof Set);
  ok('restored A: empathy intact', st.empathy.score === 99);
  ok('restored A: conversation intact', st.conversationHistory.M.length === 1);
  ok('restored A: caseTitle intact', st.caseTitle === 'TB');
  ok('restored A: gameWon false', st.gameWon === false);
  ok('restored A: isStreaming reset', st.isStreaming === false);
  ok('B flat state replaced by A', !st.conversationHistory.g);
}

// ── Scenario 2: a completed (gameWon) case restores as won ──
{
  const st = freshCaseA();
  st.gameWon = true;
  const a = api(st);
  a.persistActiveCase();
  st.gameWon = false;
  st.discoveredClues = new Set();
  a.restoreCaseState(st.cases.tb);
  ok('gameWon restored', st.gameWon === true);
}

// ── Scenario 3: fresh case → no snapshot → reset path taken ──
{
  const st = freshCaseA();
  const a = api(st);
  ok('never-started case has no snapshot', !(st.cases.scabies));
  a.persistActiveCase();
  ok('only active case snapshotted', Object.keys(st.cases).length === 1);
}

// ── Scenario 4: snapshot round-trip preserves arrays by value ──
{
  const st = freshCaseA();
  const a = api(st);
  a.persistActiveCase();
  const snapA = JSON.parse(JSON.stringify(st.cases.tb));
  st.discoveredClues = new Set();
  st.path = [];
  a.restoreCaseState(snapA);
  ok('round-trip: path preserved', st.path.length === 3);
  ok('round-trip: pendingClues preserved', st.pendingClues.length === 1);
  ok('round-trip: denialCount preserved', st.denialCount['M:tb_x'] === 1);
  ok('round-trip: leadingCount preserved', st.leadingCount === 1);
}

console.log(`\ncase-switch: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
