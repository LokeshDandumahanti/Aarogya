// Netlify Function — model proxy with a failover cascade.
//
// Leg 1 (V7, front): Gemma via local Ollama (the field/offline leg) —
//                    http://127.0.0.1:11434, model OLLAMA_MODEL. Fails fast to
//                    the online legs whenever Ollama is unreachable — which on
//                    the deployed Netlify site is always (localhost there is
//                    not the laptop), so deployed runs use OpenRouter; on a
//                    training-center laptop under `netlify dev` this is the
//                    primary path.
// Leg 2:            Gemma on OpenRouter (hosted) — OPENROUTER_API_KEY.
// Leg 3:            Gemini on Google's OpenAI-compatible endpoint — GEMINI_API_KEY.
//                   If no Gemini key is set, falls back to Gemma 31B on OpenRouter
//                   instead (same key, keeps the cascade two-legged under Netlify's
//                   ~10s function cap).
//
// Frontend calls this instead of the providers directly.

const PRIMARY_MODEL = 'google/gemma-4-26b-a4b-it';
const FALLBACK_OPENROUTER_MODEL = 'google/gemma-4-31b-it';
const GEMINI_MODEL = 'gemini-flash-latest'; // resolves to Gemini 3.6 Flash for this account
const GEMINI_CHAT_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const ATTEMPT_TIMEOUT_MS = 4500;

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4:e2b-it-qat';
const OLLAMA_TIMEOUT_MS = 3000;

// M5 — audio routes. Gemini TTS is reachable on OpenRouter's /audio/speech
// even though it is absent from the /models catalog (detail endpoint 404s).
const OPENROUTER_TTS_URL = 'https://openrouter.ai/api/v1/audio/speech';
const OPENROUTER_STT_URL = 'https://openrouter.ai/api/v1/audio/transcriptions';
const GEMINI_TTS_MODEL = 'google/gemini-3.1-flash-tts-preview';
const FISH_TTS_MODEL = 'fish-audio/s2.1-pro-free:free';
const WHISPER_MODEL = 'openai/whisper-large-v3';
const AUDIO_TIMEOUT_MS = 8000;
// Speech director: a short LLM call that converts the patient's plain reply
// into a V3-style tagged TTS prompt ([coughs], [hmm], [long pause], ...).
// Bounded so the full TTS budget (8 + 8 + 8 = 24s) stays under Netlify's 26s.
// Measured ~5.4s on a one-sentence Hindi reply (2026-08-08); longer replies
// need headroom or they time out and silently fall back to plain text.
const DIRECTOR_TIMEOUT_MS = 8000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function postJson(url, payload, headers, timeoutMs = ATTEMPT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Native fetch (undici), not https.request: Node's http client is
    // intermittently served an HTML bot-challenge page by both Netlify
    // (OpenRouter) and Google, while undici's TLS fingerprint passes cleanly.
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    try {
      return { status: res.status, body: JSON.parse(text) };
    } catch {
      // A 2xx with a non-JSON body (HTML redirect/error page) must count as
      // a FAILED leg, not a success — force a non-2xx so the cascade moves on.
      return { status: 502, body: { error: 'Upstream returned a non-JSON response.' } };
    }
  } catch (err) {
    // Abort before Netlify's runtime timeout (~10s) so the client receives
    // clean JSON, never a raw "TimeoutError" page.
    throw new Error(err.name === 'AbortError' ? 'Upstream timed out — please try again.' : err.message);
  } finally {
    clearTimeout(timer);
  }
}

function postOpenRouter(payload, apiKey, referer, timeoutMs = ATTEMPT_TIMEOUT_MS) {
  return postJson('https://openrouter.ai/api/v1/chat/completions', payload, {
    Authorization: `Bearer ${apiKey}`,
    'HTTP-Referer': referer || 'https://aarogya-vp.netlify.app',
  }, timeoutMs);
}

function postGemini(payload, geminiKey) {
  // Gemini spends part of its token budget "thinking" before the visible
  // answer; give it headroom so real replies are not truncated.
  return postJson(GEMINI_CHAT_URL, { ...payload, max_tokens: Math.max(payload.max_tokens || 0, 400) }, {
    Authorization: `Bearer ${geminiKey}`,
  });
}

// Try each leg in order; return the first 2xx. Exposed for unit tests.
async function runCascade(legs) {
  for (const leg of legs) {
    const res = await Promise.resolve()
      .then(leg.run)
      .catch((err) => ({ status: 504, body: { error: err.message } }));
    if (res.status >= 200 && res.status < 300) return res;
  }
  return { status: 503, body: { error: 'All model providers unavailable — please try again.' } };
}

// ════════════════════════════════════════════════════════════
// M5 — STT (speech → text) + TTS (text → speech) routes
// ════════════════════════════════════════════════════════════

function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// WAV wrapper for raw PCM. The `data` chunk size must be the BYTE count of the
// PCM (n), not the sample count (n/2 truncates the clip early).
function wavWrap(pcm, rate = 24000, channels = 1) {
  const n = pcm.length;
  const b = Buffer.alloc(44 + n);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * channels * 2, 28);
  b.writeUInt16LE(channels * 2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n, 40);
  pcm.copy(b, 44);
  return b;
}

function parseAudioParam(contentType, key, def) {
  const m = String(contentType).match(new RegExp(key + '=([0-9]+)'));
  return m ? parseInt(m[1], 10) : def;
}

// Low-level byte POST — audio responses are binary, not JSON. Native fetch
// (undici), never https.request: same TLS-fingerprint reasoning as postJson.
async function postBytes(url, body, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUDIO_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    const buffer = Buffer.from(await res.arrayBuffer());
    return { status: res.status, contentType: res.headers.get('content-type') || '', buffer };
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? 'Upstream timed out.' : err.message);
  } finally {
    clearTimeout(timer);
  }
}

// Each STT/TTS leg returns { status, body } so runCascade does the fallback
// untouched: a non-2xx (or a thrown timeout) falls through to the next leg.

async function geminiStt(audioB64, fmt, geminiKey) {
  const res = await postJson(GEMINI_CHAT_URL, {
    model: GEMINI_MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Transcribe the speech in this audio. Reply with only the transcribed words.' },
        { type: 'input_audio', input_audio: { data: audioB64, format: fmt } },
      ],
    }],
    max_tokens: 1000, // thinking spends a real token budget; a small cap returns empty
  }, { Authorization: `Bearer ${geminiKey}` }, AUDIO_TIMEOUT_MS);
  if (res.status >= 200 && res.status < 300) {
    const text = String(res.body?.choices?.[0]?.message?.content || '').trim();
    if (text) return { status: 200, body: text };
    return { status: 502, body: { error: 'Gemini STT returned an empty transcription.' } };
  }
  return res;
}

async function whisperStt(audioB64, fmt, openrouterKey) {
  const audio = Buffer.from(audioB64, 'base64');
  const boundary = '----aarogya' + Math.random().toString(16).slice(2);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${WHISPER_MODEL}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${fmt}"\r\nContent-Type: audio/${fmt}\r\n\r\n`);
  const tail = Buffer.from('\r\n--' + boundary + '--\r\n');
  const res = await postBytes(OPENROUTER_STT_URL, Buffer.concat([head, audio, tail]), {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    Authorization: `Bearer ${openrouterKey}`,
  });
  if (res.status >= 200 && res.status < 300) {
    const text = String((JSON.parse(res.buffer.toString() || '{}') || {}).text || '').trim();
    if (text) return { status: 200, body: text };
    // Whisper is REAL ASR — an empty transcript means it genuinely heard no
    // speech. That is an ANSWER, not an error: 204 makes handleStt return
    // text:'' to the client instead of cascading into Gemini's fabrication.
    return { status: 204, body: '' };
  }
  return res;
}

async function handleStt(event, body) {
  const { audio, format } = body;
  if (!audio) return json(400, { error: 'Missing audio (base64).' });
  const fmt = String(format || 'webm').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'webm';
  const geminiKey = process.env.GEMINI_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (!geminiKey && !openrouterKey) return json(500, { error: 'No STT provider configured (need GEMINI_API_KEY or OPENROUTER_API_KEY).' });

  // Whisper is REAL ASR — it is the decider. Gemini is a chat model doing ASR
  // by instruction: it FABRICATES a plausible transcript for audio it cannot
  // decode (verified live: a silent WAV returns 200 + a made-up sentence), so
  // it is only a last-resort guess when Whisper actually errors, never primary.
  if (openrouterKey) {
    let w;
    try { w = await whisperStt(audio, fmt, openrouterKey); }
    catch (e) { /* whisper errored — try the Gemini guess */ }
    if (w && w.status === 200) return json(200, { text: w.body });
    if (w && w.status === 204) return json(200, { text: '' }); // real ASR heard no speech — believe it
    // else whisper errored → fall through to the Gemini last resort
  }
  if (geminiKey) {
    try {
      const g = await geminiStt(audio, fmt, geminiKey);
      if (g.status >= 200 && g.status < 300 && g.body) return json(200, { text: g.body });
    } catch (e) { /* fall through */ }
  }
  return json(502, { error: 'No STT leg succeeded — please try again.' });
}

async function geminiTts(text, voice, openrouterKey) {
  const res = await postBytes(OPENROUTER_TTS_URL,
    JSON.stringify({ model: GEMINI_TTS_MODEL, input: text, voice }),
    { 'Content-Type': 'application/json', Authorization: `Bearer ${openrouterKey}` });
  const ok = res.status >= 200 && res.status < 300;
  if (ok && res.buffer.length) {
    return { status: 200, body: { buffer: res.buffer, rate: parseAudioParam(res.contentType, 'rate', 24000), channels: parseAudioParam(res.contentType, 'channels', 1) } };
  }
  return { status: ok ? 502 : res.status, body: { error: ok ? 'Gemini TTS returned no audio.' : 'Gemini TTS failed.' } };
}

async function fishTts(text, openrouterKey) {
  // Free tier renders ONE default voice; `speed` works, `voice`/reference_id dropped.
  const res = await postBytes(OPENROUTER_TTS_URL,
    JSON.stringify({ model: FISH_TTS_MODEL, input: text }),
    { 'Content-Type': 'application/json', Authorization: `Bearer ${openrouterKey}` });
  const ok = res.status >= 200 && res.status < 300;
  if (ok && res.buffer.length) {
    return { status: 200, body: { buffer: res.buffer, rate: parseAudioParam(res.contentType, 'rate', 44100), channels: parseAudioParam(res.contentType, 'channels', 1) } };
  }
  return { status: ok ? 502 : res.status, body: { error: ok ? 'fish TTS returned no audio.' : 'fish TTS failed.' } };
}

// ── Speech director: plain reply → V3-style tagged TTS prompt ──
// The patient model writes clean text; this tiny LLM call re-emits it VERBATIM
// with [bracket] stage directions an elderly delivery would use ([hmm],
// [clears throat], [coughs], [long pause], ...). Gemini TTS renders the tags
// (Sir's listening test on tools/tts_probe confirmed the V3 style works);
// fish ignores them and would read "[coughs]" aloud, so it always gets the
// clean text. Any director failure degrades to the plain reply — the patient
// still speaks.

function ttsDirectorPrompt(text) {
  return [
    { role: 'system', content: [
      'You are a speech director for a text-to-speech engine.',
      'The speaker is a frail elderly Indian patient. Turn the dialogue into a TTS prompt by inserting [bracket] stage directions where a natural delivery would put them: [hmm], [clears throat], [coughs], [sighs], [breathes], [short pause], [long pause], [hesitates], [voice cracks].',
      'Use them sparingly (2-6 per short reply); prefer pauses and hesitation over actions. A single short phrase gets at most one pause tag.',
      'NEVER change, add, remove, or translate a single word of the dialogue.',
      'Reply with ONLY the tagged dialogue — no explanation, no code fences, no quotes.',
    ].join('\n') },
    { role: 'user', content: text },
  ];
}

function cleanTaggedOutput(raw) {
  let s = String(raw || '').trim();
  const fence = s.match(/^```[a-z]*\s*\n([\s\S]*?)\n```$/i);
  if (fence) s = fence[1].trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1).trim();
  return s;
}

async function directorTag(text, openrouterKey) {
  const res = await postOpenRouter({
    messages: ttsDirectorPrompt(text),
    model: PRIMARY_MODEL,
    max_tokens: 400,
    temperature: 0.4,
  }, openrouterKey, null, DIRECTOR_TIMEOUT_MS);
  if (res.status >= 200 && res.status < 300) {
    const tagged = cleanTaggedOutput(res.body?.choices?.[0]?.message?.content || '');
    if (tagged) return tagged;
  }
  return text;
}

// Sentence-chunk synthesis. Gemini TTS generation time scales with clip length:
// a 4-sentence clip exceeds the 8s audio timeout and silently falls to fish,
// losing the tags (measured 2026-08-08: >8s timeout on a 4-sentence tagged
// reply). Splitting into ≤110-char chunks keeps every Gemini call under the
// budget; the chunks are concatenated into ONE WAV so the client is untouched.
// If any chunk fails, the whole reply falls to fish with the clean text.
function splitSentences(text, maxChunks = 4, maxChars = 110) {
  const parts = String(text).split(/(?<=[।.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (let p of parts) {
    while (p.length > maxChars) {
      const cut = p.lastIndexOf(' ', maxChars);
      if (cut < 40) break; // no safe word-boundary — keep the long sentence whole
      out.push(p.slice(0, cut).trim());
      p = p.slice(cut).trim();
    }
    out.push(p);
  }
  return out.length <= maxChunks
    ? out
    : out.slice(0, maxChunks - 1).concat([out.slice(maxChunks - 1).join(' ')]);
}

async function synthGeminiChunked(text, voice, openrouterKey) {
  const chunks = splitSentences(text);
  if (chunks.length === 1) return geminiTts(chunks[0], voice, openrouterKey);
  // Parallel synthesis: chunks are independent, so 4 × ~4s becomes ~4s total —
  // keeps the whole route well under Netlify's 26s cap even with a fish
  // fallback. Promise.all preserves input order for the final concatenation.
  const safe = async (chunk) => {
    try { return await geminiTts(chunk, voice, openrouterKey); }
    catch { return await geminiTts(chunk, voice, openrouterKey); } // one retry for transient flakes
  };
  const results = await Promise.all(chunks.map(safe));
  const parts = [];
  let rate = 24000;
  let channels = 1;
  for (const r of results) {
    if (r.status < 200 || r.status >= 300 || !r.body || !r.body.buffer.length) {
      throw new Error('Gemini TTS chunk failed'); // cascade moves on to fish
    }
    rate = r.body.rate;
    channels = r.body.channels;
    parts.push(r.body.buffer);
  }
  return { status: 200, body: { buffer: Buffer.concat(parts), rate, channels } };
}

async function handleTts(event, body) {
  const { text, voice } = body;
  if (!text) return json(400, { error: 'Missing text.' });
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (!openrouterKey) return json(500, { error: 'OpenRouter API key not configured.' });
  const voiceName = /^[a-z0-9-]+$/i.test(voice || '') ? voice : 'charon';
  const start = Date.now();
  let tagged = text;
  try { tagged = await directorTag(text, openrouterKey); } catch { /* speak the plain reply */ }
  const result = await runCascade([
    { label: 'gemini tts (chunked)', run: () => synthGeminiChunked(tagged, voiceName, openrouterKey) },
    { label: 'fish tts', run: () => {
      // Netlify hard-cuts the function at 26s — a raw 502 page beats clean audio.
      // If the director + gemini retries already burned ~16s, fish (8s) would push
      // past the cap; fail loudly now instead so the client keeps the text.
      if (Date.now() - start > 16000) throw new Error('Voice synthesis timed out — please try again.');
      return fishTts(text, openrouterKey);
    } },
  ]);
  if (result.status >= 200 && result.status < 300) {
    const { buffer, rate, channels } = result.body;
    // Client plays this as a plain WAV blob — no PCM code in the browser.
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'audio/wav' },
      body: wavWrap(buffer, rate, channels).toString('base64'),
      isBase64Encoded: true,
    };
  }
  return json(result.status, result.body);
}

// ════════════════════════════════════════════════════════════
// Route dispatch — audio calls branch before the chat body parse
// ════════════════════════════════════════════════════════════

function routeOf(event, body) {
  const p = String(event.path || '');
  if (p.endsWith('/stt')) return 'stt';
  if (p.endsWith('/tts')) return 'tts';
  // Belt-and-suspenders: if a proxy rewrites event.path, the client's explicit
  // `route` field still routes correctly. Chat bodies never carry it.
  if (body && body.route === 'stt') return 'stt';
  if (body && body.route === 'tts') return 'tts';
  if (body && body.route === 'debug') return 'debug';
  return 'chat';
}

exports.handler = async (event) => {
  // Handle preflight CORS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: 'Method Not Allowed' };
  }

  let body = {};
  let bodyParsed = true;
  try { body = JSON.parse(event.body || '{}'); } catch { bodyParsed = false; }

  const route = routeOf(event, body);
  if (route === 'debug') {
    let ollamaReachable = false;
    try {
      const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
      ollamaReachable = r.ok;
    } catch { ollamaReachable = false; }
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ollamaReachable,
        openrouterKey: !!process.env.OPENROUTER_API_KEY,
        geminiKey: !!process.env.GEMINI_API_KEY,
      }),
    };
  }
  if (route === 'stt') return handleStt(event, body);
  if (route === 'tts') return handleTts(event, body);
  return handleChat(event, body, bodyParsed);
};

// The original chat handler — extracted verbatim; the body now arrives parsed.
// V7: local Gemma via Ollama — the front/offline leg. Converts the app's
// OpenAI-style messages (including image_url parts, so vision works offline)
// to Ollama's { role, content, images[] } shape and maps the reply back.
async function ollamaMessages(openaiMessages) {
  const out = [];
  for (const m of openaiMessages || []) {
    if (typeof m.content === 'string') { out.push({ role: m.role, content: m.content }); continue; }
    const parts = Array.isArray(m.content) ? m.content : [];
    const text = parts.filter(p => p.type === 'text').map(p => p.text || '').join('\n');
    const images = [];
    for (const p of parts) {
      if (p.type === 'image_url' && p.image_url && p.image_url.url) {
        try {
          const r = await fetch(p.image_url.url);
          images.push(Buffer.from(await r.arrayBuffer()).toString('base64'));
        } catch { /* unreadable image → text-only leg */ }
      }
    }
    out.push({ role: m.role, content: text || '[image]', images });
  }
  return out;
}

async function postOllama(payload, model) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  try {
    const messages = await ollamaMessages(payload.messages);
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: { temperature: payload.temperature ?? 0.7, num_predict: payload.max_tokens || 200 },
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.message) {
      return { status: res.status || 502, body: { error: (data.error && data.error.message) || 'Ollama unavailable.' } };
    }
    return { status: 200, body: { choices: [{ message: { role: 'assistant', content: data.message.content || '' } }] } };
  } catch (err) {
    // Connection refused / timeout → the cascade moves to the online legs.
    throw new Error(err.name === 'AbortError' ? 'Ollama timed out.' : `Ollama unreachable (${err.message})`);
  } finally {
    clearTimeout(timer);
  }
}

async function handleChat(event, body, bodyParsed) {
  try {
    if (!bodyParsed) throw new Error('Invalid JSON body.');
    const { messages, model, max_tokens, temperature } = body;

    const base = {
      messages,
      max_tokens: max_tokens || 200,
      temperature: temperature || 0.7,
    };

    const API_KEY = process.env.OPENROUTER_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    const referer = event.headers.referer;

    // Leg 1 — local Gemma via Ollama (the field/offline front). It fails fast
    // to the online legs whenever Ollama isn't reachable.
    const legs = [{ label: 'gemma (Ollama local)', run: () => postOllama(base, OLLAMA_MODEL) }];

    if (API_KEY) {
      legs.push({ label: 'gemma (OpenRouter)', run: () => postOpenRouter({ ...base, model: model || PRIMARY_MODEL }, API_KEY, referer) });
    }
    if (geminiKey) {
      legs.push({ label: 'gemini (Google)', run: () => postGemini({ ...base, model: GEMINI_MODEL }, geminiKey) });
    } else if (API_KEY) {
      legs.push({ label: 'gemma 31B (OpenRouter)', run: () => postOpenRouter({ ...base, model: FALLBACK_OPENROUTER_MODEL }, API_KEY, referer) });
    }

    const result = await runCascade(legs);

    return {
      statusCode: result.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(result.body),
    };
  } catch (err) {
    const isTimeout = /timed out|timeout/i.test(String(err.message));
    return {
      statusCode: isTimeout ? 504 : 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
}

// Exported for tests.
exports.runCascade = runCascade;
exports.PRIMARY_MODEL = PRIMARY_MODEL;
exports.FALLBACK_OPENROUTER_MODEL = FALLBACK_OPENROUTER_MODEL;
exports.GEMINI_MODEL = GEMINI_MODEL;
exports.wavWrap = wavWrap;
exports.parseAudioParam = parseAudioParam;
exports.handleStt = handleStt;
exports.handleTts = handleTts;
exports.geminiStt = geminiStt;
exports.whisperStt = whisperStt;
exports.geminiTts = geminiTts;
exports.fishTts = fishTts;
exports.ttsDirectorPrompt = ttsDirectorPrompt;
exports.cleanTaggedOutput = cleanTaggedOutput;
exports.directorTag = directorTag;
exports.splitSentences = splitSentences;
exports.synthGeminiChunked = synthGeminiChunked;
