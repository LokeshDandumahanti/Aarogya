// N2 — ranked differential analyser (deterministic fallback when the LLM is down).
// Pure JS extracted from index.html, run offline against real case data.
//
//   node tests/test_analyser.mjs
//
// Covers: ranked shape + confidence bounds, Scabies ranks first on realistic
// evidence, no-support hypotheses down-weighted and flagged with refuting,
// and analyserFallback() producing a fully-populated report object.

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
  grab(/function rankDifferential\(evidence, diseaseList\) \{[\s\S]*?\n\}/),
  grab(/function analyserFallback\(\) \{[\s\S]*?\n\}/),
  grab(/function visibleDifferential\(rep\) \{[\s\S]*?\n\}/),
  grab(/function isDiagnosticCase\(\) \{[\s\S]*?\n\}/),
].join('\n');

const api = (state, CASE_DATA, ALL_CLUES) =>
  new Function('state', 'CASE_DATA', 'ALL_CLUES', code + '\nreturn { rankDifferential, analyserFallback, visibleDifferential, isDiagnosticCase };')(state, CASE_DATA, ALL_CLUES);

const sc = JSON.parse(fs.readFileSync(path.join(here, '..', 'data', 'case_scabies.json'), 'utf8'));
const buildClues = (caseData) => { const m = {}; for (const c of caseData.clues) m[c.id] = { id: c.id, ...c }; return m; };
const ALL_SC = buildClues(sc);

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (got === want) pass++;
  else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};
const ok = (name, cond) => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}`); }
};

// ── Scenario 1: pure rankDifferential — shape, sort, down-weight, refuting ──
{
  const { rankDifferential } = api({}, {}, {});
  const r = rankDifferential(
    [{ id: 'e1', text: 'alpha beta finding' }, { id: 'e2', text: 'alpha symptom' }],
    ['Alpha Beta', 'Alpha', 'Gamma']
  );
  eq('three hypotheses', r.length, 3);
  ok('sorted by confidence desc', r[0].confidence >= r[1].confidence && r[1].confidence >= r[2].confidence);
  eq('top is Alpha Beta', r[0].disease, 'Alpha Beta');
  ok('well-shaped entries', r.every(d => typeof d.disease === 'string' && typeof d.reasoning === 'string' && Array.isArray(d.supporting) && d.confidence >= 0 && d.confidence <= 1));
  ok('top supporting ids recorded', r[0].supporting.includes('e1') && r[0].supporting.includes('e2'));
  eq('no-support hypothesis confidence 0', r[2].confidence, 0);
  ok('no-support reasoning explicit', /No supporting evidence/.test(r[2].reasoning));
  ok('hypothesis sharing top evidence gets refuting', Array.isArray(r[1].refuting) && r[1].refuting.length > 0);
  ok('refuting lists the shared id', r[1].refuting.includes('e1'));
}

// ── Scenario 2: realistic TB evidence → TB ranks first, bounds hold ──
{
  const state = {
    path: ['itchy_rash', 'finger_webs', 'night_itch', 'burrows_visible', 'scabies_visual'].map(clueId => ({ clueId })),
    assistantReport: { imagesSeen: [] },
  };
  const obj = JSON.parse(api(state, sc, ALL_SC).analyserFallback());
  ok('differential has all 4 candidates', obj.differential.length === 4);
  ok('differential sorted desc', obj.differential.every((d, i) => i === 0 || obj.differential[i - 1].confidence >= d.confidence));
  eq('Scabies ranks first', obj.differential[0].disease, 'Scabies');
  eq('Scabies confidence 1.0', obj.differential[0].confidence, 1);
  ok('report object is applyAssistantResult-shaped', ['differential', 'findings', 'images', 'notes', 'reply'].every(k => k in obj));
  ok('findings populated from evidence', obj.findings.length >= 3);
  eq('notes flag the fallback', obj.notes[0], 'Deterministic analysis (model unavailable).');
  ok('images array present', Array.isArray(obj.images));
}

// ── Scenario 3: image findings fold into the evidence ──
{
  const state = {
    path: [{ clueId: 'scabies_visual' }],
    assistantReport: { imagesSeen: [{ caption: 'Interdigital skin photograph', finding: 'Fine wavy burrows in the finger web spaces with excoriations' }] },
  };
  const obj = JSON.parse(api(state, sc, ALL_SC).analyserFallback());
  ok('image finding folded into findings', obj.findings.some(f => /burrow/i.test(f)));
  eq('images round-trip', obj.images.length, 1);
}

// ── Scenario 4: no evidence yet → zero-confidence differential, no crash ──
{
  const state = { path: [], assistantReport: { imagesSeen: [] } };
  const obj = JSON.parse(api(state, sc, ALL_SC).analyserFallback());
  eq('all zero confidence', obj.differential.every(d => d.confidence === 0), true);
  ok('still well-shaped', Array.isArray(obj.differential) && obj.differential.length === 4);
}

// ── Scenario 5: display gate — weak leads hidden until >=50% confidence ──
{
  const { visibleDifferential } = api({}, {}, {});
  const rep = { differential: [
    { disease: 'Type 2 Diabetes Mellitus', confidence: 0.33, supporting: ['g'] },
    { disease: 'Chronic fatigue syndrome', confidence: 0.33, supporting: ['f'] },
    { disease: 'Cataract causing blurred vision', confidence: 0.25, supporting: ['b'] },
    { disease: 'Urinary tract infection', confidence: 0, supporting: [] },
  ] };
  eq('weak 33% lead not surfaced (no early diagnosis reveal)', visibleDifferential(rep).length, 0);
  rep.differential.push({ disease: 'Type 2 Diabetes Mellitus', confidence: 0.67, supporting: ['g', 'h'] });
  const shown = visibleDifferential(rep);
  eq('only the >=50% lead surfaced', shown.length, 1);
  eq('that lead is the strong hypothesis', shown[0].disease, 'Type 2 Diabetes Mellitus');
  eq('empty differential → empty view', visibleDifferential({ differential: [] }).length, 0);
  eq('missing report → empty view', visibleDifferential({}).length, 0);
}

// ── Scenario 6: non-diagnostic case (mother) has no differential; negation refutes ──
{
  const mo = JSON.parse(fs.readFileSync(path.join(here, '..', 'data', 'case_mother.json'), 'utf8'));
  const moClues = buildClues(mo);
  const pathIds = mo.clues.filter(c => !c.gameEnd).map(c => ({ clueId: c.id }));
  const state = { path: pathIds, assistantReport: { imagesSeen: [] } };
  const moApi = api(state, mo, moClues);
  const obj = JSON.parse(moApi.analyserFallback());
  eq('mother (diagnostic:false) → no differential', obj.differential.length, 0);
  ok('mother case flagged non-diagnostic', moApi.isDiagnosticCase() === false);
  const { rankDifferential } = moApi;

  // Negation: "no eczema history" must refute, not support, the Eczema hypothesis.
  const r = rankDifferential([{ id: 'e', text: 'No history of eczema or atopic dermatitis. Itching is worse at night.' }], ['Eczema']);
  eq('negated "eczema" token does not support Eczema', r[0].confidence, 0);
  const r2 = rankDifferential([{ id: 'e', text: 'Fine wavy burrows between the fingers — the classic appearance of scabies.' }], ['Scabies']);
  eq('non-negated "scabies" still matches', r2[0].confidence, 1);
}

console.log(`\nanalyser: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
