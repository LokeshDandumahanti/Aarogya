// M4 privacy-wall tests — pure JS extracted from index.html, run offline.
//
//   node tests/test_privacy.mjs
//
// employerExport must be aggregate/outcome-only BY CONSTRUCTION: the stringified
// export may contain none of the source PHI (identity, symptom text, meds,
// plans, vitals detail). This test feeds a PHI-rich dataset and asserts the
// wall holds, plus the aggregate numbers are right.

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

const code = grab(/function employerExport\([\s\S]*?\n\}/);
const api = new Function(code + '\nreturn { employerExport };');
const fn = api();

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++;
  else { fail++; console.log(`FAIL ${name}: got ${g}, want ${w}`); }
};

// ── PHI-rich records: real names, symptoms, meds, plans, vitals ──
const phiStrings = []; // every PHI value that must never appear in the export
const capture = (...xs) => xs.forEach(x => phiStrings.push(String(x)));

const rec = (patientId, month, o) => {
  const symptoms = { status: 'worse', notes: 'legs swelling, chest tightness at night' };
  const vitals = { bp: '158/96', pulse: 88, weight: 74.2, glucose: o && o.glucose != null ? o.glucose : 189 };
  const meds = { list: ['amlodipine 5 mg once daily', 'metformin 500 mg twice daily'] };
  const plan = { followUp: 'Refer to cardiology, review BP weekly', nextMonth: '2026-08-08' };
  const adherence = { level: (o && o.adherenceLevel) || 'low', missedDoses: 7 };
  const r = { id: `ck-${patientId}-${month}`, patientId, month, intake: { symptoms, vitals, meds, adherence }, plan, signedAt: '2026-07-08T10:00:00Z' };
  capture(patientId, r.id, symptoms.status, symptoms.notes, vitals.bp, vitals.pulse, vitals.weight, vitals.glucose, meds.list.join(','), plan.followUp, plan.nextMonth);
  return Object.assign(r, o || {});
};

// patientIds double as identity tokens — the export must never echo them
const r1 = rec('shambhu', 1, { glucose: 189, adherenceLevel: 'low' });   // signed, flagged
const r2 = rec('shambhu', 2, { glucose: 132, adherenceLevel: 'high' });  // signed, in range
const r3 = rec('meena', 1, { signedAt: null });                          // unsigned — excluded
const r4 = rec('arun', 1, { glucose: 189, adherenceLevel: 'medium' });   // signed, flagged

const out = fn.employerExport([r1, r2, r3, r4]);

// ── the wall ──
const s = JSON.stringify(out);
const leaked = phiStrings.filter(p => p && p.length >= 3 && s.includes(p));
eq('wall: no PHI leaked', leaked, []);
eq('wall: no identity tokens', /shambhu|meena|arun/.test(s), false);
eq('wall: no symptom content', /swelling|tightness/i.test(s), false);
eq('wall: no vitals detail', /158\/96|189|74\.2|88/.test(s), false);
eq('wall: no meds', /amlodipine|metformin/i.test(s), false);
eq('wall: no plan text', /cardiology|refer|weekly/i.test(s), false);
eq('wall: exact shape', Object.keys(out).sort(),
  ['adherence', 'completedCheckups', 'completionRate', 'enrollment', 'flagsCaught', 'generatedFor']);

// ── aggregates are right ──
eq('agg: employer surface', out.generatedFor, 'employer');
eq('agg: enrollment = distinct signed patients', out.enrollment, 2);      // shambhu + arun
eq('agg: completed = signed count', out.completedCheckups, 3);            // r1, r2, r4
eq('agg: completion rate', out.completionRate, Math.round(3 / 4 * 100));  // 3 signed of 4 stored
eq('agg: adherence distribution', out.adherence, { high: 1, medium: 1, low: 1 });
eq('agg: flags caught', out.flagsCaught, 2);                              // r1, r4 (r2 in range)

// defensive: a signed record with no intake at all must not crash or leak
const bare = fn.employerExport([{ signedAt: '2026-07-08', patientId: 'someone', id: 'x' }]);
eq('agg: bare record safe', bare.completedCheckups, 1);
eq('agg: bare record no leak', JSON.stringify(bare).includes('someone'), false);

// empty input is safe
const empty = fn.employerExport([]);
eq('agg: empty safe', empty, { generatedFor: 'employer', enrollment: 0, completedCheckups: 0, completionRate: 0, adherence: { high: 0, medium: 0, low: 0 }, flagsCaught: 0 });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
