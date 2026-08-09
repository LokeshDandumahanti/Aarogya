// M2 analytics tests — pure JS extracted from index.html, run offline.
//
//   node tests/test_analytics.mjs
//
// Covers computeTrends (aggregates), extractPatterns (coaching-pattern
// surfacing) and the skill-report markdown (aggregate-only, no patient data).

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
  grab(/function sessionToneRate\([\s\S]*?\n\}/),
  grab(/function computeTrends\([\s\S]*?\n\}/),
  grab(/function extractPatterns\([\s\S]*?\n\}/),
  grab(/function buildSkillReportMarkdown\([\s\S]*?\n\}\n/),
].join('\n');

const api = new Function(code + '\nreturn { sessionToneRate, computeTrends, extractPatterns, buildSkillReportMarkdown };');
const fn = api();

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++;
  else { fail++; console.log(`FAIL ${name}: got ${g}, want ${w}`); }
};
const approx = (name, got, want) => {
  if (got == null) return eq(name, got, want);
  eq(name, Math.round(got * 100) / 100, Math.round(want * 100) / 100);
};

const ses = (o) => ({ remote: false, empathyScore: 100, toneCounts: { empathetic: 3, neutral: 2, rude: 0 }, wrongGuesses: 0, leadingCount: 0, deflects: 0, durationSec: 60, ...o });

// ── computeTrends: empty profile ──
const empty = fn.computeTrends({ sessions: [] });
eq('empty: sessionCount', empty.sessionCount, 0);
eq('empty: empathy null', empty.empathyAll, null);

// ── computeTrends: known aggregates ──
const p = {
  sessions: [
    ses({ empathyScore: 80, toneCounts: { empathetic: 2, neutral: 1, rude: 1 }, leadingCount: 5 }),
    ses({ empathyScore: 90, remote: true, toneCounts: { empathetic: 4, neutral: 1, rude: 0 } }),
    ses({ empathyScore: 70, toneCounts: { empathetic: 1, neutral: 1, rude: 2 }, leadingCount: 8 }),
  ],
};
const t = fn.computeTrends(p);
eq('trends: count', t.sessionCount, 3);
approx('trends: empathy all', t.empathyAll, 80);
approx('trends: empathy recent', t.empathyRecent, 80);          // last 5 = all 3
approx('trends: rude rate', t.rudeRate, (1/4 + 0 + 2/4) / 3);   // per-session average
approx('trends: leading avg', t.leadingPerSession, (5 + 0 + 8) / 3);
eq('trends: remote count', t.remoteCount, 1);
approx('trends: empathy remote', t.empathyRemote, 90);
approx('trends: empathy in person', t.empathyInPerson, (80 + 70) / 2);

// recent window: only last 5
const big = { sessions: Array.from({ length: 7 }, (_, i) => ses({ empathyScore: 100 - i * 5 })) };
const bt = fn.computeTrends(big);
approx('trends: recent = last 5 only', bt.empathyRecent, (90 + 85 + 80 + 75 + 70) / 5);
approx('trends: all = all 7', bt.empathyAll, (100 + 95 + 90 + 85 + 80 + 75 + 70) / 7);

// ── extractPatterns ──
eq('patterns: empty', fn.extractPatterns({ sessions: [] }), []);

const dip = {
  sessions: [
    ses({ empathyScore: 50, remote: true }),
    ses({ empathyScore: 55, remote: true }),
    ses({ empathyScore: 95 }),
    ses({ empathyScore: 95 }),
  ],
};
let pats = fn.extractPatterns(dip);
eq('patterns: remote dip fires', pats.some(x => x.level === 'warn' && x.text.includes('remote')), true);

const lead = { sessions: [ses({ leadingCount: 6 }), ses({ leadingCount: 5 })] };
pats = fn.extractPatterns(lead);
eq('patterns: leading fires', pats.some(x => x.level === 'warn' && x.text.includes('Leading')), true);
eq('patterns: leading is warn', pats.find(x => x.text.includes('Leading')).level, 'warn');

const rude = { sessions: [ses({ toneCounts: { empathetic: 1, neutral: 1, rude: 3 } })] };
pats = fn.extractPatterns(rude);
eq('patterns: rude fires', pats.some(x => x.level === 'warn' && x.text.includes('rude')), true);

const ok = { sessions: [50, 50, 50, 90, 90, 90].map(s => ses({ empathyScore: s })) };
pats = fn.extractPatterns(ok);
eq('patterns: improvement fires', pats.some(x => x.level === 'good' && x.text.includes('improving')), true);
eq('patterns: no warn on clean run', pats.every(x => x.level !== 'warn'), true);

// ── skill report: aggregate-only, no patient data by construction ──
const md = fn.buildSkillReportMarkdown(p);
eq('report: has trends table', md.includes('Average empathy'), true);
eq('report: has patterns section', md.includes('Coaching patterns'), true);
eq('report: no case file ids', /case_|case\.json/i.test(md), false);
eq('report: no patient names', /madhav|meena|arun|shambhu|priya/i.test(md), false);
eq('report: no symptom language', /cough|rash|thirst|glucose|hba1c/i.test(md), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
