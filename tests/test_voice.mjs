// M5 voice-mode proxy tests — no real network; globalThis.fetch is mocked.
//
//   node tests/test_voice.mjs
//
// Covers: wavWrap (the byte-count data-chunk bug), parseAudioParam, the /stt
// Whisper-first ordering (Whisper decides; Gemini is only a last-resort guess),
// the /tts Gemini→fish fallback (and PCM→WAV base64 response), the no-key
// guard, and the dispatch-only chat path.

import assert from 'node:assert';
import * as mod from '../netlify/functions/openrouter.js';

const { wavWrap, parseAudioParam, handleStt, handleTts, handler, ttsDirectorPrompt, cleanTaggedOutput, splitSentences } = mod;

const realFetch = globalThis.fetch;
const mockFetch = (fn) => { globalThis.fetch = fn; };
const restore = () => { globalThis.fetch = realFetch; };

// ── wavWrap: header correctness, especially the data-chunk BYTE count ──
{
  const pcm = Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]);
  const w = wavWrap(pcm, 24000, 1);
  assert.equal(w.length, 44 + 8, '44-byte header + payload');
  assert.equal(w.toString('ascii', 0, 4), 'RIFF');
  assert.equal(w.readUInt32LE(4), 36 + 8, 'RIFF chunk size');
  assert.equal(w.toString('ascii', 8, 12), 'WAVE');
  assert.equal(w.toString('ascii', 12, 16), 'fmt ');
  assert.equal(w.readUInt16LE(20), 1, 'PCM format');
  assert.equal(w.readUInt16LE(22), 1, 'mono');
  assert.equal(w.readUInt32LE(24), 24000, 'sample rate');
  assert.equal(w.readUInt32LE(28), 24000 * 2, 'byte rate');
  assert.equal(w.readUInt16LE(32), 2, 'block align');
  assert.equal(w.readUInt16LE(34), 16, '16-bit');
  assert.equal(w.toString('ascii', 36, 40), 'data');
  assert.equal(w.readUInt32LE(40), pcm.length, 'data chunk = BYTE count, not n/2');
  assert.deepEqual([...w.subarray(44)], [...pcm], 'payload identical');
}

// ── parseAudioParam: parses "audio/pcm; rate=…; channels=…" ──
{
  assert.equal(parseAudioParam('audio/pcm; rate=24000; channels=1', 'rate', 0), 24000);
  assert.equal(parseAudioParam('audio/pcm; rate=24000; channels=1', 'channels', 0), 1);
  assert.equal(parseAudioParam('audio/wav', 'rate', 44100), 44100, 'default when absent');
  assert.equal(parseAudioParam('', 'channels', 2), 2, 'default on empty header');
}

// ── /stt: Whisper (REAL ASR) is the decider — Gemini never consulted ──
// Gemini is a chat model that fabricates a transcript for audio it can't decode
// (verified live: silent WAV → 200 + a made-up sentence). Whisper-first means
// the fabrication path is unreachable when Whisper answers.
{
  process.env.GEMINI_API_KEY = 'g-key';
  process.env.OPENROUTER_API_KEY = 'o-key';
  const seen = [];
  mockFetch(async (url) => {
    seen.push(String(url));
    if (String(url).includes('/audio/transcriptions')) {
      return new Response(JSON.stringify({ text: 'hello doctor' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'gemini should not be called' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  });
  const out = await handleStt({}, { audio: Buffer.from('fake-audio').toString('base64'), format: 'webm' });
  restore();
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  assert.equal(out.statusCode, 200);
  assert.equal(JSON.parse(out.body).text, 'hello doctor');
  assert.ok(seen.every((u) => u.includes('/audio/transcriptions')), 'Whisper decides; generativelanguage never hit');
}

// ── /stt: Whisper "no speech" is believed → text:'', no Gemini fabrication ──
// Whisper returning an empty transcript is an ANSWER (real ASR heard nothing),
// not an error. The client shows "No speech heard" instead of a made-up quote.
{
  process.env.GEMINI_API_KEY = 'g-key';
  process.env.OPENROUTER_API_KEY = 'o-key';
  const seen = [];
  mockFetch(async (url) => {
    seen.push(String(url));
    if (String(url).includes('/audio/transcriptions')) {
      return new Response(JSON.stringify({ text: '' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'gemini should not be called' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  });
  const out = await handleStt({}, { audio: Buffer.from('fake-audio').toString('base64'), format: 'webm' });
  restore();
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  assert.equal(out.statusCode, 200);
  assert.equal(JSON.parse(out.body).text, '', 'empty transcript surfaces as text:"", not a hallucination');
  assert.ok(seen.every((u) => u.includes('/audio/transcriptions')), 'no Gemini call on a real-ASR "no speech"');
}

// ── /stt: Whisper errors → Gemini is the last-resort guess ──
{
  process.env.GEMINI_API_KEY = 'g-key';
  process.env.OPENROUTER_API_KEY = 'o-key';
  const seen = [];
  mockFetch(async (url) => {
    seen.push(String(url));
    if (String(url).includes('/audio/transcriptions')) {
      return new Response(JSON.stringify({ error: 'whisper boom' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(url).includes('generativelanguage')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: 'say it again' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 500 });
  });
  const out = await handleStt({}, { audio: Buffer.from('fake-audio').toString('base64'), format: 'webm' });
  restore();
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  assert.equal(out.statusCode, 200);
  assert.equal(JSON.parse(out.body).text, 'say it again');
  assert.ok(seen.some((u) => u.includes('generativelanguage')), 'Gemini guess used only after Whisper errored');
}

// ── /stt: no provider keys → clean 500 ──
{
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  const out = await handleStt({}, { audio: 'YQ==', format: 'webm' });
  assert.equal(out.statusCode, 500);
  assert.ok(JSON.parse(out.body).error, 'explains the missing keys');
}

// ── /tts: director tags the text → Gemini renders the tagged prompt → WAV ──
{
  process.env.OPENROUTER_API_KEY = 'o-key';
  const pcm = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
  mockFetch(async (url, opts) => {
    if (String(url).includes('/chat/completions')) {
      // speech-director leg
      return new Response(JSON.stringify({ choices: [{ message: { content: '[hmm] hello doctor [coughs]' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    assert.ok(String(url).includes('/audio/speech'), 'TTS hits /audio/speech');
    const body = JSON.parse(opts.body);
    assert.equal(body.model, 'google/gemini-3.1-flash-tts-preview');
    assert.ok(body.input.includes('[coughs]'), 'Gemini receives the tagged prompt');
    return new Response(pcm, { status: 200, headers: { 'Content-Type': 'audio/pcm; rate=24000; channels=1' } });
  });
  const out = await handleTts({}, { text: 'hello doctor', voice: 'charon' });
  restore();
  delete process.env.OPENROUTER_API_KEY;
  assert.equal(out.statusCode, 200);
  assert.equal(out.headers['Content-Type'], 'audio/wav');
  assert.equal(out.isBase64Encoded, true);
  const w = Buffer.from(out.body, 'base64');
  assert.equal(w.toString('ascii', 0, 4), 'RIFF');
  assert.equal(w.readUInt32LE(24), 24000, 'rate preserved from content-type');
  assert.equal(w.readUInt32LE(40), 8, 'data chunk = PCM byte count');
}

// ── /tts: Gemini 5xx → fish answers with the CLEAN text (tags never spoken) ──
{
  process.env.OPENROUTER_API_KEY = 'o-key';
  const pcm = Buffer.from([0, 0, 0, 0, 1, 1, 1, 1]);
  let calls = 0;
  mockFetch(async (url, opts) => {
    calls++;
    const body = JSON.parse(opts.body);
    if (String(url).includes('/chat/completions')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: '[hmm] hi [coughs]' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (body.model === 'google/gemini-3.1-flash-tts-preview') {
      return new Response(JSON.stringify({ error: 'boom' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    if (body.model === 'fish-audio/s2.1-pro-free:free') {
      assert.ok(!body.input.includes('['), 'fish gets the clean text, not tags');
      return new Response(pcm, { status: 200, headers: { 'Content-Type': 'audio/pcm; rate=44100; channels=1' } });
    }
    return new Response('{}', { status: 500 });
  });
  const out = await handleTts({}, { text: 'hi', voice: 'charon' });
  restore();
  delete process.env.OPENROUTER_API_KEY;
  assert.equal(out.statusCode, 200);
  const w = Buffer.from(out.body, 'base64');
  assert.equal(w.readUInt32LE(24), 44100, 'fish sample rate survives the wrap');
  assert.equal(calls, 3, 'director + Gemini + fish');
}

// ── /tts: director fails → plain text degrades gracefully to Gemini ──
{
  process.env.OPENROUTER_API_KEY = 'o-key';
  mockFetch(async (url, opts) => {
    if (String(url).includes('/chat/completions')) {
      return new Response(JSON.stringify({ error: 'director boom' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    const body = JSON.parse(opts.body);
    assert.equal(body.model, 'google/gemini-3.1-flash-tts-preview');
    assert.equal(body.input, 'plain reply', 'falls back to the clean text');
    return new Response(Buffer.from([0, 0, 0, 0]), { status: 200, headers: { 'Content-Type': 'audio/pcm; rate=24000; channels=1' } });
  });
  const out = await handleTts({}, { text: 'plain reply', voice: 'charon' });
  restore();
  delete process.env.OPENROUTER_API_KEY;
  assert.equal(out.statusCode, 200);
}

// ── ttsDirectorPrompt: dialogue verbatim, tag vocabulary + verbatim guard ──
{
  const msgs = ttsDirectorPrompt('beta, mujhe khansi hai');
  assert.equal(msgs[1].content, 'beta, mujhe khansi hai', 'dialogue preserved verbatim');
  assert.ok(msgs[0].content.includes('[coughs]'), 'director knows the tag vocabulary');
  assert.ok(msgs[0].content.includes('NEVER change'), 'verbatim guard present');
}

// ── cleanTaggedOutput: strips fences/quotes, keeps the tags ──
{
  assert.equal(cleanTaggedOutput('```text\n[hmm] beta\n```'), '[hmm] beta');
  assert.equal(cleanTaggedOutput('"[hmm] beta"'), '[hmm] beta');
  assert.equal(cleanTaggedOutput('  [hmm] beta  '), '[hmm] beta');
  assert.equal(cleanTaggedOutput('[hmm] beta'), '[hmm] beta');
  assert.equal(cleanTaggedOutput(''), '');
}

// ── splitSentences: sentence boundaries, hard cap, char limit ──
{
  const a = splitSentences('Pahla. Doosra. Teesra।');
  assert.deepEqual(a, ['Pahla.', 'Doosra.', 'Teesra।'], 'splits Hindi danda + Latin boundaries');
  assert.deepEqual(splitSentences('[hmm] Pahla. [sighs] Doosra.'), ['[hmm] Pahla.', '[sighs] Doosra.'], 'tags ride along with their sentence');

  const six = splitSentences('Pahla. Doosra. Teesra. Chautha. Panchva. Chhatha.');
  assert.equal(six.length, 4, 'capped at 4 chunks');
  assert.ok(six[3].includes('Panchva'), 'overflow merged into the last chunk');

  const long = ('shabd '.repeat(30)).trim(); // 150 chars, no punctuation
  const c = splitSentences(long);
  assert.ok(c.length >= 2, 'long unpunctuated sentence hard-split at a word boundary');
  assert.ok(c.every((ch) => ch.length <= 110), 'each chunk within the char budget');
  assert.equal(c.join(' '), long, 'splitting is lossless (no words dropped)');
}

// ── /tts: multi-sentence reply → one Gemini call per chunk, PCM concatenated ──
{
  process.env.OPENROUTER_API_KEY = 'o-key';
  const chunkPcm = Buffer.from([0, 0, 0, 0, 1, 1, 1, 1]);
  const geminiInputs = [];
  mockFetch(async (url, opts) => {
    if (String(url).includes('/chat/completions')) {
      // speech-director leg
      return new Response(JSON.stringify({ choices: [{ message: { content: '[hmm] First sentence. [sighs] Second sentence. [coughs] Third sentence.' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const body = JSON.parse(opts.body);
    assert.equal(body.model, 'google/gemini-3.1-flash-tts-preview');
    geminiInputs.push(body.input);
    return new Response(chunkPcm, { status: 200, headers: { 'Content-Type': 'audio/pcm; rate=24000; channels=1' } });
  });
  const out = await handleTts({}, { text: 'First sentence. Second sentence. Third sentence.', voice: 'charon' });
  restore();
  delete process.env.OPENROUTER_API_KEY;
  assert.equal(out.statusCode, 200);
  assert.equal(geminiInputs.length, 3, 'one Gemini call per sentence chunk');
  const all = geminiInputs.join(' '); // order-independent — chunks synthesize in parallel
  assert.ok(all.includes('First sentence'), 'chunk 1 intact');
  assert.ok(all.includes('Second sentence'), 'chunk 2 intact');
  assert.ok(all.includes('Third sentence'), 'chunk 3 intact');
  const w = Buffer.from(out.body, 'base64');
  assert.equal(w.readUInt32LE(40), chunkPcm.length * 3, 'WAV data chunk = concatenated PCM bytes');
  assert.equal(w.readUInt32LE(24), 24000, 'rate preserved');
}

// ── /tts: a chunk fails → whole reply falls to fish with clean text ──
{
  process.env.OPENROUTER_API_KEY = 'o-key';
  const pcm = Buffer.from([0, 0, 0, 0, 1, 1, 1, 1]);
  let geminiCalls = 0;
  mockFetch(async (url, opts) => {
    if (String(url).includes('/chat/completions')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: '[hmm] One. Two. Three.' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const body = JSON.parse(opts.body);
    if (body.model === 'google/gemini-3.1-flash-tts-preview') {
      geminiCalls++;
      return new Response(JSON.stringify({ error: 'boom' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    if (body.model === 'fish-audio/s2.1-pro-free:free') {
      assert.ok(!body.input.includes('['), 'fish gets clean text');
      return new Response(pcm, { status: 200, headers: { 'Content-Type': 'audio/pcm; rate=44100; channels=1' } });
    }
    return new Response('{}', { status: 500 });
  });
  const out = await handleTts({}, { text: 'One. Two. Three.', voice: 'charon' });
  restore();
  delete process.env.OPENROUTER_API_KEY;
  assert.equal(out.statusCode, 200);
  assert.ok(geminiCalls >= 1, 'gemini was attempted per chunk');
  const w = Buffer.from(out.body, 'base64');
  assert.equal(w.readUInt32LE(24), 44100, 'fish answered');
}

// ── /tts: no OpenRouter key → clean 500 ──
{
  delete process.env.OPENROUTER_API_KEY;
  const out = await handleTts({}, { text: 'hello' });
  assert.equal(out.statusCode, 500);
  assert.ok(JSON.parse(out.body).error);
}

// ── dispatch-only proof: the chat route still returns patient text ──
{
  process.env.OPENROUTER_API_KEY = 'o-key';
  mockFetch(async (url) => {
    assert.ok(String(url).includes('/chat/completions'), 'chat goes to chat-completions');
    return new Response(JSON.stringify({ choices: [{ message: { content: 'patient reply' } }], model: 'google/gemma-4-26b-a4b-it' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const out = await handler({
    httpMethod: 'POST',
    path: '/api/openrouter',
    headers: {},
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  });
  restore();
  delete process.env.OPENROUTER_API_KEY;
  assert.equal(out.statusCode, 200);
  assert.equal(JSON.parse(out.body).choices[0].message.content, 'patient reply');
}

console.log('voice proxy tests OK');
