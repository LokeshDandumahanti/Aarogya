// N3 — name-keyed storage layer (localStorage cache + Netlify Blobs mirror).
// Pure JS extracted from index.html, run offline with a Map-backed localStorage
// and a stubbed fetch for the sync()/hydrate() blob paths.
//
//   node tests/test_store.mjs
//
// Covers saveCase/getCase round-trip, listSessions shape, removeCase, getLast,
// per-name isolation, offline (storage-throws → sane defaults), sync() POST,
// and hydrate() per-case merge (newest updatedAt wins).

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
  grab(/const STORE_KEY = .*?;/),
  grab(/const store = \{[\s\S]*?\n\};/),
].join('\n');

// fetch + state are only referenced by sync()/hydrate(); existing sync
// scenarios pass a stub fetch and a fake state.
const api = (ls, fetchImpl, stateObj) =>
  new Function('localStorage', 'fetch', 'state', code + '\nreturn store;')(ls, fetchImpl, stateObj);

// A Map-backed localStorage stub.
const makeLs = () => {
  const mem = new Map();
  return {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    _mem: mem,
  };
};

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (got === want) pass++;
  else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};
const ok = (name, cond) => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}`); }
};

const snap = (title, clues, score) => ({
  caseTitle: title,
  discoveredClues: clues,
  empathy: { score, messages: [] },
  updatedAt: 1700000000000,
});

// ── Scenario 1: saveCase/getCase round-trip ──
{
  const st = api(makeLs());
  st.saveCase('dr-lokesh', 'tb', snap('TB', ['a', 'b'], 97));
  const got = st.getCase('dr-lokesh', 'tb');
  ok('getCase returns saved snapshot', !!got);
  eq('caseTitle round-trips', got.caseTitle, 'TB');
  eq('clues round-trip', got.discoveredClues.length, 2);
  eq('empathy round-trips', got.empathy.score, 97);
}

// ── Scenario 2: listSessions shape + last pointer ──
{
  const st = api(makeLs());
  st.saveCase('dr-lokesh', 'tb', snap('TB', ['a', 'b', 'c'], 97));
  st.saveCase('dr-lokesh', 'goitre', snap('Goitre', ['x'], 100));
  const sessions = st.listSessions('dr-lokesh');
  eq('two sessions listed', sessions.length, 2);
  const tb = sessions.find(s => s.caseId === 'tb');
  ok('title present', tb.title === 'TB');
  eq('clueCount computed', tb.clueCount, 3);
  eq('empathyScore computed', tb.empathyScore, 97);
  eq('updatedAt carried', tb.updatedAt, 1700000000000);
  const last = st.getLast();
  eq('getLast case is most recent', last.caseId, 'goitre');
  eq('getLast name', last.name, 'dr-lokesh');
}

// ── Scenario 3: per-name isolation ──
{
  const ls = makeLs();
  const st = api(ls);
  st.saveCase('dr-lokesh', 'tb', snap('TB', ['a'], 90));
  st.saveCase('sister-nurser', 'scabies', snap('Scabies', ['b'], 100));
  const lokesh = api(ls).listSessions('dr-lokesh');
  eq('lokesh sees only his case', lokesh.length, 1);
  eq('lokesh case id', lokesh[0].caseId, 'tb');
  ok('other name not visible', api(ls).getCase('sister-nurser', 'tb') === null);
}

// ── Scenario 4: removeCase ──
{
  const st = api(makeLs());
  st.saveCase('dr-lokesh', 'tb', snap('TB', ['a'], 90));
  st.removeCase('dr-lokesh', 'tb');
  ok('removed case gone', st.getCase('dr-lokesh', 'tb') === null);
  eq('empty list after remove', st.listSessions('dr-lokesh').length, 0);
}

// ── Scenario 5: storage-throws → sane defaults, no crash ──
{
  const throwing = {
    getItem: () => { throw new Error('quota'); },
    setItem: () => { throw new Error('quota'); },
    removeItem: () => {},
  };
  const st = api(throwing);
  const d = st.load();
  eq('load falls back to default', JSON.stringify(d), JSON.stringify({ last: null, profiles: {} }));
  ok('saveCase swallows storage errors', (() => { try { st.saveCase('x', 'tb', snap('TB', [], 100)); return true; } catch (e) { return false; } })());
  eq('getLast still null', st.getLast(), null);
}

// ── Scenario 6: listSessions handles a snapshot missing optional fields ──
{
  const st = api(makeLs());
  st.saveCase('dr-lokesh', 'tb', { caseTitle: 'TB' }); // no discoveredClues / empathy / updatedAt
  const s = st.listSessions('dr-lokesh')[0];
  eq('default clueCount', s.clueCount, 0);
  eq('default empathyScore', s.empathyScore, 100);
  eq('default updatedAt', s.updatedAt, 0);
}

// ── Scenario 7: sync() POSTs the profile to /api/store, fire-and-forget ──
{
  const posts = [];
  const st = api(makeLs(), async (url, opts) => { posts.push({ url, body: JSON.parse(opts.body) }); return { ok: true }; }, { doctorName: 'dr-lokesh' });
  st.saveCase('dr-lokesh', 'tb', snap('TB', ['a', 'b'], 90));
  st.sync();
  // The chain is a chained promise; let it settle on the microtask queue.
  await new Promise((r) => setTimeout(r, 0));
  eq('sync POSTs to /api/store', posts.length, 1);
  eq('POST carries the name', posts[0].body.name, 'dr-lokesh');
  eq('POST carries the profile case', posts[0].body.profile.cases.tb.caseTitle, 'TB');
  eq('POST carries the last pointer', posts[0].body.profile.lastCaseId, 'tb');
}

// ── Scenario 8: sync() skips the default 'local' name ──
{
  const posts = [];
  const st = api(makeLs(), async (url, opts) => { posts.push(1); return { ok: true }; }, { doctorName: 'local' });
  st.sync();
  await new Promise((r) => setTimeout(r, 0));
  eq('no POST for default name', posts.length, 0);
}

// ── Scenario 9: hydrate() merges remote — newest updatedAt wins, both sides survive ──
{
  const ls = makeLs();
  const st = api(ls, async () => ({
    ok: true,
    json: async () => ({ profile: {
      lastCaseId: 'goitre',
      cases: {
        tb: { caseTitle: 'TB', discoveredClues: ['remote-new'], updatedAt: 2000000000000 }, // remote newer
        goitre: { caseTitle: 'Goitre', discoveredClues: ['g'], updatedAt: 1800000000000 },   // remote-only
      },
    } }),
  }), { doctorName: 'dr-lokesh' });
  st.saveCase('dr-lokesh', 'tb', snap('TB', ['local'], 90));        // updatedAt 1700000000000 (older)
  st.saveCase('dr-lokesh', 'scabies', snap('Scabies', ['s'], 100)); // local-only
  await st.hydrate('dr-lokesh');
  const prof = api(ls).getProfile('dr-lokesh');
  eq('remote-newer tb adopted', prof.cases.tb.updatedAt, 2000000000000);
  ok('remote tb clues adopted', prof.cases.tb.discoveredClues.includes('remote-new'));
  eq('remote-only goitre adopted', prof.cases.goitre.caseTitle, 'Goitre');
  ok('local-only scabies survives', !!prof.cases.scabies);
  eq('merged lastCaseId', prof.lastCaseId, 'goitre');
  eq('getLast tracks merge', api(ls).getLast().caseId, 'goitre');
}

// ── Scenario 10: hydrate() keeps the local copy when local is newer ──
{
  const ls = makeLs();
  const st = api(ls, async () => ({
    ok: true,
    json: async () => ({ profile: {
      lastCaseId: 'tb',
      cases: { tb: { caseTitle: 'TB', discoveredClues: ['remote'], updatedAt: 1700000000000 } },
    } }),
  }), { doctorName: 'dr-lokesh' });
  st.saveCase('dr-lokesh', 'tb', { ...snap('TB', ['local-new'], 90), updatedAt: 2000000000000 }); // local newer
  await st.hydrate('dr-lokesh');
  const prof = api(ls).getProfile('dr-lokesh');
  ok('newer local clues survive', prof.cases.tb.discoveredClues.includes('local-new'));
  eq('newer local timestamp wins', prof.cases.tb.updatedAt, 2000000000000);
}

// ── Scenario 11: hydrate() offline (fetch throws) → localStorage unchanged ──
{
  const ls = makeLs();
  const st = api(ls, async () => { throw new Error('offline'); }, { doctorName: 'dr-lokesh' });
  st.saveCase('dr-lokesh', 'tb', snap('TB', ['a'], 90));
  await st.hydrate('dr-lokesh');
  ok('local copy intact after failed hydrate', !!api(ls).getCase('dr-lokesh', 'tb'));
}

console.log(`\nstore: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
