// DAG-robust artifact reveals. Images and synthetic reports must only be
// handed over once their unlocksClue's dependencies are discovered — asking
// early falls through to the LLM path instead. Pure JS extracted from
// index.html, run offline.
//
//   node tests/test_dag_gate.mjs
//
// Covers: Sunita's health card + referral sheet, and Arun's skin photo + KOH
// report — locked until the prerequisite conversation moves are made.

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
  grab(/const GENERIC_EVIDENCE_RE = .*?;/),
  grab(/function getStatus\(cid\) \{[\s\S]*?\n\}/),
  grab(/function allArtifacts\(\) \{[\s\S]*?\n\}/),
  grab(/function artifactAlreadyShown\(art\) \{[\s\S]*?\n\}/),
  grab(/function detectArtifact\(question\) \{[\s\S]*?\n\}/),
  grab(/function detectMultimodalRequest\(msg\) \{[\s\S]*?\n\}/),
].join('\n');

const loadCase = (name) => JSON.parse(fs.readFileSync(path.join(root, 'data', name), 'utf8'));
const buildClues = (caseData) => { const m = {}; for (const c of caseData.clues) m[c.id] = c; return m; };

function apiFor(caseData) {
  const ALL_CLUES = buildClues(caseData);
  const state = { discoveredClues: new Set(), regionShown: new Set() };
  const api = new Function('state', 'CASE_DATA', 'ALL_CLUES',
    code + '\nreturn { getStatus, detectArtifact, detectMultimodalRequest };'
  )(state, caseData, ALL_CLUES);
  return { state, ...api };
}

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (got === want) pass++;
  else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};
const ok = (name, cond) => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}`); }
};

// ── Mother case: health card + referral sheet are DAG-gated ──
{
  const mother = loadCase('case_mother.json');
  const g = apiFor(mother);

  eq('fresh: health card locked', g.detectArtifact('show me the health card'), null);
  eq('fresh: referral sheet locked', g.detectArtifact('show me the referral sheet'), null);

  // Fear named but Aagya not consulted about the card → still locked.
  g.state.discoveredClues = new Set(['refusal_stated', 'acknowledge_situation', 'name_the_fear']);
  eq('fear named, no card_available: health card still locked', g.detectArtifact('show me the health card'), null);

  // Fear named + card_available (Aagya) → card is handed over.
  g.state.discoveredClues = new Set(['refusal_stated', 'acknowledge_situation', 'name_the_fear', 'card_available']);
  const card = g.detectArtifact('show me the health card');
  ok('card revealable after fear named + Aagya consulted', card && card.key === 'infant_health_card');

  // Danger confirmed but grandmother not involved → referral sheet still locked.
  g.state.discoveredClues = new Set([
    'refusal_stated', 'acknowledge_situation', 'name_the_fear', 'card_available',
    'danger_signs_confirmed', 'mil_pressure', 'mil_herbs', 'mil_bad_memory',
    'respect_decision',
  ]);
  eq('grandmother not involved: referral sheet locked', g.detectArtifact('show me the referral sheet'), null);

  // Full arc → referral sheet handed over.
  g.state.discoveredClues = new Set([
    'refusal_stated', 'acknowledge_situation', 'name_the_fear', 'card_available',
    'danger_signs_confirmed', 'mil_pressure', 'mil_herbs', 'mil_bad_memory',
    'respect_decision', 'involve_mil',
  ]);
  const sheet = g.detectArtifact('show me the referral sheet');
  ok('referral sheet revealable after danger confirmed + grandmother involved', sheet && sheet.key === 'referral_info_sheet');

  // The 'discovered' case: if the unlock clue was reached via speech, the
  // artifact must still be handover-able (the gate used to withhold it).
  g.state.discoveredClues = new Set([
    'refusal_stated', 'acknowledge_situation', 'name_the_fear', 'card_available',
    'danger_signs_confirmed',
  ]);
  const cardSpoken = g.detectArtifact('show me the health card');
  ok('health card still revealable after its clue was already spoken', cardSpoken && cardSpoken.key === 'infant_health_card');
}

// ── Scabies case: skin photo + KOH report are DAG-gated ──
{
  const sc = loadCase('case_scabies.json');
  const g = apiFor(sc);

  eq('fresh: skin photo locked', g.detectArtifact('show me the rash on your hands'), null);
  eq('fresh: KOH report locked', g.detectArtifact('show the KOH report'), null);

  // Rash located (finger webs) + night itch → skin photo handed over. The photo
  // is what shows the burrows — a verbal burrow description is NOT required first.
  g.state.discoveredClues = new Set(['itchy_rash', 'finger_webs', 'night_itch']);
  const skin = g.detectArtifact('show me the rash');
  ok('skin photo revealable after finger-webs + night itch', skin && skin.key === 'skin');

  // Scratching wounds + no eczema hx → KOH report handed over.
  g.state.discoveredClues = new Set(['itchy_rash', 'finger_webs', 'hostel_note', 'burrows_visible', 'night_itch', 'scratching_wounds', 'no_eczema_hx']);
  const koh = g.detectArtifact('show the KOH report');
  ok('KOH report revealable after scratching + no eczema hx', koh && koh.key === 'koh_lab_report');
}

// ── No multimodal clues in the current library → nothing bypasses the DAG ──
{
  for (const file of ['case_mother.json', 'case_scabies.json', 'case_remote.json']) {
    const g = apiFor(loadCase(file));
    eq(`${file}: no multimodal handover`, g.detectMultimodalRequest('show me the xray'), null);
  }
}

console.log(`\ndag-gate: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
