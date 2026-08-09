# AAROGYA — Virtual Patient Clinical Reasoning & Empathy Trainer · Spec V5

> **Origin:** Build with Gemma: TFUG Prayagraj — GenAI for Good Track (V1→V4)
> **Product:** the same simulator, a new lane — training the **last mile of
> triage**: the communication that turns a detected emergency into an
> acted-upon one.
> **Status:** V5 spec (V4 achieved) · **created 2026-08-08**.
> **V4 baseline:** N1–N7 implemented — all suites green (pytest 24 + 14 node
> suites + live Gemma guardrail 3/3). V5 builds on V4; the working product
> surface is the foundation, not a rebuild.
> **Competition rubric that drives this pivot:** Gemma Integration 30% ·
> Innovation & Impact 30% · Functionality 20% · Presentation & Writeup 20%.
> **Last updated:** 2026-08-09
> **Deployment decision (2026-08-09):** the Netlify deployment is **hosted-API
> only** — no Ollama in the deployed path. The local-Ollama seam (P1) is
> **deferred**, not part of this deployment cycle. The deployed case library
> drops the Meena and Madhav cases for the **last-mile mother case** (P2, now
> in progress) — library = scabies · remote · mother.
> **Thesis (one loop):** triage finds the emergency; **AAROGYA gets the family
> to act on it.**

## 1. Product — the pivot

V4 is a virtual-patient trainer for clinical reasoning and empathy. V5 keeps
that engine and **changes the lane it races in**. The strongest submissions in
this competition (ASHA Sahayak and peers) stop at *detection*: they flag the
danger sign. But a sick newborn flagged for referral is worthless if the
mother — frightened, grieving, counselled against it by a mother-in-law —
refuses to leave for the district hospital. That refusal is a **communication
failure**, and it kills exactly the children the triage tools are counting.

```
triage tools stop here ─► danger sign detected ─► referral written
                                            │
                                            └──► mother refuses ─► (death)
                                   ▲
                                   │  THIS is AAROGYA's lane
            empathy + reasoning training that changes the decision
```

- **The wedge:** "Triage finds the emergency. AAROGYA gets the family to act
  on it." The last mile of triage is communication, and it is the *only*
  lane in the field with no competitor.
- **Impact story in the same register:** we stop pitching "be nicer." We
  pitch the failure the simulator trains — the moment triage succeeds or
  fails is a conversation, and communication quality is measurable in the
  same body-count terms the triage tools use.
- **Target expansion (framing first, code later):** medical students →
  **ASHA workers / ANM & nursing trainees / frontline health workers**, the
  people who actually sit across from the refusing mother. No UI rebuild:
  the case library carries the new audience.
- **The anti-pivot guardrail:** the V4 product surface is untouched — the
  deterministic DAG, the empathy judge, Sister Aagya, the report, the
  name-keyed persistence, the voice, the avatars all stay. Pivot = one new
  transport seam + one new case + one evidence claim + a reframed story.
  **Functionality (20%) is our winning line; never trade it for a rebuild.**
  The single allowed surface addition is the **branded opening screen (P0)** —
  a thin hero layer in front of the existing name → library flow; nothing
  rebuilt, nothing removed.

## 2. Positioning vs. V4

- **V4:** a training copilot for doctors — empathy judge, Sister Aagya,
  ranked differential, consolidated report, persistent store. Strong product,
  weak story: "teach medical students to communicate" loses the room to
  "stop babies dying from missed sepsis."
- **V5:** same product, the *last-mile* story. AAROGYA sits **beside** the
  triage tools, not against them — the triage tool says *what* is wrong;
  AAROGYA trains the *conversation that gets the family to act*. Judges who
  like ASHA Sahayak immediately understand AAROGYA's complement, and it is
  the only entry in that complement.

Judged against the TFUG rubric (from the competition rules):

| Line | V4 standing | V5 lever |
|---|---|---|
| Gemma Integration 30% | model-agnostic through a paid proxy; Gemini in fallback | **P1 dual-mode Gemma** — local Ollama runs the same Gemma on-device; kills the paid-key demo risk |
| Innovation & Impact 30% | unique (only empathy trainer) but unproven impact | **P2 last-mile case** + P3 measurable judge — impact in body-count register, evidence attached |
| Functionality 20% | **strongest line** — complete, polished product | untouched (guardrail) |
| Presentation & Writeup 20% | unwritten | **P0 wedge framing** + live-demo-ready screen |

## 3. Hard constraints (persist)

Carried forward from V4 (still binding):

- **Determinism:** medical truth lives in code. The LLM writes only the
  patient's voice; the graph holds the truth. Diagnosis commit is
  code-enforced. Aagya's "possible guesses" are a *differential*, never the
  answer.
- **Blinding persists:** Aagya inherits structural blinding — her prompt is
  built without the `expectation` block or game-end clue; her transcript is
  sanitized. `buildAssistantPrompt` / `sanitizeTranscriptForAuditor` names
  and the blinding tests stay.
- **Security:** OPENROUTER_API_KEY (+ GEMINI_API_KEY where kept) only in
  `.env` (gitignored) / Netlify secrets. Name-keyed blob access is a
  convenience boundary, not a security barrier.
- **Imaging:** public-domain/CC only (CDC PHIL / Wikimedia Commons) +
  canvas-rendered synthetics. No real PHI.
- **Framing:** "educational illustration, not clinical advice" on every
  surface, including the new case's referral storyline.
- **Fallbacks:** any LLM leg degrades to a deterministic fallback; the core
  interview never breaks.
- **No deploy until Sir says so** — show it running locally first.
- **V5 keeps `spec.md` only** (no info.md/insights.md), matching V4.

New in V5:

- **Deployment is hosted-API only.** The Netlify deployment runs Gemma via
  OpenRouter (Gemma-primary); the Gemini fallback never appears on the visible
  demo path. **No Ollama anywhere in the deployed path** — the local-Ollama
  seam (P1) is deferred and may return with the repo/notebook work.
- **Case library (deployed):** scabies · remote · **last-mile mother case**
  (P2, in progress). The Meena and Madhav cases are removed from the library.
- **Offline story, parked with P1:** "offline" for V5 means a training-center
  laptop running local Ollama — a laptop, not a phone. That leg is deferred;
  this deployment makes no offline claim.
- **The mother case is a training scenario, not a decision tool.** It may
  teach the conversation; it must not imply the simulator triages real
  infants.
- **Branded opening (P0):** launch = AAROGYA wordmark + tagline → "Enter your
  name" → **Start** → the current V4 interface, unchanged. Name-keyed resume
  still drives the library.

## 4. V4 — achieved ✅ (baseline)

- Deterministic clue-DAG engine (4 cases: TB / goitre / scabies / remote-T2DM),
  code-enforced diagnosis commit.
- N1 LLM empathy judge (both input paths) with rule-based fallback.
- N2 ranked differential analyser (supporting/refuting, keyword-validated,
  deterministic fallback).
- N3 Netlify Blobs name-keyed persistence — resume across refresh/device.
- N4 stable per-character voices (registry, no collision within a case).
- N5 Sister Aagya copilot — per-case isolation, on-entry clue sync, blinding.
- N6 consolidated report — findings + differential + embedded images,
  Markdown + PDF export.
- N7 always-reachable case library, per-case state preserved.
- Voice mode, empathy HUD, chat avatars, markdown-rendered report — all live
  and verified. All suites green.

## 5. V5 — milestones

### P0 · The wedge — framing, story, target, and the branded opening — 🔲 planned (opening screen 🚧 active)

**Why:** the two heaviest judged lines (Gemma Integration, Innovation &
Impact) are decided as much by narrative as by engineering. V4's impact
pitch was the softest part of the submission.

- **One-line thesis everywhere:** "Triage finds the emergency. AAROGYA gets
  the family to act on it."
- **Branded opening screen (small additive UI, requested 2026-08-09):** on
  launch the app opens on an **AAROGYA** wordmark with the one-line tagline,
  then the existing name entry — "Enter your name" — and a **Start** button.
  Starting drops straight into the current V4 interface (library → case →
  play), with name-keyed resume intact. It is a hero layer in front of V4's
  name → library flow, not a rebuild of it.
- **Target statement:** medical students **and** the frontline — ASHA/ANM
  trainees and nursing colleges — because those are the people who sit
  across from the refusing mother. Frame it; code follows in P2.
- **Writeup structure (3–5 min read, ≤1,500 words):**
  1. The last mile is communication (problem, with the refusal statistic
     framed, not fabricated).
  2. The architecture — "the model may speak, it may not decide": the DAG
     holds truth, Gemma voices it, in three roles (patient / judge / Aagya).
  3. Gemma-primary, two transports (P1).
  4. The mother case (P2) and the measured judge (P3).
  5. Honest framing: training tool, not medical device.
- **Video (≤3 min):** one full on-screen consultation ending in the report
  and a resume — the live UI is the demo weapon.
- **Verify:** rubric self-check — every rubric line has a visible answer in
  the writeup; no claim without a reference or a number.

### P1 · Dual-mode Gemma — the local Ollama seam — ⏸️ deferred (not in the deployment)

> **Deferred 2026-08-09 (Sir).** This deployment is **hosted-API only** — the
> Ollama transport is **removed from the deployment path**. P1 may return with
> the repo/notebook work (see `repoguidelines.md` §5). The "Why" and design
> below are kept as the parked design, not as active work.

**Why:** AAROGYA's weakest visible line is "runs through a paid proxy, model
swappable, Gemini in the cascade." A sibling transport that runs the **same
Gemma 4 locally** answers the field's offline theme, the paid-key-in-demo
risk, and the Gemma Integration line at once — without touching the product.

- **A second transport behind the same LLM seam.** The app already routes
  every LLM call through a thin serverless proxy (`netlify/functions/
  openrouter.js`). Add `netlify/functions/ollama.js` that proxies to a local
  Ollama server (`http://127.0.0.1:11434`) serving `gemma4:e2b-it-qat` (or
  `e4b-it-qat` where the laptop allows). A **settings toggle** (Local /
  Online) selects the transport; the app code below the seam is unchanged.
- **Same contracts:** every consumer (patient chat, empathy judge, Aagya)
  speaks to the seam identically — identical prompts, identical JSON
  extraction, identical timeout + fallback discipline. Local mode must also
  run the vision leg (Ollama vision) so the X-ray/region images still work
  offline.
- **Fallback chain in local mode:** Ollama down/timeout → deterministic
  fallback (rule-based tone, analyserFallback), same as online — the
  interview never breaks.
- **Deployment story:** field = laptop + Ollama + the app served locally
  (`netlify dev` on 8888 or a static server). Online = the existing Netlify
  deployment. One codebase, two transports.
- **Verify:** routing test (toggle picks local vs remote, prompts identical);
  local-mode contract test (stubbed Ollama returns valid JSON per consumer);
  failure test (Ollama 5xx → deterministic fallback, app alive); live offline
  run on Sir's laptop with a real local Gemma (no network) — patient voice +
  judge + Aagya + one image all work.

### P2 · The last-mile case — mother refuses the referral — 🚧 in progress (for the deployment)

> **Active 2026-08-09 (Sir).** Being built for the deployment as
> `data/case_mother.json`, **replacing the Meena and Madhav cases** in the
> library (scabies · remote · mother). Design: the mother is the patient-kind
> character; clues are conversation moves gating `refusing → hesitant →
> agreed`; two pillars unlock via syntheticReports (infant health card,
> referral sheet); game-end = "Family accepts the referral."

**Why:** one scenario that lands the entire pivot. The trainee's objective is
communication, and the outcome is measurable in the same register as triage:
**did the family agree to the referral?**

- **A new case in the library** (schema-following `case_*.json`): a ~10-day-old
  infant with danger signs (poor feeding, fever, lethargy) already *detected*;
  the mother, exhausted and fatalistic, refuses the district-hospital referral;
  a mother-in-law reinforces the refusal. The patient chart is present but the
  battle is not diagnostic — it is the conversation.
- **Objective & scoring:** empathy + reasoning moves the mother from
  `refusing` → `hesitant` → `agreed`. The DAG gates these states; the
  empathy judge and Aagya support the trainee as in every case. A completed
  agreement is the win condition; the debrief quotes what turned it.
- **Target-aisle proof:** this is the ASHA/ANM case — no new UI, no Hindi
  voice in this pass. The framing in P0 names the audience; the case gives
  the demo a visceral 3-minute moment.
- **Verify:** datapack schema test (new case passes the same validation as
  V4 cases); playthrough test (state machine: refusal → agreement gated by
  empathy/reasoning, deterministic); debrief shows the turning point.

### P3 · SPIKES-anchored empathy judge + a measured claim — 🔲 planned

**Why:** V4's empathy score was an LLM grading an LLM — no anchor, no
evidence. One credible number ("the judge agrees with a rubric-graded
reference on N/20 utterances") turns the softest part of the product into
the writeup's first honest metric.

- **Anchor the judge to a recognized communication framework** — a practical
  slice of **SPIKES** (breaking bad news) and/or **Calgary-Cambridge**
  (build rapport, elicit concerns, involve the patient in decisions),
  encoded as the judge's rubric: explicit dimensions (e.g. acknowledge the
  situation, name the fear, give clear next steps, respect the decision).
  The judge still returns `{ score, label, rationale }` — the rubric is the
  grading lens, quoted in the rationale.
- **A fixed 20-utterance eval set:** 20 doctor replies across the cases
  (empathetic / neutral / rude × varied scenarios), each with a **reference
  score pre-graded against the rubric**. The judge runs the set; agreement
  rate (exact label match, score within ±10) is the claim.
- **Shipping it:** the eval set lives in `tests/` (or `data/`), runnable
  against a real key, reported in the writeup as a measured number. The
  rule-based fallback remains the score of record if the judge is down.
- **Verify:** eval-suite test (fixed set, reference grades, agreement
  metric); judge still passes V4's contract tests (labels, bounds, fallback);
  the agreement number is reproducible and cited in the writeup.

## 6. Architecture deltas (vs. V4)

| Concern | V4 | V5 |
|---|---|---|
| LLM transport | OpenRouter proxy only | **OpenRouter (hosted-API deployment)**; local-Ollama seam (P1) **deferred** |
| Field deployment | network + paid key required | offline-laptop leg **parked with P1** — this deployment ships hosted-API only |
| Case library | 4 clinical-reasoning cases | **3 cases: scabies · remote · last-mile mother case** (Meena/Madhav removed), DAG-gated agreement states |
| Empathy judge | free-form LLM judgement | **SPIKES / Calgary-Cambridge-anchored rubric** + graded 20-utterance eval claim |
| Audience | medical students | **+ ASHA/ANM & nursing trainees** (framing now, cases next) |
| Story | "train empathetic doctors" | **"the last mile of triage is communication"** — same body-count register as the triage tools |
| Product surface | — | **unchanged except the branded opening screen** (P0: wordmark + tagline → name → Start → V4 interface); nothing rebuilt |

**Agent set (V5):** unchanged from V4 — Patient (Gemma) · Family · Aagya ·
the DAG. The empathy judge is a pipeline stage, now rubric-anchored. The
dual-mode transport is infrastructure, not an agent.

## 7. Open decisions (flag before/at implementation)

- **Ollama model for the field** — `gemma4:e2b-it-qat` (4.3 GB) vs
  `e4b-it-qat` (6.1 GB); depends on the demo laptop's VRAM. **Deferred with
  P1** — irrelevant to the hosted-API deployment.
- **Transport toggle UX** — moot for the deployment (hosted-API only).
  Revisit if P1 returns with the repo work.
- **SPIKES vs Calgary-Cambridge slice** — which dimensions encode into the
  judge rubric; the eval set's reference grades must be defensible by
  citation, not invented.
- **Scope of the ASHA audience** — framing-only now, or one more ASHA-facing
  case beyond P2 (e.g. immunisation refusal) if time allows. Hindi voice is
  explicitly deferred unless Sir decides otherwise.
- **Timeline pressure** — if days remain, P0 + P2 + P3 ship and P1 (the only
  code seam) is cut; if weeks remain, P1 becomes the highest-value change.
  Sir's deadline decides the order.

## 8. Verification

- P0: rubric self-check — every line of the 30/30/20/20 has a visible,
  evidenced answer in the writeup/video. Opening screen shows the AAROGYA
  wordmark + tagline on first paint; entering a name and hitting Start lands
  on the current V4 interface with name-keyed resume intact.
- P1: **deferred with P1** — routing test, local-mode contract test,
  Ollama-failure → fallback test, and the live offline run return when the
  seam returns.
- P2: datapack schema test (mother case passes the same validation as V4
  cases) + playthrough state-machine test (refusal → agreement gated
  deterministically) + debrief shows the turning point. **Deployed library
  verified as scabies · remote · mother** (Meena/Madhav removed).
- P3: fixed 20-utterance eval with reference grades → agreement metric;
  judge still passes V4 contract tests.
- Port all V4 suites green (pytest 24 + 14 node suites) before and after.

## 9. Risks & notes

- **Time vs. scope:** the only code lever is P1. If the clock is short, cut
  P1, keep the story (P0 + P2 + P3) — the seam can be added later without
  touching the narrative.
- **Offline overclaim:** "offline" is a laptop + local Gemma. Saying
  "runs offline" while only meaning "in a college lab" is fine if the writeup
  says exactly that; claiming phone deployment we cannot ship is a
  credibility loss.
- **Gemini visibility:** the fallback to Gemini must stay out of the demo
  path and read as resilience in the writeup. A visible Gemini reply on
  judging day undercuts the Gemma Integration line.
- **The paid key is still load-bearing in dev:** until P1 ships, the demo
  depends on OpenRouter credits — pre-fund, and rehearse the deterministic
  fallback so a rate-limit never lands on screen.
- **Don't rebuild:** every hour spent on the product surface is an hour that
  breaks our strongest line. The pivot is the story, one seam, one case, and
  one number.
