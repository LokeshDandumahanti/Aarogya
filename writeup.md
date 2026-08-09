# AAROGYA — Triage finds the emergency. She gets the family to act.

**Track: GenAI for Good** · **Model: `google/gemma-4-26b-a4b-it` (Gemma-primary) via OpenRouter, behind a thin Netlify serverless proxy**

---

## The last mile is communication

Indian frontline health runs on referrals. The ASHA worker or ANM weighs the
danger signs, decides a newborn needs the district hospital, writes the
referral — and then the real test begins: a frightened mother, a sceptical
mother-in-law, a family that has seen too many referrals end badly, says no.

The triage tools in this field stop exactly there. They detect the emergency
brilliantly — they flag the danger sign, they score severity, they hand the
worker a referral. None of them trains what happens next: the conversation
that turns a detected emergency into an acted-upon one. A referral the
family refuses is a referral that failed. That refusal is a *communication*
failure — and it is the part of triage no one trains.

**AAROGYA is the trainer for that last mile.** It is a virtual patient who
teaches not just clinical reasoning — *what* to ask — but the communication
that decides whether the family acts — *how* to say it. The same simulator
built to train medical students now trains the ASHA/ANM frontline, the
people who actually sit across from the refusing mother.

## What AAROGYA is

AAROGYA is a web-based virtual patient. A trainee holds an open-ended
conversation with a patient played by Gemma 4, working toward a hidden goal
— a diagnosis, or, in the flagship case, a decision. Along the way, an
algorithm scores not just *what* they asked but *how* they asked it, and a
blinded nurse-analyst agent maintains a live patient report. Three cases
ship today:

- **Sunita — The Refusing Mother.** A 22-year-old refuses the
  district-hospital referral for her 10-day-old infant with danger signs.
- **Arun — Itchy Rash.** A hostel student with scabies — the classic
  history-and-exam case.
- **Shambu — I am feeling breathlessness, please help me.** A 72-year-old on a
  video consult, guarded through a screen — the diagnosis is his to discover.

## The architecture: the model may speak, it may not decide

The risk in letting an LLM play a patient is hallucination — it invents a
symptom that isn't in the case, and the trainee learns something false. So
the truth never lives in the model:

> **The LLM writes the patient's voice. The graph holds the medical truth.**

Every case is a deterministic clue graph. Facts unlock in order — Sunita's
fear has to surface before the health card can be shown; the diagnosis
commit is checked in code against ground truth, never by the model. Gemma's
job is *expression*, not *truth*: the patient physically cannot reveal a
finding that is not in the case. That is what makes AAROGYA a trainer rather
than a chatbot — what the trainee learns is trustworthy, and the scoring is
reproducible.

Gemma 4 plays three distinct roles, each with its own system prompt and
output contract:

1. **The patient's voice.** Each case is a Gemma persona with a biography, a
   family, a fear, a socioeconomic context. Gemma improvises natural,
   in-character replies — and deflects what a real patient could not answer.

2. **The empathy judge.** Every trainee message is scored empathetic /
   neutral / rude by a rule-based classifier, and Gemma grades the bedside
   manner against a rubric — so the score is never just the patient
   flattering you. The patient's *emotional response* to your tone is voiced
   by Gemma: kind doctors find a wall lowering; curt ones meet one.

3. **Sister Aagya, the nurse-analyst copilot.** A separate Gemma agent
   maintains the live Patient Report — findings, images, and a ranked
   differential. Aagya is structurally blinded: her prompt is built from
   evidence only, the transcript is sanitized to redact the diagnosis before
   it reaches her, and the differential is backed by a deterministic
   keyword analyser when the model is unavailable. She cannot cheat because
   she cannot see the answer.

The determinism runs end to end. The ranked differential is computed in
code — disease names are tokenized against the evidence gathered, stop-words
discarded, confidence derived from keyword hits — with supporting and
refuting findings shown side by side. And no case resolves until its pillars
are met: the diagnosis commit is a state transition in the graph, never a
guess the model makes.

Everything degrades gracefully. If the model rate-limits, the rule-based
judge and the deterministic analyser keep the session alive. The report
exports as Markdown or PDF. Conversations resume across refresh and device,
keyed by the trainee's name. Keys live only in server-side secrets.

## The mother case: the demo moment

Triage has already done its job when the case opens. The danger signs — poor
feeding, a fever of 101.2°F, lethargy — are documented, and the referral was
written on the last ASHA visit. What is missing is the family's agreement.

Sunita, 22, lost her first son four years ago after a hospital visit that
ended badly. Her mother-in-law, Sharada, lost her husband to the same
district hospital thirty years earlier and has run the house on herbs ever
since. The infant's health card is on file, the referral sheet is on the
table — and the conversation is lost unless the trainee earns it.

The case's clue graph is built from empathy, not anatomy. The trainee must
acknowledge her exhaustion without scolding, name the fear, respect her
decision, involve the grandmother, and lay out concrete, affordable next
steps — the night bus, the mother staying with the baby, the costs covered.
Each move gates the next. Only then does the state machine move the family
from *refusing* to *hesitant* to *agreed*, and the game ends with the win
condition: **"Family accepts the district-hospital referral."** The debrief
names what turned it — the moment the health card was accepted, the
grandmother's softening — so the trainee learns which move mattered.

This is the last mile made practice: a trainee can rehearse the hardest
conversation in Indian frontline health as many times as they need, against
a patient who never tires.

## Honest and measured

AAROGYA is a trainer, not a clinician. Every screen carries the framing
*"educational illustration — not clinical advice."* All imagery is public
domain or CC-licensed, and the health card and referral sheet are
canvas-rendered synthetics — no real patient data anywhere.

We are also measuring the measure. The empathy judge is being anchored to a
recognized communication framework (SPIKES / Calgary-Cambridge), with a
fixed 20-utterance evaluation set graded against a reference rubric — so the
judge's verdict becomes a verifiable agreement rate rather than a
self-assured number. That number is the subject of our next update.

## GenAI for Good

Standardized-patient training is expensive, scarce, and geographically
concentrated — a luxury in a country where most frontline workers train far
from any simulation center. AAROGYA delivers the *encounter* — the part that
cannot be learned from a textbook — at the marginal cost of an API call, in
a browser, with no install. It is static files behind a serverless proxy —
no database, no setup — deployable in an afternoon, and every image is
public-domain or a canvas-rendered synthetic, so there is no patient data
and no licensing risk anywhere. And by teaching empathy as a measurable,
improvable skill, it points past MCQ prep at something the triage tools
cannot: a frontline that has practiced turning a referral into a decision.

---

**Try it:** [live demo] · [public repo] · [notebook] — 24 deterministic
tests + 14 node suites + a live Gemma guardrail suite, all green.
