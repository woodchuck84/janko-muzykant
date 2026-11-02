"""Tests for backend.scores (score intelligence)."""

from __future__ import annotations

import sys
import wave
import zipfile
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import scores  # noqa: E402
from scores import EngineMissingError, PartSelectionError, ScoreError  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures" / "practice.musicxml"


def make_xml(parts: list[tuple[str, str, str]], tempo: int | None = 90) -> str:
    """parts: (id, name, measures-xml). Divisions = 1 (quarter)."""
    plist = "".join(f'<score-part id="{pid}"><part-name>{name}</part-name></score-part>' for pid, name, _ in parts)
    body = []
    for i, (pid, _name, measures) in enumerate(parts):
        direction = ""
        if tempo and i == 0:
            direction = (f'<direction><direction-type><metronome><beat-unit>quarter</beat-unit>'
                         f'<per-minute>{tempo}</per-minute></metronome></direction-type></direction>')
        attrs = ('<attributes><divisions>1</divisions><key><fifths>0</fifths></key>'
                 '<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef>'
                 '</attributes>')
        body.append(f'<part id="{pid}"><measure number="1">{attrs}{direction}{measures}</measure></part>')
    return ('<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">'
            f'<part-list>{plist}</part-list>{"".join(body)}</score-partwise>')


def note(step: str, octave: int, dur: int = 1, chord: bool = False, voice: int = 1) -> str:
    return (f'<note>{"<chord/>" if chord else ""}<pitch><step>{step}</step><octave>{octave}</octave></pitch>'
            f'<duration>{dur}</duration><voice>{voice}</voice></note>')


def write(tmp_path: Path, name: str, text: str) -> Path:
    path = tmp_path / name
    path.write_text(text, encoding="utf-8")
    return path


def make_mxl(path: Path, xml: bytes, root: str = "score.musicxml", extra: dict[str, bytes] | None = None) -> Path:
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("META-INF/container.xml",
                    f'<?xml version="1.0"?><container><rootfiles><rootfile full-path="{root}" '
                    'media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>')
        zf.writestr(root, xml)
        for name, data in (extra or {}).items():
            zf.writestr(name, data)
    return path


# --------------------------------------------------------------------------- loading


def test_load_real_fixture_returns_score():
    from music21 import stream

    score = scores.load_score(FIXTURE)
    assert isinstance(score, stream.Score)
    assert [p.partName for p in score.parts] == ["Soprano I", "Soprano II", "Alto", "Baritone"]


def test_list_parts_detects_voice_codes():
    parts = scores.list_parts(FIXTURE)
    assert [(p["id"], p["code"]) for p in parts] == [("P1", "SI"), ("P2", "SII"), ("P3", "A"), ("P4", "B")]


def test_inspection_does_not_resolve_ambiguous_named_divisi(tmp_path):
    path = write(tmp_path, "ambiguous.musicxml", make_xml([
        ("P1", "Alto", note("G", 4, 4)), ("P2", "Alto", note("C", 4, 4)),
    ]))
    assert scores.inspect_parts(path, "AI")["automatic_part_id"] is None
    with pytest.raises(PartSelectionError):
        scores.analyze(path, "AI")


def test_bass_suggestion_prefers_f_clef_over_bottom_staff_and_still_requires_confirmation(tmp_path):
    xml = make_xml([("P1", "Voice", note("G", 3, 4)), ("P2", "Voice", note("C", 5, 4))])
    xml = xml.replace("<sign>G</sign>", "<sign>F</sign>", 1)
    path = write(tmp_path, "bass-not-bottom.musicxml", xml)
    info = scores.inspect_parts(path, "B")
    assert info["suggested_part_id"] == "P1"
    assert info["parts"][0]["bass_clef"] is True
    assert info["automatic_part_id"] is None
    with pytest.raises(PartSelectionError):
        scores.analyze(path, "B")


def test_bass_suggestion_uses_bottom_staff_when_f_clef_is_absent(tmp_path):
    path = write(tmp_path, "no-bass-clef.musicxml", make_xml([
        ("P1", "Voice", note("C", 5, 4)), ("P2", "Voice", note("G", 3, 4)),
    ]))
    info = scores.inspect_parts(path, "B")
    assert not any(p["bass_clef"] for p in info["parts"])
    assert info["suggested_part_id"] == "P2"
    assert info["automatic_part_id"] is None


def test_unnamed_polyphonic_staff_requires_named_voice_not_a_guessed_top_note(tmp_path):
    path = write(tmp_path, "divisi.musicxml", make_xml([
        ("P1", "Voice", note("C", 4, 4) + note("E", 4, 4, chord=True)),
    ]))
    assert scores.inspect_parts(path, "AI")["parts"][0]["multiple_lines"] is True
    with pytest.raises(PartSelectionError, match="multiple lines/divisi"):
        scores.analyze(path, "AI", part_id="P1")
    with pytest.raises(PartSelectionError, match="multiple lines/divisi"):
        scores.synthesize(path, tmp_path / "not-generated.wav", "AI", part_id="P1")
    assert not (tmp_path / "not-generated.wav").exists()


def test_mxl_archive_is_parsed(tmp_path):
    mxl = make_mxl(tmp_path / "song.mxl", FIXTURE.read_bytes())
    result = scores.analyze(mxl, "SII")
    assert result["selected_part"] == {"id": "P2", "name": "Soprano II"}


def test_explicit_chord_policies_share_analysis_and_generation(tmp_path, monkeypatch):
    path = write(tmp_path, "explicit-chord.musicxml", make_xml([
        ("P1", "Voice", note("C", 3, 4) + note("E", 3, 4, chord=True)),
    ]))
    choices = scores.inspect_parts(path, "B")["parts"][0]["line_choices"]
    assert [choice["id"] for choice in choices] == ["upper", "lower"]
    assert [choice["range"]["low_midi"] for choice in choices] == [52, 48]
    rendered = []
    monkeypatch.setattr(scores, "_render", lambda buf, start, duration, midi, gain, timbre: rendered.append(midi))
    for line_id, pitch in [("upper", "E3"), ("lower", "C3")]:
        result = scores.analyze(path, "B", part_id="P1", line_id=line_id)
        assert [n["pitch"] for n in result["notes"]] == [pitch]
        assert result["selected_part"]["id"] == "P1"
        assert result["notes"][0]["offset"] == 0
        assert result["notes"][0]["quarter_length"] == 4
        scores.synthesize(path, tmp_path / f"{line_id}.wav", "B", part_id="P1", line_id=line_id)
        assert rendered[-1] == result["notes"][0]["midi"]
    with pytest.raises(ScoreError, match="not an extractable"):
        scores.analyze(path, "B", part_id="P1", line_id="voice:1")
    with pytest.raises(PartSelectionError, match="Choose a staff"):
        scores.analyze(path, "B", line_id="lower")
    with pytest.raises(ScoreError):
        scores.synthesize(path, tmp_path / "invalid.wav", "B", part_id="P1", line_id="voice:99")
    assert not (tmp_path / "invalid.wav").exists()


def test_internal_voice_identity_is_not_sorted_position_or_missing_bar_fallback(tmp_path):
    measures = ('<note><rest/><duration>1</duration><voice>1</voice></note><backup><duration>1</duration></backup>'
                + note("G", 2, 4, voice=7))
    xml = make_xml([("P1", "Voice", measures)])
    xml = xml.replace('</part>', '<measure number="2">' + note("D", 3, 4, voice=1) + '</measure>'
                      '<measure number="3">' + note("A", 2, 4, voice=7) + '</measure></part>')
    path = write(tmp_path, "voice-identities.musicxml", xml)
    choices = scores.inspect_parts(path, "B")["parts"][0]["line_choices"]
    assert [c["id"] for c in choices] == ["voice:1", "voice:7"]
    selected = scores.analyze(path, "B", part_id="P1", line_id="voice:7")
    assert [(n["bar"], n["pitch"]) for n in selected["notes"]] == [(1, "G2"), (3, "A2")]
    assert "missing bars are not filled" in " ".join(selected["warnings"])
    with pytest.raises(PartSelectionError, match="multiple lines/divisi"):
        scores.analyze(path, "B", part_id="P1")
    with pytest.raises(ScoreError):
        scores.analyze(path, "B", part_id="P1", line_id="lower")


def test_explicit_choices_refuse_overlapping_non_chord_layers(tmp_path):
    xml = make_xml([("P1", "Voice", note("C", 3, 4) + '<backup><duration>4</duration></backup>' + note("E", 3, 4))])
    path = write(tmp_path, "overlap.musicxml", xml)
    assert scores.inspect_parts(path, "B")["parts"][0]["line_choices"] == []
    with pytest.raises(ScoreError):
        scores.analyze(path, "B", part_id="P1", line_id="voice:1")


def test_named_bass_divisi_also_requires_explicit_line_choice(tmp_path):
    path = write(tmp_path, "named-bass-chord.musicxml", make_xml([
        ("P1", "Bass", note("C", 3, 4) + note("E", 3, 4, chord=True)),
    ]))
    for part_id in [None, "P1"]:
        with pytest.raises(PartSelectionError, match="explicit line_id"):
            scores.analyze(path, "B", part_id=part_id)
    assert scores.analyze(path, "B", part_id="P1", line_id="lower")["notes"][0]["midi"] == 48


REAL_WOJENCE = Path(__file__).resolve().parents[2] / "data" / "cache" / "omr-be24fe3e4645276e778f04de.mxl"


@pytest.mark.skipif(not REAL_WOJENCE.exists(), reason="Read-only local Drive cache is not distributed with tests")
def test_actual_wojence_omr_bass_selection_is_explicit_and_does_not_repair_source(tmp_path, monkeypatch):
    before = REAL_WOJENCE.read_bytes()
    info = scores.inspect_parts(REAL_WOJENCE, "B")
    bass = next(p for p in info["parts"] if p["id"] == "P3")
    assert bass["bass_clef"] and bass["multiple_lines"]
    assert [c["id"] for c in bass["line_choices"]] == ["voice:1", "voice:2"]
    with pytest.raises(PartSelectionError):
        scores.analyze(REAL_WOJENCE, "B", part_id="P3")
    selected = scores.analyze(REAL_WOJENCE, "B", part_id="P3", line_id="voice:2")
    # The cached OMR changes voice IDs in bars 12/14; voice 3 consists only of spurious rests.
    assert sorted({n["bar"] for n in selected["notes"]}) == [12, 14]
    assert selected["range"]["low_midi"] == 43
    assert selected["range"]["high_midi"] == 50
    assert len(selected["notes"]) == 16  # both bars repeated by backend repeat expansion
    rendered = []
    monkeypatch.setattr(scores, "_render", lambda buf, start, duration, midi, gain, timbre: rendered.append(midi))
    output = scores.synthesize(REAL_WOJENCE, tmp_path / "actual-bass.wav", "B", part_id="P3", line_id="voice:2")
    assert rendered == [n["midi"] for n in selected["notes"]]
    assert output.exists() and REAL_WOJENCE.read_bytes() == before
    for invalid in ["voice:3", "upper", "lower"]:
        with pytest.raises(ScoreError):
            scores.analyze(REAL_WOJENCE, "B", part_id="P3", line_id=invalid)


def test_mxl_zip_bomb_is_refused(tmp_path):
    bomb = make_mxl(tmp_path / "bomb.mxl", FIXTURE.read_bytes(), extra={"pad.bin": b"\0" * (20 * 1024 * 1024)})
    with pytest.raises(ScoreError) as err:
        scores.load_score(bomb)
    assert err.value.code == "unsafe_archive"


def test_mxl_path_traversal_is_refused(tmp_path):
    bad = make_mxl(tmp_path / "bad.mxl", FIXTURE.read_bytes(), root="../evil.musicxml")
    with pytest.raises(ScoreError) as err:
        scores.load_score(bad)
    assert err.value.code == "unsafe_archive"


def test_xml_entities_and_bad_formats_are_refused(tmp_path):
    evil = write(tmp_path, "evil.musicxml",
                 '<?xml version="1.0"?><!DOCTYPE score-partwise [<!ENTITY a "aaaa">]><score-partwise/>')
    with pytest.raises(ScoreError):
        scores.load_score(evil)
    with pytest.raises(ScoreError) as err:
        scores.load_score(write(tmp_path, "x.txt", "hello"))
    assert err.value.code == "unsupported_format"
    with pytest.raises(ScoreError) as err:
        scores.load_score(tmp_path / "missing.musicxml")
    assert err.value.code == "not_found"


# --------------------------------------------------------------------------- timeline


def test_timeline_honours_rests_repeats_tempo_changes_and_ties():
    r = scores.analyze(FIXTURE, "SI")
    assert r["selected_part"] == {"id": "P1", "name": "Soprano I"}
    assert r["requested_part"] == "SI" and r["warning"] is None
    assert r["tempo"] == 60 and r["duration"] == 20.0
    assert [(t["bar"], t["bpm"], t["time"]) for t in r["tempos"]] == [(1, 60, 0.0), (3, 120, 16.0)]
    notes = r["notes"]
    assert len(notes) == 14
    # bar 1 starts with a quarter rest: first note on beat 2 at 1 s (60 BPM)
    assert (notes[0]["time"], notes[0]["bar"], notes[0]["beat"], notes[0]["pitch"]) == (1.0, 1, 2.0, "G4")
    # repeat of bars 1-2: second pass starts after 8 s, same written offsets
    second = notes[5]
    assert (second["time"], second["bar"], second["pass"], second["offset"]) == (9.0, 1, 1, 1.0)
    # bar 3 at 120 BPM: eighth notes last 0.25 s
    assert (notes[10]["time"], notes[10]["duration"]) == (16.0, 0.25)
    # tied F#5 (half + half across the bar line) is one 2-second note
    tied = notes[-1]
    assert (tied["pitch"], tied["midi"], tied["time"], tied["duration"], tied["bar"], tied["beat"]) == (
        "F#5", 78, 17.0, 2.0, 3, 3.0)
    assert tied["offset"] == 10.0 and tied["quarter_length"] == 4.0
    assert all(set(n) >= {"time", "duration", "midi", "pitch", "bar", "beat", "lyric"} for n in notes)
    times = [n["time"] for n in notes]
    assert times == sorted(times)


def test_range_lyrics_and_bars():
    r = scores.analyze(FIXTURE, "SI")
    assert r["range"] == {"low": "G4", "high": "G5", "low_midi": 67, "high_midi": 79}
    assert [ly["text"] for ly in r["lyrics"][:5]] == ["La", "la,", "sing", "glo-", "ry."]
    bars = {b["number"]: b for b in r["bars"]}
    assert set(bars) == {1, 2, 3, 4}
    assert all(0 <= b["difficulty"] <= 100 for b in bars.values())
    assert any("octave" in reason for reason in bars[3]["reasons"])
    assert any("C#5" in reason for reason in bars[2]["reasons"])
    assert bars[3]["difficulty"] > bars[1]["difficulty"]
    assert bars[4]["difficulty"] == 0
    assert (bars[3]["start_offset"], bars[3]["end_offset"]) == (8.0, 12.0)


def test_breaths_from_rests_and_punctuation():
    r = scores.analyze(FIXTURE, "SI")
    found = {(b["bar"], b["beat"], b["reason"].split(" ")[0]) for b in r["breaths"]}
    assert (1, 4.0, "punctuation") in found  # after "la,"
    assert (2, 3.0, "rest") in found
    assert all(set(b) >= {"bar", "beat", "reason"} for b in r["breaths"])


def test_entrances_reference_actual_other_parts():
    r = scores.analyze(FIXTURE, "SI")
    first = r["entrances"][0]
    assert (first["bar"], first["beat"], first["pitch"]) == (1, 2.0, "G4")
    assert "Baritone" in first["cue"] and "octave" in first["cue"]
    assert "Soprano II" in first["cue"]  # enters together
    alto = scores.analyze(FIXTURE, "A")["entrances"][0]
    assert "start alone" not in alto["cue"] and "together with Baritone" in alto["cue"]


def test_transpose_and_tempo_factor():
    r = scores.analyze(FIXTURE, "SI", tempo_factor=2, transpose=2)
    assert r["duration"] == 10.0 and r["tempo"] == 120
    assert r["notes"][0]["pitch"] == "A4" and r["notes"][0]["midi"] == 69 and r["notes"][0]["time"] == 0.5
    assert r["range"]["high"] == "A5"
    assert any("transposed" in w for w in r["warnings"])
    with pytest.raises(ScoreError):
        scores.analyze(FIXTURE, "SI", tempo_factor=0)
    with pytest.raises(ScoreError):
        scores.analyze(FIXTURE, "SI", transpose=99)


def test_missing_tempo_warns(tmp_path):
    path = write(tmp_path, "t.musicxml", make_xml([("P1", "Alto", note("C", 5, 4))], tempo=None))
    r = scores.analyze(path, "A")
    assert r["tempo"] == scores.DEFAULT_TEMPO
    assert any("No metronome mark" in w for w in r["warnings"])


# --------------------------------------------------------------------------- part selection


def test_exact_divisi_match_and_base_fallback_warns():
    assert scores.analyze(FIXTURE, "SII")["selected_part"]["id"] == "P2"
    r = scores.analyze(FIXTURE, "AII")
    assert r["selected_part"] == {"id": "P3", "name": "Alto"}
    assert r["warning"] and "no separate AII" in r["warning"]
    assert r["warning"] in r["warnings"]


def test_ambiguous_and_missing_parts_raise_with_available_parts():
    with pytest.raises(PartSelectionError) as err:
        scores.analyze(FIXTURE, "S")
    assert len(err.value.available_parts) == 4
    assert err.value.to_dict()["available_parts"][0] == {"id": "P1", "name": "Soprano I", "code": "SI"}
    with pytest.raises(PartSelectionError):
        scores.analyze(FIXTURE, "T")
    with pytest.raises(PartSelectionError):
        scores.analyze(FIXTURE, "SI", part_id="nope")
    with pytest.raises(ScoreError):
        scores.analyze(FIXTURE, "X")


def test_part_id_accepts_xml_id_and_music21_id():
    assert scores.analyze(FIXTURE, "A", part_id="P3")["selected_part"]["id"] == "P3"
    assert scores.analyze(FIXTURE, "A", part_id="Alto")["selected_part"]["id"] == "P3"


def test_divisi_chords_on_combined_staff(tmp_path):
    measures = (note("E", 5, 2) + note("C", 5, 2, chord=True) + note("D", 5, 2) + note("B", 4, 2, chord=True))
    path = write(tmp_path, "d.musicxml", make_xml([("P1", "Soprano", measures), ("P2", "Bass", note("C", 3, 4))]))
    upper = scores.analyze(path, "SI")
    lower = scores.analyze(path, "SII")
    assert [n["pitch"] for n in upper["notes"]] == ["E5", "D5"]
    assert [n["pitch"] for n in lower["notes"]] == ["C5", "B4"]
    assert "upper" in upper["warning"] and "lower" in lower["warning"]
    assert any("divisi" in r for r in lower["bars"][0]["reasons"])
    with pytest.raises(PartSelectionError):
        scores.analyze(path, "AI")


def test_two_voices_on_shared_staff(tmp_path):
    measures = (note("G", 5, 4, voice=1) + '<backup><duration>4</duration></backup>'
                + note("C", 5, 2, voice=2) + note("D", 5, 2, voice=2))
    path = write(tmp_path, "v.musicxml", make_xml([("P1", "Soprano/Alto", measures)]))
    assert [p["code"] for p in scores.list_parts(path)] == ["S/A"]
    assert [n["pitch"] for n in scores.analyze(path, "S")["notes"]] == ["G5"]
    alto = scores.analyze(path, "A")
    assert [n["pitch"] for n in alto["notes"]] == ["C5", "D5"]
    assert "shares the staff" in alto["warning"]


def test_label_parser_variants():
    assert scores._parse_label("Sopran II") == [("S", 2)]
    assert scores._parse_label("S.1") == [("S", 1)]
    assert scores._parse_label("Alt I/II") == [("A", 1), ("A", 2)]
    assert scores._parse_label("Baryton") == [("B", None)]
    assert scores._parse_label("Piano") == []


# --------------------------------------------------------------------------- synthesis


def read_wav(path: Path) -> tuple[wave._wave_params, np.ndarray]:
    with wave.open(str(path), "rb") as wf:
        params = wf.getparams()
        data = np.frombuffer(wf.readframes(params.nframes), dtype="<i2")
    return params, data


def test_synthesize_writes_bounded_wav(tmp_path):
    out = scores.synthesize(FIXTURE, tmp_path / "out" / "si.wav", "SI")
    params, data = read_wav(out)
    assert (params.nchannels, params.sampwidth, params.framerate) == (1, 2, scores.SAMPLE_RATE)
    assert abs(params.nframes / params.framerate - 20.5) < 0.01
    sr = params.framerate
    assert np.abs(data[: int(0.9 * sr)]).max() == 0  # opening rest is silent
    assert np.abs(data[int(1.1 * sr): int(1.9 * sr)]).max() > 1000  # G4 sounding
    slow = scores.synthesize(FIXTURE, tmp_path / "slow.wav", "SI", tempo_factor=0.5)
    assert abs(read_wav(slow)[0].nframes / sr - 40.5) < 0.01
    assert not list(tmp_path.rglob("*.tmp"))


def test_synthesize_with_bass_adds_low_line(tmp_path):
    plain = read_wav(scores.synthesize(FIXTURE, tmp_path / "a.wav", "SI"))[1]
    with_bass = read_wav(scores.synthesize(FIXTURE, tmp_path / "b.wav", "SI", include_bass=True))[1]
    sr = scores.SAMPLE_RATE
    assert np.abs(plain[: int(0.9 * sr)]).max() == 0
    assert np.abs(with_bass[: int(0.9 * sr)]).max() > 500  # baritone sings on beat 1


def test_synthesize_rejects_bad_output(tmp_path):
    with pytest.raises(ScoreError):
        scores.synthesize(FIXTURE, tmp_path / "x.mp3", "SI")


# --------------------------------------------------------------------------- PDF / OMR


def make_pdf(path: Path) -> Path:
    pymupdf = pytest.importorskip("pymupdf")
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Piechota - chor  q = 80")
    doc.save(str(path))
    doc.close()
    return path


def test_inspect_pdf_reports_pages_and_text(tmp_path):
    info = scores.inspect_pdf(make_pdf(tmp_path / "s.pdf"))
    assert info["page_count"] == 1
    assert "Piechota" in info["text"] and info["has_text_layer"]
    assert info["pages"][0]["number"] == 1
    assert "available" in info["omr"]
    with pytest.raises(ScoreError):
        scores.inspect_pdf(write(tmp_path, "fake.pdf", "not a pdf"))


@pytest.fixture
def no_engine(monkeypatch):
    monkeypatch.delenv("AUDIVERIS_COMMAND", raising=False)
    monkeypatch.setattr(scores.shutil, "which", lambda name: None)
    monkeypatch.setattr(scores, "_default_audiveris_locations", lambda: [])


def test_missing_engine_raises_actionable_error(tmp_path, no_engine):
    pdf = make_pdf(tmp_path / "s.pdf")
    with pytest.raises(EngineMissingError) as err:
        scores.convert_pdf(pdf, tmp_path / "out")
    assert err.value.code == "omr_engine_missing"
    assert "AUDIVERIS_COMMAND" in err.value.hint and "MusicXML" in err.value.hint
    assert scores.audiveris_status()["available"] is False
    assert scores.inspect_pdf(pdf)["omr"]["available"] is False


def test_bad_audiveris_command(tmp_path, monkeypatch):
    monkeypatch.setenv("AUDIVERIS_COMMAND", str(tmp_path / "nope" / "Audiveris.exe"))
    with pytest.raises(EngineMissingError):
        scores.convert_pdf(make_pdf(tmp_path / "s.pdf"), tmp_path / "out")


FAKE_ENGINE = r'''
import sys, shutil, zipfile
from pathlib import Path
args = sys.argv[1:]
out = Path(args[args.index("-output") + 1])
pdf = Path(args[-1])
if "{mode}" == "fail":
    sys.stderr.write("fake engine: cannot read sheet\n")
    sys.exit(3)
with zipfile.ZipFile(out / (pdf.stem + ".mxl"), "w") as zf:
    zf.writestr("META-INF/container.xml", '<container><rootfiles><rootfile full-path="s.xml"/></rootfiles></container>')
    zf.write(r"{fixture}", "s.xml")
'''


def fake_engine(tmp_path: Path, monkeypatch, mode: str) -> None:
    script = tmp_path / "fake engine dir" / "fake_audiveris.py"
    script.parent.mkdir()
    script.write_text(FAKE_ENGINE.replace("{mode}", mode).replace("{fixture}", str(FIXTURE)), encoding="utf-8")
    monkeypatch.setenv("AUDIVERIS_COMMAND", f'"{sys.executable}" "{script}"')


def test_convert_pdf_with_configured_engine(tmp_path, monkeypatch):
    fake_engine(tmp_path, monkeypatch, "ok")
    pdf = make_pdf(tmp_path / "Piechota - chor.pdf")
    out = scores.convert_pdf(pdf, tmp_path / "omr out")
    assert out.name == "Piechota - chor.mxl" and out.is_file()
    assert scores.analyze(out, "B")["selected_part"]["name"] == "Baritone"
    assert scores.audiveris_status()["source"] == "env"


def test_convert_pdf_reports_engine_stderr(tmp_path, monkeypatch):
    fake_engine(tmp_path, monkeypatch, "fail")
    with pytest.raises(ScoreError) as err:
        scores.convert_pdf(make_pdf(tmp_path / "s.pdf"), tmp_path / "out")
    assert err.value.code == "omr_failed"
    assert "cannot read sheet" in err.value.message and "exit code 3" in err.value.message


def test_command_split_keeps_windows_paths():
    argv = scores._split_command('"C:\\Program Files\\Audiveris\\Audiveris.exe" -Xmx2g')
    if scores.os.name == "nt":
        assert argv == ["C:\\Program Files\\Audiveris\\Audiveris.exe", "-Xmx2g"]
    else:
        assert argv[-1] == "-Xmx2g"