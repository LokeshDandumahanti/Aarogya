// M1 remote-encounter empathy tests — pure JS extracted from index.html, run offline.
//
//   node tests/test_remote.mjs
//
// Covers classifyRemoteSignals (3-signal rule-based axis: acknowledgedRemote /
// reassuredExamLimits / clearFollowUp), the delta scoring, and the per-case
// one-shot signal persistence in judgeRemote. Offline-safe like the tone tier.

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
  grab(/const REMOTE_SIGNAL_DICT = \{[\s\S]*?\n\};/),
  grab(/function classifyRemoteSignals\([\s\S]*?\n\}/),
  grab(/function remoteSignalDelta\([\s\S]*?\n\}/),
  grab(/function judgeRemote\([\s\S]*?\n\}/),
  grab(/function remoteCareScore\([\s\S]*?\n\}/),
].join('\n');

const api = new Function('state', 'saveState', code + '\nreturn { classifyRemoteSignals, remoteSignalDelta, judgeRemote, remoteCareScore, state };');
const ctx = () => { const st = { empathy: { score: 100, messages: [], remote: { signals: {} } } }; return api(st, () => {}); };

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (got === want) pass++;
  else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};

// ── classifyRemoteSignals: signal positives ──
const { classifyRemoteSignals } = ctx();
eq('ack: video call', classifyRemoteSignals('i know a video call feels strange').acknowledgedRemote, true);
eq('ack: camera', classifyRemoteSignals('its a bit odd talking through a camera').acknowledgedRemote, true);
eq('ack: online', classifyRemoteSignals('we are doing this online').acknowledgedRemote, true);
eq('ack: not in person', classifyRemoteSignals('i cant examine you in person today').acknowledgedRemote, true);
eq('reassure: okay + no exam', classifyRemoteSignals('thats okay, we can still figure this out').reassuredExamLimits, true);
eq('reassure: even without exam', classifyRemoteSignals('even without touching you we can tell a lot').reassuredExamLimits, true);
eq('reassure: manage', classifyRemoteSignals('no problem, we can manage this together').reassuredExamLimits, true);
eq('followup: come back', classifyRemoteSignals('come back next month for a check').clearFollowUp, true);
eq('followup: follow up', classifyRemoteSignals('we will follow up in one month').clearFollowUp, true);
eq('followup: repeat test', classifyRemoteSignals('we will do a repeat sugar test in a month').clearFollowUp, true);

// ── negatives: plain clinical questions must not fire ──
eq('neg: history question', classifyRemoteSignals('tell me about your cough').acknowledgedRemote, false);
eq('neg: no exam mention', classifyRemoteSignals('please take your time').reassuredExamLimits, false);
eq('neg: empty', classifyRemoteSignals('').acknowledgedRemote, false);
eq('neg: screen not keyword', classifyRemoteSignals('do you see a rash on your screen? no').acknowledgedRemote, true); // "on your screen" still counts
eq('neg: plain', classifyRemoteSignals('any fever at night').clearFollowUp, false);

// ── remoteSignalDelta: 0-3 ──
const { remoteSignalDelta } = ctx();
eq('delta: none', remoteSignalDelta('tell me about your cough'), 0);
eq('delta: one', remoteSignalDelta('i know video calls feel strange'), 1);
eq('delta: two', remoteSignalDelta('thats okay, we can figure this out over video'), 2);
eq('delta: three', remoteSignalDelta('i know this video call is odd, thats okay, we will follow up next month'), 3);

// ── judgeRemote: one-shot signal persistence + score cap ──
const a = ctx();
eq('judge: delta 2 first msg', a.judgeRemote('thats okay, we can still work it out over video'), 2);
eq('judge: score 2/3', a.remoteCareScore(), 2);
eq('judge: repeat signal no recount', a.judgeRemote('really, its fine over video'), 0); // both already counted
eq('judge: score stays 2/3', a.remoteCareScore(), 2);
eq('judge: new signal delta 1', a.judgeRemote('and we will follow up next month'), 1);
eq('judge: score 3/3', a.remoteCareScore(), 3);

// ── judgeRemote must not clobber unrelated empathy state ──
const b = ctx();
b.state.empathy.messages.push({ text: 'x', tone: 'neutral' });
b.judgeRemote('we will follow up next month');
eq('judge: preserves tone history', b.state.empathy.messages.length, 1);
eq('judge: preserves base score', b.state.empathy.score, 100);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
