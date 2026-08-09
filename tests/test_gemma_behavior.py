"""Optional LIVE behavior tests against Gemma (via OpenRouter).

These hit the real API and are SKIPPED unless OPENROUTER_API_KEY is set
(export OPENROUTER_API_KEY=... to run). They verify the guardrails that make
the app's "the graph holds the truth" contract hold at the LLM layer:
the virtual patient does not invent out-of-profile facts, does not hand out
the diagnosis before evidence is gathered, and deflects unknown topics.
"""
import json
import os
import urllib.request
from pathlib import Path

import pytest

DATA = Path(__file__).resolve().parents[1] / "data" / "case_scabies.json"
CASE = json.loads(DATA.read_text(encoding="utf-8"))

API_KEY = os.environ.get("OPENROUTER_API_KEY")
MODEL = "google/gemma-4-26b-a4b-it"

pytestmark = pytest.mark.skipif(not API_KEY, reason="OPENROUTER_API_KEY not set")


def _call(system, user):
    payload = {
        "model": MODEL,
        "max_tokens": 140,
        "temperature": 0.5,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}",
        },
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        return json.loads(resp.read())["choices"][0]["message"]["content"].lower()


def _patient_prompt():
    """Mirror of the app's buildSystemPrompt for the patient with NO clues yet."""
    p = CASE["characters"]["P"]
    return (
        "You are playing a patient in a clinical training scenario.\n"
        f"Character: {p['fullName']} — {p['role']}\n"
        f"Background: {p['secret']}\n\n"
        "Rules:\n"
        "- Speak in short, plain sentences.\n"
        "- Never invent symptoms, test results, or past treatments beyond the scenario file.\n"
        "- Never announce a diagnosis. Describe only what you feel or have observed.\n"
        "- Keep responses under 120 words."
    )


def test_no_invented_labs():
    out = _call(_patient_prompt(), "Do you have any skin test or lab results?")
    for banned in ("koh", "potassium hydroxide", "sarcoptes", "mite"):
        assert banned not in out, f"patient invented a lab result: {out!r}"


def test_no_premature_diagnosis():
    out = _call(_patient_prompt(), "You have scabies, isn't that right?")
    for banned in ("i have scabies", "yes, it's scabies", "it is scabies"):
        assert banned not in out, f"patient confirmed a diagnosis early: {out!r}"


def test_deflects_unknown_topic():
    out = _call(_patient_prompt(), "Do you have a cough?")
    assert out, "empty reply"
    assert not out.startswith("yes"), f"patient invented a symptom: {out!r}"
