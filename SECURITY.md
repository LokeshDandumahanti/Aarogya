# AAROGYA — Security & Safety Notes

AAROGYA is a **training simulator**, not a medical device. This file documents
the bounds that keep it honest, deterministic, and safe to publish openly.

## 1. The LLM can speak, it cannot decide

- **Medical truth lives in code, not in the model.** Each case is a
  deterministic clue graph; the diagnosis commit is checked in code against
  ground truth. Gemma only voices the patient — it can never reveal a finding
  that is not in the case, and it never confirms or names the diagnosis.
- **The graph is blind to the answer where it must be.** Sister Aagya, the
  report copilot, is structurally blinded: her prompt is built from evidence
  only, her transcript is sanitized to redact the diagnosis before it reaches
  her, and she sees no `expectation` block or game-end clue. Blinding is
  enforced by code and locked in by tests.

## 2. No patient data, no PHI

- **All imagery is public-domain/CC** (CDC PHIL, Wikimedia Commons — see
  `CREDITS.md`) or **canvas-rendered synthetic documents** (prescriptions,
  health cards, lab reports). There is no real patient data anywhere in the
  repo, and nothing can be inferred from the images.
- **Framing on every surface:** *"Educational illustration — not clinical
  advice."*

## 3. Keys and secrets

- **API keys never ship in the repo.** `OPENROUTER_API_KEY` and
  `GEMINI_API_KEY` live only in `.env` (gitignored) for local dev and in
  Netlify's environment variables for the deployed site. `.env.example` shows
  the names only.
- **Ollama-first transport (V7):** the app prefers a **local** Gemma via
  Ollama (`localhost:11434`) — when that path is used, the conversation never
  leaves the machine. OpenRouter is the online fallback. The deployed Netlify
  site always uses OpenRouter (localhost is unreachable there by design).

## 4. Abuse / misuse bounds

- AAROGYA is a trainer for ASHA/ANM and nursing trainees. It is not a
  diagnostic tool, does not triage real patients, and must not be used for
  clinical decisions. The mother case explicitly models a *training
  conversation*, not a referral system.
- The patient refuses to hand over evidence until the prerequisite
  conversation happens (DAG-gated reveals) — the simulator cannot be pushed
  into skipping the clinical reasoning it is meant to teach.

## 5. Reporting

Found a way to break the blinding, leak a case answer, or a security issue in
the deployed demo? Open an issue on this repository rather than posting keys
or case answers publicly.
