// N6 — consolidated report: multimodal images reach Aagya's report, url is
// stored on the ingest entry, applyAssistantResult merges instead of
// replacing, and the Markdown export emits ![caption](url).
//
//   node tests/test_report.mjs
//
// Pure JS extracted from index.html, run offline.

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
  'let assistantDirty = false;',
  grab(/function assistantIngestImage\(artifact, displayUrl, finding\) \{[\s\S]*?\n\}/),
  grab(/function applyAssistantResult\(res, question\) \{[\s\S]*?\n\}/),
  grab(/function buildReportMarkdown\(\) \{[\s\S]*?\n\}/),
  grab(/function visibleDifferential\(rep\) \{[\s\S]*?\n\}/),
  grab(/function isDiagnosticCase\(\) \{[\s\S]*?\n\}/),
].join('\n');

const parseModelJson = (text) => {
  const m = String(text || '').trim().match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
};

const api = (state, CASE_DATA, getTime, saveState, renderReportPanel) =>
  new Function('state', 'CASE_DATA', 'parseModelJson', 'getTime', 'saveState', 'renderReportPanel',
    code + '\nreturn { assistantIngestImage, applyAssistantResult, buildReportMarkdown, dirty: () => assistantDirty };'
  )(state, CASE_DATA, parseModelJson, getTime, saveState, renderReportPanel);

const SKIN_CAPTION = 'Chest X-ray (PA view) — shared by the patient';
const SKIN_URL = 'assets/scabies_burrow.jpg';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (got === want) pass++;
  else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};
const ok = (name, cond) => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}`); }
};

// ── Scenario 1: multimodal ingest stores the url + finding, marks dirty ──
{
  const state = { assistantReport: { imagesSeen: [], findings: [] } };
  const a = api(state, {}, () => 'ts', () => {}, () => {});
  a.assistantIngestImage({ caption: SKIN_CAPTION, label: 'Skin photo', kind: 'multimodal' }, SKIN_URL, 'Fine wavy burrows in the finger web spaces');
  eq('image entry stored', state.assistantReport.imagesSeen.length, 1);
  eq('url carried on the entry', state.assistantReport.imagesSeen[0].url, SKIN_URL);
  ok('finding folded into report findings', state.assistantReport.findings.length === 1 && /burrow/.test(state.assistantReport.findings[0]));
  eq('ingest marks the panel dirty', a.dirty(), true);
  // dedup on same caption
  a.assistantIngestImage({ caption: SKIN_CAPTION, label: 'Skin photo', kind: 'multimodal' }, SKIN_URL, 'again');
  eq('same image not duplicated', state.assistantReport.imagesSeen.length, 1);
}

// ── Scenario 2: applyAssistantResult merges images (url survives, finding overlaid) ──
{
  const state = {
    assistantReport: {
      imagesSeen: [{ caption: SKIN_CAPTION, url: SKIN_URL, finding: 'local finding', source: 'multimodal' }],
      findings: [], differential: [], notes: [],
    },
    assistantHistory: [],
  };
  const a = api(state, {}, () => 'ts', () => {}, () => {});
  a.applyAssistantResult(JSON.stringify({
    findings: ['Cough >3 weeks'],
    images: [{ caption: SKIN_CAPTION, finding: 'LLM finding' }],
    differential: [{ disease: 'X', confidence: 0.5 }],
    notes: ['n1'],
  }), null);
  const seen = state.assistantReport.imagesSeen;
  eq('url-bearing local image survives the merge', seen.some(i => i.url === SKIN_URL), true);
  eq('LLM finding overlaid on the local entry', seen.find(i => i.url).finding, 'LLM finding');
  ok('lastUpdate stamped', typeof state.assistantReport.lastUpdate === 'string' && state.assistantReport.lastUpdate.length > 0);
  eq('findings/differential/notes applied', state.assistantReport.findings.length === 1 && state.assistantReport.differential.length === 1 && state.assistantReport.notes.length === 1, true);
}

// ── Scenario 3: consolidated markdown has ![caption](url) + all four parts ──
{
  const state = {
    caseTitle: 'Arun — Itchy Rash',
    empathy: { score: 90 },
    assistantReport: {
      findings: ['Itchy rash between the fingers'],
      imagesSeen: [{ caption: SKIN_CAPTION, url: SKIN_URL, finding: 'burrows' }],
      differential: [{ disease: 'Scabies', confidence: 0.8, reasoning: 'x', supporting: ['a'], refuting: [] }],
      notes: ['note'],
    },
  };
  const CASE_DATA = {
    title: 'Arun — Itchy Rash',
    characters: { P: { fullName: 'Arun', publicProfile: 'male, 19, hostel student', kind: 'patient' } },
  };
  const md = api(state, CASE_DATA, () => 'ts', () => {}, () => {}).buildReportMarkdown();
  ok('image emitted as markdown link', md.includes(`![${SKIN_CAPTION}](${SKIN_URL})`));
  ok('all four report parts present', ['## Findings', '## Images seen', '## Running differential', '## Notes'].every(h => md.includes(h)));
  ok('empathy score echoed', md.includes('**Empathy score:** 90'));
}

console.log(`\nreport: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
