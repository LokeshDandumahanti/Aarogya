// Client voice helper tests — pure function extracted from index.html by regex,
// mirroring the test_tone.mjs harness. The rest of the client voice code is
// DOM/network glue (MicVAD, fetch) and deliberately stays untested.
//
//   node tests/test_voice_client.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8');
const inline = html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/);
if (!inline) throw new Error('no inline script found in index.html');

const src = inline[1];
const fn = src.match(/function audioFormatFromMime\([\s\S]*?\n\}/);
if (!fn) throw new Error('audioFormatFromMime not found in index.html');
const encFn = src.match(/function encodeWavPcm16\([\s\S]*?\n\}/);
if (!encFn) throw new Error('encodeWavPcm16 not found in index.html');

const audioFormatFromMime = new Function(fn[0] + '\nreturn audioFormatFromMime;')();
const encodeWavPcm16 = new Function(encFn[0] + '\nreturn encodeWavPcm16;')();

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (got === want) pass++;
  else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};

eq('webm/opus → webm', audioFormatFromMime('audio/webm;codecs=opus'), 'webm');
eq('mp4 → mp4', audioFormatFromMime('audio/mp4'), 'mp4');
eq('wav → wav', audioFormatFromMime('audio/wav'), 'wav');
eq('empty → webm', audioFormatFromMime(''), 'webm');
eq('null → webm', audioFormatFromMime(null), 'webm');

// M5 — encodeWavPcm16 wraps VAD's Float32Array (16 kHz mono, −1..1) as PCM16
// WAV so Whisper decodes it. Header must be byte-correct (data chunk = BYTE
// count, like the proxy's wavWrap) and the payload must be clamped PCM16.
{
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
  const blob = encodeWavPcm16(samples, 16000);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const ascii = (o, n) => String.fromCharCode(...bytes.subarray(o, o + n));
  eq('RIFF header', ascii(0, 4), 'RIFF');
  eq('RIFF size', view.getUint32(4, true), 36 + samples.length * 2);
  eq('WAVE', ascii(8, 4), 'WAVE');
  eq('fmt ', ascii(12, 4), 'fmt ');
  eq('PCM (format 1)', view.getUint16(20, true), 1);
  eq('mono', view.getUint16(22, true), 1);
  eq('16000 rate', view.getUint32(24, true), 16000);
  eq('byte rate', view.getUint32(28, true), 16000 * 2);
  eq('block align', view.getUint16(32, true), 2);
  eq('16-bit', view.getUint16(34, true), 16);
  eq('data chunk', ascii(36, 4), 'data');
  eq('data size = BYTE count', view.getUint32(40, true), samples.length * 2);
  eq('total length', bytes.length, 44 + samples.length * 2);
  eq('0 → 0', view.getInt16(44, true), 0);
  eq('0.5 → 16383', view.getInt16(46, true), 16383);
  eq('-0.5 → -16384', view.getInt16(48, true), -16384);
  eq('1 → 32767', view.getInt16(50, true), 32767);
  eq('-1 → -32768', view.getInt16(52, true), -32768);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
