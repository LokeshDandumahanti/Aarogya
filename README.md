# AAROGYA — Virtual Patient Clinical Reasoning & Empathy Trainer

> **V7 transport (Ollama-front):** local **Gemma via Ollama** is the front leg
> (`http://127.0.0.1:11434`, model `gemma4:e2b-it-qat`); **OpenRouter is the
> online fallback** whenever Ollama is unreachable. On the deployed Netlify site
> Ollama is never reachable (localhost there isn't the laptop), so deployed runs
> use OpenRouter; on a training-center laptop under `netlify dev` with Ollama
> running, the app is fully local. See `repoguidelines.md` for the field story.

A web app where student doctors interview **Gemma 4-powered virtual patients**
with hidden conditions — practicing history-taking, differential diagnosis,
**and the bedside manner a real patient responds to**. Pick a case from the
library, talk to the patient (and family, and records), unlock clinical images,
watch a **blinded Care Auditor** build a live Patient Report and running
differential, and commit to a diagnosis.

- **TB** — Madhav, 32, a three-week cough (chest X-ray beat)
- **Goitre** — Meena, 28, a neck swelling (neck-region image + thyroid lab)
- **Scabies** — Arun, 19, an itchy rash (skin-region image + KOH scraping)

Built for the **Build with Gemma: TFUG Prayagraj** hackathon (track: **GenAI
for Good**). Gemma 4 is the patient's **voice** and reads clinical **images**; a
deterministic clue graph holds the medical truth underneath, so the game is
always fair, always learnable, and never hallucinates a diagnosis.

> Educational illustration of clinical reasoning — not clinical advice.

## What's here (V3)

- **4-case library** — selectable from the start screen, each with its own
  patient, family member, records file, clue DAG, and region evidence image.
  The 4th is a **remote-encounter case** (video consult, guarded screen-guard
  patient, no physical exam possible).
- **Region-based evidence** — asking "can you share your neck region image?" is
  the threshold that releases that region's photograph; synthetic lab/scan
  documents render as images too.
- **Blinded Care Auditor** — a 4th agent (never told the diagnosis) that keeps a
  live Patient Report: findings, images seen, and a running **differential**.
  Address it with `@auditor`.
- **Auto-ingest** — every image shown to you is simultaneously analyzed by the
  Auditor and folded into the report.
- **Realtime empathy readout** — the chat header shows the current empathy score
  (%) and the point change from each message you send, updating live.
- **Empathy scoring** — every message is tone-classified (empathetic / neutral /
  rude). A rude doctor lowers the score and makes the patient clam up; a kind
  doctor opens them up sooner. The debrief scores clinical + empathy with
  concrete communication suggestions.
- **Online-specific empathy (M1)** — on remote-encounter cases a second scored
  axis tracks whether you acknowledge the screen, reassure about exam limits,
  and close with a follow-up plan (REMOTE CARE x/3 in the header); the debrief
  names whichever you missed.
- **My Training dashboard (M2)** — every completed consult is snapshotted into a
  local per-doctor profile; trends (empathy, rude-rate, leading questions,
  remote vs in-person) + coaching patterns, with a Markdown skill-report export.
  Aggregate-only — no patient data.
- **Structured monthly checkup (M3)** — the deterministic engine applied to a
  chronic patient: structured intake (symptoms → vitals → meds → adherence) →
  compiled record → completeness-gated sign-off → follow-up plan → next-month
  recurrence, chained into a longitudinal record.
- **Employer wellness view (M4)** — `employerExport` returns aggregate/outcome-
  only numbers (enrollment, completion rate, adherence, flags caught), with an
  automated privacy-wall test proving no PHI survives. Buyer pitch:
  [PITCH.md](docs/PITCH.md).
- **Downloadable report** — the same report object exports to **Markdown** and
  **PDF**.
- **A distinctive clinical UI** — light "case-sheet" identity with a
  patient-monitor strip (Bricolage Grotesque + Source Serif 4 + IBM Plex Mono).
- **Voice mode (M5)** — 🎙 speak your question (Silero VAD in-browser stops
  the mic at end-of-speech; Whisper transcribes as the real-ASR decider, Gemini
  only as a last-resort guess) and, with 🔊 toggled, hear the patient reply
  aloud (Gemini TTS, fish fallback) in a per-case voice — Madhav → Charon,
  Meena → Kore, Arun → Puck.
  Text stays primary; audio is a second rendering of the same reply. Full API
  flow + fallback matrix: [apiflow.md](apiflow.md) · flowchart prompt:
  [flowprompt.md](flowprompt.md).

## Live demo

<!-- insert Netlify URL after deploy -->
Netlify: `https://aarogya-vp.netlify.app`

## Quick start

1. **Add your API key** (Netlify env secret, never committed):
   ```
   cp .env.example .env   # then fill in OPENROUTER_API_KEY
   ```
2. **Run locally**
   ```bash
   netlify dev            # serves index.html + /api/openrouter proxy
   # or just open index.html in a browser (case data loads via fetch)
   ```
3. **Run the tests**
   ```bash
   python -m pytest tests/ -q          # 22 deterministic checks (datapack ×4 cases + blinding)
   node tests/test_tone.mjs            # 34 tone/empathy checks
   node tests/test_cascade.mjs         # model-cascade failover checks
   node tests/test_voice.mjs           # /stt + /tts proxy (mocked fetch, no network)
   node tests/test_voice_client.mjs    # client voice helpers
   node tests/test_remote.mjs          # 27 M1 remote-empathy signal checks
   node tests/test_analytics.mjs       # 24 M2 trend/pattern checks
   node tests/test_checkup.mjs         # 26 M3 3-month checkup-chain checks
   node tests/test_privacy.mjs         # 16 M4 employer privacy-wall checks
   OPENROUTER_API_KEY=... pytest tests/ -q   # + live Gemma guardrail checks
   ```

## How it works

- **Gemma 4 is the patient's voice.** The system prompt builds the persona from
  `data/case_<case>.json` with hard guardrails: never invent symptoms, tests, or
  history; never announce a diagnosis; deflect what isn't in the file.
- **The clue graph is the truth.** Each case has 10–12 clues in a DAG. A clue
  unlocks only when its dependencies are discovered. Probing a locked clue gets
  a deflection; how many deflections a patient tolerates depends on **your
  tone** (1 for kind doctors, 3 for rude ones).
- **Evidence beats.** The X-ray (TB), the neck photograph (goitre), the skin
  photograph (scabies), and canvas-rendered lab/scan reports are shown as images;
  Gemma reads them and confirms a finding — with a deterministic fallback so the
  game never breaks offline.
- **Blinded Care Auditor.** Its system prompt is assembled from case data with
  the `expectation` block and the gameEnd clue never read; the transcript it
  receives is sanitized to strip the diagnosis. It reasons only from evidence you
  uncover.
- **Deterministic diagnosis commit.** Two "pillar" clues gate the final answer.
  The student picks among distractors + the real diagnosis; correctness is
  checked **in code**, and Gemma only writes the patient's reaction.
- **Debrief.** Clinical score + empathy score, wrong guesses, leading questions,
  and communication suggestions grounded in your actual messages.

## Repository layout

```
aarogya/
├── index.html                    # the entire app (shell, graph, agents, report, UI, voice, M1–M4)
├── data/cases.json               # 4-case library index
├── data/case_tb.json             # Madhav — TB (chest X-ray beat)
├── data/case_goitre.json         # Meena — goitre (neck region + thyroid labs)
├── data/case_scabies.json        # Arun — scabies (skin region + KOH)
├── data/case_remote.json         # Shambu — video consult, T2DM (remote + checkup patient)
├── assets/*.jpg                  # public-domain clinical images (see CREDITS.md)
├── netlify/functions/openrouter.js  # Gemma proxy + /stt + /tts routes (reads env secrets)
├── netlify.toml
├── tests/                        # datapack/blinding (pytest), tone/cascade/voice/remote/analytics/checkup/privacy (node)
├── apiflow.md                    # voice-mode API flow, fallbacks, Gemini TTS characters
├── flowprompt.md                 # Mermaid flowchart prompt for the voice flow
├── spec.md                       # V3 spec (M1–M5 milestones)
├── docs/ARCHITECTURE.md          # agents, evidence engine, blinding, flow
├── docs/PITCH.md                 # M4 corporate wellness pitch (HR/CHRO buyer)
├── docs/EVAL_REPORT.md           # verification evidence + known limitations
├── CREDITS.md                    # image sources + licenses
├── .env.example                  # template — never commit real keys
├── .gitignore                    # ignores .env, node_modules, etc.
└── LICENSE                       # Apache 2.0
```

## Why it's "GenAI for Good"

Clinical reasoning **and** communication are learned by doing, but patients are
scarce and role-play with peers is shallow and inconsistent. AAROGYA gives every
student a patient who never tires, never resents a wrong guess, and responds to
tone the way a real person does — a safe, free, always-available training ground.
It is explicitly framed as educational illustration, not clinical advice.

## Model & hosting

- Model: `google/gemma-4-26b-a4b-it` (paid) via OpenRouter — vision-capable;
  the proxy forwards `messages` verbatim, so data-URI images pass through. The
  proxy runs a failover cascade: Gemini `gemini-flash-latest` (Google AI Studio
  key) when Gemma fails, else `google/gemma-4-31b-it`.
- Hosting: Netlify (static HTML + one serverless function proxying the models).
  The keys live only as Netlify environment secrets.
- **Security:** `OPENROUTER_API_KEY` / `GEMINI_API_KEY` are never committed;
  they live only in `.env` (gitignored) or Netlify env secrets.
