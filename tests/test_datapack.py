"""Deterministic validation of all case data packs — no network, always runs.

Run:  python -m pytest tests/test_datapack.py
"""
import json
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data"
INDEX = json.loads((DATA / "cases.json").read_text(encoding="utf-8"))

VALID_DIFFICULTY = {"easy", "medium", "hard", "very_hard"}
VALID_KINDS = {"patient", "family", "records"}

CASES = []
for entry in INDEX:
    CASES.append((entry, json.loads((DATA / entry["file"]).read_text(encoding="utf-8"))))


def case_entries():
    for _entry, case in CASES:
        yield case


def clues_by_id(case):
    return {c["id"]: c for c in case["clues"]}


def test_index_schema():
    required = {"id", "title", "disease", "file", "icon", "blurb", "region"}
    seen = set()
    for entry in INDEX:
        missing = required - set(entry)
        assert not missing, f"index entry {entry.get('id')} missing: {missing}"
        assert entry["id"] not in seen, f"duplicate case id {entry['id']}"
        seen.add(entry["id"])
        assert (DATA / entry["file"]).exists(), f"index points at missing file {entry['file']}"
        assert entry["region"] in {"chest", "neck", "skin", "remote", "communication"}, f"unknown region {entry['region']}"


def test_index_unique_files():
    files = [e["file"] for e in INDEX]
    assert len(set(files)) == len(files), "two index entries point at the same file"


def test_json_shape():
    assert len(INDEX) >= 2, "expected at least a 2-case library"
    for case in case_entries():
        assert set(case) >= {"version", "case", "title", "patientName", "expectation", "characters", "clues"}
        assert set(case["expectation"]) == {"diagnosis", "management", "distractors"}
        assert len(case["characters"]) >= 2
        assert len(case["clues"]) >= 10


def test_clue_schema():
    required = {"id", "character", "index", "difficulty", "label", "shortText", "longText",
                "dependencies", "pillar", "gameEnd"}
    for case in case_entries():
        for c in case["clues"]:
            missing = required - set(c)
            assert not missing, f"clue {c['id']} missing fields: {missing}"
            assert c["difficulty"] in VALID_DIFFICULTY, f"{c['id']} bad difficulty {c['difficulty']}"
            assert c["pillar"] in (None, "A", "B"), f"{c['id']} bad pillar {c['pillar']}"
            assert isinstance(c["gameEnd"], bool), f"{c['id']} gameEnd not bool"
            assert isinstance(c["dependencies"], list), f"{c['id']} dependencies not list"
            assert c["character"] in case["characters"], f"{c['id']} unknown character {c['character']}"


def test_dependency_refs_exist():
    for case in case_entries():
        clues = clues_by_id(case)
        for c in case["clues"]:
            for dep in c["dependencies"]:
                assert dep in clues, f"{c['id']} depends on missing clue {dep}"
                assert dep != c["id"], f"{c['id']} depends on itself"


def test_no_cycles():
    for case in case_entries():
        clues = clues_by_id(case)
        indeg = {cid: len(c["dependencies"]) for cid, c in clues.items()}
        out = {cid: [] for cid in clues}
        for cid, c in clues.items():
            for dep in c["dependencies"]:
                out[dep].append(cid)
        queue = [cid for cid, d in indeg.items() if d == 0]
        seen = 0
        while queue:
            cid = queue.pop()
            seen += 1
            for nxt in out[cid]:
                indeg[nxt] -= 1
                if indeg[nxt] == 0:
                    queue.append(nxt)
        assert seen == len(clues), f"{case['case']}: cycle detected; only {seen}/{len(clues)} processable"


def test_exactly_one_game_end():
    for case in case_entries():
        ends = [c["id"] for c in case["clues"] if c["gameEnd"]]
        assert len(ends) == 1, f"{case['case']}: expected exactly one gameEnd, got {ends}"
        assert ends[0] == "diagnosis"


def test_exactly_two_pillars():
    for case in case_entries():
        pa = [c["id"] for c in case["clues"] if c["pillar"] == "A"]
        pb = [c["id"] for c in case["clues"] if c["pillar"] == "B"]
        assert len(pa) == 1, f"{case['case']}: expected one pillar A, got {pa}"
        assert len(pb) == 1, f"{case['case']}: expected one pillar B, got {pb}"
        assert pa[0] != pb[0]


def test_unique_index_per_character():
    for case in case_entries():
        seen = set()
        for c in case["clues"]:
            key = (c["character"], c["index"])
            assert key not in seen, f"{case['case']}: duplicate index {key}"
            seen.add(key)


def test_pillars_reachable_from_given():
    """Both pillars and the gameEnd clue must be reachable from zero-dependency clues."""
    for case in case_entries():
        clues = clues_by_id(case)
        reachable = {c["id"] for c in case["clues"] if not c["dependencies"]}
        changed = True
        while changed:
            changed = False
            for cid, c in clues.items():
                if cid in reachable:
                    continue
                if all(d in reachable for d in c["dependencies"]):
                    reachable.add(cid)
                    changed = True
        pa = next(c["id"] for c in case["clues"] if c["pillar"] == "A")
        pb = next(c["id"] for c in case["clues"] if c["pillar"] == "B")
        end = next(c["id"] for c in case["clues"] if c["gameEnd"])
        for cid in (pa, pb, end):
            assert cid in reachable, f"{case['case']}: {cid} not reachable from given clues"


def test_game_end_gated_on_pillars():
    for case in case_entries():
        end = next(c for c in case["clues"] if c["gameEnd"])
        pa = next(c["id"] for c in case["clues"] if c["pillar"] == "A")
        pb = next(c["id"] for c in case["clues"] if c["pillar"] == "B")
        assert set(end["dependencies"]) == {pa, pb}, f"{case['case']}: diagnosis must gate on both pillars"


def test_remote_encounter_schema():
    """M1: a remote-encounter case must declare its medium, the screen-guard
    persona, and the online-empathy beats (acknowledge remote / reassure exam
    limits / clear follow-up). The patient must be guarded by construction."""
    for entry, case in CASES:
        if not entry.get("remoteEncounter"):
            continue
        assert entry["region"] == "remote", f"{case['case']}: remote case region must be 'remote'"
        assert "remoteEncounter" in case, f"{case['case']}: index flag but no case remoteEncounter block"
        re_block = case["remoteEncounter"]
        assert re_block.get("medium"), f"{case['case']}: remoteEncounter needs medium"
        assert re_block.get("guard"), f"{case['case']}: remoteEncounter needs guard persona"
        assert isinstance(re_block.get("beats"), list) and len(re_block["beats"]) >= 1, \
            f"{case['case']}: remoteEncounter needs beats"
        patient = next(ch for ch in case["characters"].values() if ch["kind"] == "patient")
        assert "publicProfile" in patient, f"{case['case']}: remote patient needs publicProfile"
        # no physical exam is the remote-encounter premise
        assert "noExam" in re_block and re_block["noExam"] is True, \
            f"{case['case']}: remoteEncounter must declare noExam=True"


def test_distractors_exclude_diagnosis():
    for case in case_entries():
        ex = case["expectation"]
        assert ex["diagnosis"] not in ex["distractors"]
        assert len(set(ex["distractors"])) == len(ex["distractors"])
        assert len(ex["distractors"]) >= 2


def test_pillar_beats_have_fields():
    """Every pillar clue must have a reveal mechanism: multimodal, labResult,
    a syntheticReport that unlocks it, or a region whose image unlocks it."""
    for case in case_entries():
        reports = {r["id"]: r for r in case.get("syntheticReports", [])}
        regions = case.get("regions", {})
        for c in case["clues"]:
            if not c["pillar"]:
                continue
            mm = c.get("multimodal")
            sr = c.get("syntheticReportId")
            rk = c.get("regionKey")
            has_beat = bool(mm) or bool(c.get("labResult")) or bool(sr) or bool(rk)
            assert has_beat, f"{case['case']}: pillar {c['id']} has no reveal mechanism"
            if mm:
                assert mm.get("imageUrl", "").endswith(".jpg") or mm.get("imageUrl", "").startswith("data:")
                assert mm.get("findingKeywords") and mm.get("finding") and mm.get("patientReaction")
                assert mm.get("hint"), f"{case['case']}: multimodal {c['id']} missing hint (vague-image offer)"
            if sr:
                assert sr in reports, f"{case['case']}: pillar {c['id']} refs missing report {sr}"
                assert reports[sr]["unlocksClue"] == c["id"], \
                    f"{case['case']}: report {sr} unlocks {reports[sr]['unlocksClue']}, not {c['id']}"
            if rk:
                assert rk in regions, f"{case['case']}: pillar {c['id']} refs missing region {rk}"
                assert regions[rk]["unlocksClue"] == c["id"], \
                    f"{case['case']}: region {rk} unlocks {regions[rk]['unlocksClue']}, not {c['id']}"


def test_region_and_report_schema():
    for case in case_entries():
        for rk, r in case.get("regions", {}).items():
            assert r["label"] and r["caption"]
            assert r["imageUrl"]
            assert r.get("keywords") and r.get("findingKeywords")
            assert r.get("finding") and r.get("patientReaction") and r.get("unlocksClue")
            assert r.get("hint"), f"{case['case']}: region {rk} missing hint (vague-image offer)"
            assert r["unlocksClue"] in {c["id"] for c in case["clues"]}
        for sr in case.get("syntheticReports", []):
            assert sr["id"] and sr["label"] and sr["caption"]
            assert sr.get("keywords") and len(sr["lines"]) >= 3
            assert sr.get("finding") and sr.get("unlocksClue")
            assert sr.get("hint"), f"{case['case']}: report {sr['id']} missing hint (vague-image offer)"
            assert sr["unlocksClue"] in {c["id"] for c in case["clues"]}


def test_characters_have_identity():
    for case in case_entries():
        for cid, ch in case["characters"].items():
            assert ch["name"] and ch["role"]
            assert ch["kind"] in VALID_KINDS, f"{case['case']}: bad kind {ch['kind']}"
            assert ch["avatarBg"]
            assert isinstance(ch.get("topics"), list) and ch["topics"]


def test_character_voice_registry():
    """N4: every character (and the case-level fallback voice) resolves to a
    TTS preset (safe for the server-side /^[a-z0-9-]+$/i validator — anything
    else degrades to 'charon')."""
    import re
    # mirrors netlify/functions/openrouter.js:343 — ^[a-z0-9-]+$ (case-insensitive)
    valid = re.compile(r"^[a-z0-9-]+$", re.IGNORECASE)
    for case in case_entries():
        assert valid.match(case.get("voice", "")), f"{case['case']}: bad case-level voice {case.get('voice')!r}"
        for cid, ch in case["characters"].items():
            assert ch.get("voice"), f"{case['case']}: character {cid} missing voice"
            assert valid.match(ch["voice"]), f"{case['case']}: {cid} bad voice {ch['voice']}"


def test_no_voice_collision_within_case():
    """N4: no two roles in one case share a TTS preset (distinct audio identity)."""
    for case in case_entries():
        voices = [ch["voice"] for ch in case["characters"].values()]
        assert len(set(voices)) == len(voices), f"{case['case']}: voice collision {voices}"


def test_public_profile_on_patient():
    """The patient character must expose a publicProfile (the auditor's header)."""
    for case in case_entries():
        patient = next(ch for ch in case["characters"].values() if ch["kind"] == "patient")
        assert patient.get("publicProfile"), f"{case['case']}: patient missing publicProfile"
        # publicProfile must NOT leak the diagnosis
        assert case["expectation"]["diagnosis"].lower() not in patient["publicProfile"].lower()
