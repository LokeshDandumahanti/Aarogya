// Tone-classifier tests — pure JS extracted from index.html, run offline.
//
//   node tests/test_tone.mjs
//
// Covers classifyTone (3-tier rule-based) and the empathy score model in
// judgeTone. classifyTone is the offline-safe guard that keeps empathy
// scoring deterministic even when the network is down.

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

// Assemble only the pure pieces + a stubbed judgeTone environment.
const code = [
  grab(/const TONE_DICT = \{[\s\S]*?\n\};/),
  grab(/function classifyTone\([\s\S]*?\n\}/),
  grab(/function judgeTone\([\s\S]*?\n\}/),
  grab(/function getEmpathyTier\(\)[\s\S]*?\n\}/),
  grab(/function getDenialThreshold\(\)[\s\S]*?\n\}/),
  grab(/const VAGUE_IMAGE_RE = .*;/),
  grab(/function detectVagueImageRequest\([\s\S]*?\n\}/),
].join('\n');

const api = new Function('state', 'getTime', 'saveState', code + '\nreturn { classifyTone, judgeTone, getDenialThreshold, detectVagueImageRequest, state };');

const fresh = () => ({ score: 100, messages: [] });
const ctx = () => { const st = { empathy: fresh() }; return api(st, () => '00:00', () => {}); };

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (got === want) pass++;
  else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};

// ── classifyTone: three tiers ──
const { classifyTone } = ctx();
eq('empathetic: please', classifyTone('please take your time'), 'empathetic');
eq('empathetic: empathy phrase', classifyTone('that sounds hard for you'), 'empathetic');
eq('empathetic: thank+understand', classifyTone('thank you, i understand'), 'empathetic');
eq('rude: hurry', classifyTone('hurry up and answer me'), 'rude');
eq('rude: dismissive', classifyTone('just answer me, obviously'), 'rude');
eq('rude: shouting', classifyTone('WHY CANT YOU ANSWER'), 'rude');
eq('rude: repeated !!', classifyTone('answer me!!'), 'rude');
eq('neutral: plain question', classifyTone('tell me about your cough'), 'neutral');
eq('neutral: empty', classifyTone(''), 'neutral');
eq('rude: polite word can\'t rescue', classifyTone('hurry up please'), 'rude'); // −2 (hurry) +1 (please) = −1 → rude

// Profanity + insults — the judge must hear abuse.
eq('rude: profanity', classifyTone('you are such an assfuck'), 'rude');
eq('rude: insult stack', classifyTone('you stupid fucking idiot'), 'rude');
eq('rude: name-calling', classifyTone('shut up you moron'), 'rude');
eq('rude: swear alone', classifyTone('this is bullshit'), 'rude');

// Guard: clinical / benign vocabulary must never false-positive.
eq('neutral: knee-jerk reflex', classifyTone('any knee jerk reflex issues?'), 'neutral');
eq('neutral: finger-prick', classifyTone('should we do a finger prick test'), 'neutral');
eq('neutral: hello', classifyTone('hello doctor'), 'neutral');
eq('neutral: class', classifyTone('my class starts in ten minutes'), 'neutral');

// ── judgeTone: score model ──
const a = ctx();
eq('score: empathetic +1', a.judgeTone('please take your time'), 'empathetic');
eq('score: 101 caps at 100', a.state.empathy.score, 100);
a.judgeTone('hurry up');             // rude
eq('score: rude −5', a.state.empathy.score, 95);
const f = ctx();
f.judgeTone('you are such an assfuck');
eq('score: profanity −5', f.state.empathy.score, 95);
for (let i = 0; i < 25; i++) a.judgeTone('hurry up and answer me');
eq('score: floor at 0', a.state.empathy.score, 0);

// ── detectVagueImageRequest: vague "show me the images" asks ──
const { detectVagueImageRequest } = ctx();
eq('vague: can you show the images', detectVagueImageRequest('can you show the images'), true);
eq('vague: show me', detectVagueImageRequest('show me'), true);
eq('vague: do you have any photos', detectVagueImageRequest('do you have any photos of your hands'), true);
eq('vague: may i see a picture', detectVagueImageRequest('may i see a picture'), true);
eq('vague: want to see the scan', detectVagueImageRequest('i want to see the scan'), true);
eq('not vague: how are you', detectVagueImageRequest('how are you feeling today'), false);
eq('not vague: tell me about your cough', detectVagueImageRequest('tell me about your cough'), false);
eq('not vague: lost weight', detectVagueImageRequest('have you lost weight recently'), false);

// ── getDenialThreshold: tone-dependent reveals ──
const b = ctx();
b.state.empathy.messages.push({ tone: 'empathetic' });
eq('threshold: empathetic', b.getDenialThreshold(), 1);
const c = ctx();
c.state.empathy.messages.push({ tone: 'neutral' });
eq('threshold: neutral', c.getDenialThreshold(), 1);
const d = ctx();
d.state.empathy.messages.push({ tone: 'rude' });
eq('threshold: rude', d.getDenialThreshold(), 3);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
