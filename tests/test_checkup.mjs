// M3 checkup-protocol tests — pure JS extracted from index.html, run offline.
//
//   node tests/test_checkup.mjs
//
// Covers the deterministic checkup engine: intake completeness gate, compiled
// record, and the longitudinal chain (one virtual patient, 3 consecutive
// monthly checkups, prevId links + sign required).

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
  grab(/const CHECKUP_REQUIRED = \{[\s\S]*?\n\};/),
  grab(/function isCheckupField\([\s\S]*?\n\}/),
  grab(/function checkupCompleteness\([\s\S]*?\n\}/),
  grab(/function newCheckup\([\s\S]*?\n\}/),
  grab(/function compileCheckupRecord\([\s\S]*?\n\}/),
  grab(/function chainCheckups\([\s\S]*?\n\}/),
  grab(/function nextCheckup\([\s\S]*?\n\}/),
].join('\n');

const api = new Function(code + '\nreturn { checkupCompleteness, newCheckup, compileCheckupRecord, chainCheckups, nextCheckup };');
const fn = api();

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++;
  else { fail++; console.log(`FAIL ${name}: got ${g}, want ${w}`); }
};

// ── completeness gate ──
const r0 = fn.newCheckup('shambhu', 1);
eq('new: id', r0.id, 'ck-shambhu-1');
eq('new: month', r0.month, 1);
eq('new: prevId', r0.prevId, null);

let gate = fn.checkupCompleteness(r0);
eq('gate: fresh incomplete', gate.complete, false);
eq('gate: all four missing', gate.missing.sort(), ['adherence', 'meds', 'symptoms', 'vitals']);

r0.intake.symptoms = { status: 'stable', notes: 'feeling well' };
r0.intake.vitals = { bp: '122/80', pulse: 76, weight: 64.8, glucose: 128 };
r0.intake.meds = { list: ['metformin 500 mg twice daily'] };
gate = fn.checkupCompleteness(r0);
eq('gate: meds still missing (no adherence)', gate.missing, ['adherence']);

r0.intake.adherence = { level: 'high', missedDoses: 0 };
gate = fn.checkupCompleteness(r0);
eq('gate: complete', gate.complete, true);
eq('gate: nothing missing', gate.missing, []);

// ── compiled record ──
const rec = fn.compileCheckupRecord(r0.intake);
eq('record: has symptoms line', rec.includes('Symptoms: stable — feeling well'), true);
eq('record: has vitals line', rec.includes('BP 122/80, pulse 76/min, weight 64.8 kg, fasting glucose 128 mg/dL'), true);
eq('record: has meds line', rec.includes('metformin 500 mg twice daily'), true);
eq('record: has adherence line', rec.includes('Adherence: high'), true);

// ── recurrence ──
r0.signedAt = '2026-06-08T10:00:00Z';
const r1 = fn.nextCheckup(r0);
eq('next: month+1', r1.month, 2);
eq('next: id chained', r1.id, 'ck-shambhu-2');
eq('next: prevId', r1.prevId, 'ck-shambhu-1');
eq('next: meds carried forward', r1.intake.meds.list, ['metformin 500 mg twice daily']);

// ── 3-month chain ──
const fill = (r) => {
  r.intake.symptoms = { status: 'stable', notes: 'no new complaints' };
  r.intake.vitals = { bp: '120/78', pulse: 74, weight: 63.5, glucose: 121 };
  r.intake.meds = { list: ['metformin 500 mg twice daily'] };
  r.intake.adherence = { level: 'high', missedDoses: 0 };
  r.plan = { followUp: 'Continue metformin, review in 1 month', nextMonth: '2026-08-08' };
  r.signedAt = '2026-07-08T10:00:00Z';
  return r;
};
const c1 = fn.newCheckup('shambhu', 1);
fill(c1);
const c2 = fill(fn.nextCheckup(c1));
const c3 = fill(fn.nextCheckup(c2));

let ch = fn.chainCheckups([c1, c2, c3]);
eq('chain: valid 3-month', ch.valid, true);
eq('chain: no errors', ch.errors, []);

// ── chain violations ──
ch = fn.chainCheckups([c1, c3]); // month gap: 1 then 3
eq('chain: month gap caught', ch.valid, false);
eq('chain: gap error names month', ch.errors.some(e => e.includes('month')), true);

const c2b = JSON.parse(JSON.stringify(c2)); c2b.prevId = 'ck-shambhu-9';
ch = fn.chainCheckups([c1, c2b, c3]);
eq('chain: prevId mismatch caught', ch.valid, false);

const c3u = JSON.parse(JSON.stringify(c3)); c3u.signedAt = null;
ch = fn.chainCheckups([c1, c2, c3u]);
eq('chain: unsigned caught', ch.valid, false);
eq('chain: unsigned error', ch.errors.some(e => e.includes('unsigned')), true);

const c2w = JSON.parse(JSON.stringify(c2)); c2w.patientId = 'someone_else';
ch = fn.chainCheckups([c1, c2w, c3]);
eq('chain: patient change caught', ch.valid, false);

const c1i = JSON.parse(JSON.stringify(c1)); c1i.intake.symptoms.notes = ''; // drop a required field
ch = fn.chainCheckups([c1i, c2, c3]);
eq('chain: incomplete intake caught', ch.valid, false);
eq('chain: incomplete names record', ch.errors.some(e => e.includes('incomplete')), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
