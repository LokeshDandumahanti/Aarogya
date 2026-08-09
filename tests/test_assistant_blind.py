"""Blinding: the Care Auditor must never be handed the diagnosis.

The auditor is a 4th agent whose report builds a running differential. Its
system prompt is assembled from case data, and two structural guards keep the
answer out:

1. buildAssistantPrompt() never reads `expectation` or the gameEnd clue.
2. sanitizeTranscriptForAuditor() strips the gameEnd text and the diagnosis
   string from the transcript it forwards.

Design note: *evidence* may legitimately name a disease ("Sarcoptes scabiei
seen on KOH prep" or "cavitation on X-ray") — the auditor is meant to reason to
the answer from evidence. What it must never see is the *pre-seeded answer*:
the expectation block, the gameEnd clue, or anything that exists before the
doctor has discovered it.

Run:  python -m pytest tests/test_assistant_blind.py
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
INDEX = json.loads((DATA / "cases.json").read_text(encoding="utf-8"))


def cases():
    for entry in INDEX:
        yield json.loads((DATA / entry["file"]).read_text(encoding="utf-8"))


def initial_auditor_text(case):
    """Everything the auditor sees before ANY clue is discovered:
    patient publicProfile + character identities. No clues, no evidence."""
    chunks = []
    for ch in case["characters"].values():
        chunks.extend([ch.get("name", ""), ch.get("role", ""), ch.get("fullName", "")])
        if ch.get("kind") == "patient" and ch.get("publicProfile"):
            chunks.append(ch["publicProfile"])
    return "\n".join(chunks).lower()


def test_initial_prompt_has_no_diagnosis():
    for case in cases():
        text = initial_auditor_text(case)
        diag = case["expectation"]["diagnosis"].lower()
        assert diag not in text, (
            f"{case['case']}: diagnosis '{diag}' appears in the auditor's initial "
            f"prompt (publicProfile/characters) — blinding broken"
        )


def test_public_profile_never_leaks():
    # Redundant with test_datapack, kept here so the blinding suite is self-contained.
    for case in cases():
        patient = next(ch for ch in case["characters"].values() if ch["kind"] == "patient")
        assert case["expectation"]["diagnosis"].lower() not in patient.get("publicProfile", "").lower()


def test_build_assistant_prompt_never_reads_answer():
    """Structural check on index.html source: the prompt builder must not
    read `expectation` (the answer block). It may reference `gameEnd` ONLY to
    exclude the ending clue from the findings it forwards."""
    start = HTML.find("function buildAssistantPrompt")
    assert start != -1, "buildAssistantPrompt not found"
    end = HTML.find("\nfunction ", start + 1)
    body = HTML[start:end if end != -1 else len(HTML)]
    assert "expectation" not in body, "buildAssistantPrompt reads the expectation block"
    assert "!c.gameEnd" in body, "buildAssistantPrompt must filter the gameEnd clue out of findings"
    assert "sanitizeTranscriptForAuditor" in body, "prompt builder must sanitize the transcript"


def test_sanitizer_redacts_diagnosis_and_end():
    """Defense in depth: the sanitizer knows the diagnosis precisely so it can
    strip it (and the gameEnd narrative) from the transcript it forwards."""
    m = re.search(r"function sanitizeTranscriptForAuditor\([\s\S]*?\n\}", HTML)
    assert m, "sanitizeTranscriptForAuditor not found"
    body = m.group(0)
    assert "expectation?.diagnosis" in body, "sanitizer must target the diagnosis string"
    assert "longText" in body, "sanitizer must strip the gameEnd longText"
    assert "[redacted]" in body, "sanitizer must replace banned strings with [redacted]"


def test_game_end_clue_text_never_in_transcript_path():
    """The gameEnd longText is the narrative reveal (it names the diagnosis).
    It must never be fed into the assistant thread — only the sanitizer may
    touch the transcript, and the sanitizer is the ONLY consumer."""
    calls = [c for c in re.findall(r"addChatMessage\([^)]*gameEnd[^)]*\)", HTML)]
    assert not calls, f"gameEnd text fed straight to chat: {calls}"
