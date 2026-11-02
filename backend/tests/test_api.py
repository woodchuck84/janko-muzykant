from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import main, store
from backend.scores import ScoreError


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA", tmp_path)
    monkeypatch.setattr(store, "CACHE", tmp_path / "cache")
    monkeypatch.setattr(store, "GENERATED", tmp_path / "generated")
    monkeypatch.setattr(main, "CACHE", tmp_path / "cache")
    monkeypatch.setattr(main, "GENERATED", tmp_path / "generated")
    with TestClient(main.app) as value:
        with store.database() as db:
            db.execute("INSERT INTO songs VALUES ('test-song','Local test song')")
        yield value


def test_local_readonly_boundary(client):
    assert client.get("/api/health").json()["drive_access"] == "read-only"
    assert client.post("/api/sync", json={"root_id": "../invalid"}).status_code == 409
    assert client.post("/api/sync", json={}, headers={"Origin": "https://untrusted.example"}).status_code == 403
    assert client.get("/api/library", headers={"Host": "untrusted.example"}).status_code == 403
    assert client.delete("/api/auth").json() == {"connected": False}


def test_musicxml_import_analysis_and_practice(client):
    fixture = Path(__file__).parent / "fixtures" / "practice.musicxml"
    response = client.post("/api/songs/test-song/musicxml",
                           files={"file": ("practice.musicxml", fixture.read_bytes(), "application/xml")})
    assert response.status_code == 200
    imported = response.json()
    assert imported["drive_modified"] is False
    assert imported["id"].startswith("local-")
    body = {"file_id": imported["id"], "part": "SI"}
    info = client.post("/api/songs/test-song/score-info", json=body).json()
    assert len({p["id"] for p in info["parts"]}) == len(info["parts"])
    body["part_id"] = info["parts"][0]["id"]
    analyzed = client.post("/api/songs/test-song/analyze", json=body)
    assert analyzed.status_code == 200, analyzed.text
    assert analyzed.json()["notes"]
    audio = client.post("/api/songs/test-song/practice", json=body)
    assert audio.status_code == 200, audio.text
    downloaded = client.get(audio.json()["url"])
    assert downloaded.content[:4] == b"RIFF"
    partial = client.get(audio.json()["url"], headers={"Range": "bytes=0-43"})
    assert partial.status_code == 206
    assert len(partial.content) == 44


def test_invalid_xml_upload_is_visible_error(client):
    response = client.post("/api/songs/test-song/musicxml",
                           files={"file": ("broken.xml", b"<bad>", "application/xml")})
    assert response.status_code == 422
    assert response.json()["detail"]
    assert not list(main.CACHE.iterdir())


def test_explicit_line_choice_is_shared_by_score_api_actions_and_audio_cache(client, monkeypatch):
    from backend import scores

    xml = (b'<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Voice</part-name>'
           b'</score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions>'
           b'<time><beats>4</beats><beat-type>4</beat-type></time></attributes>'
           b'<note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>1</voice></note>'
           b'<note><chord/><pitch><step>E</step><octave>3</octave></pitch><duration>4</duration>'
           b'<voice>1</voice></note></measure></part></score-partwise>')
    imported = client.post("/api/songs/test-song/musicxml",
                           files={"file": ("chord.musicxml", xml, "application/xml")}).json()
    body = {"file_id": imported["id"], "part": "B", "part_id": "P1"}
    info = client.post("/api/songs/test-song/score-info", json=body).json()
    assert [c["id"] for c in info["parts"][0]["line_choices"]] == ["upper", "lower"]
    for action in ("analyze", "practice"):
        assert client.post(f"/api/songs/test-song/{action}", json=body).status_code == 422
    rendered = []
    monkeypatch.setattr(scores, "_render", lambda buf, start, duration, midi, gain, timbre: rendered.append(midi))
    urls = []
    for line_id, midi in [("upper", 52), ("lower", 48)]:
        body["line_id"] = line_id
        analysis = client.post("/api/songs/test-song/analyze", json=body)
        assert analysis.status_code == 200, analysis.text
        assert analysis.json()["line_id"] == line_id
        assert analysis.json()["selected_part"]["id"] == "P1"
        assert analysis.json()["notes"][0]["midi"] == midi
        audio = client.post("/api/songs/test-song/practice", json=body)
        assert audio.status_code == 200, audio.text
        assert rendered[-1] == midi
        urls.append(audio.json()["url"])
    assert urls[0] != urls[1]
    for bad_choice in ("voice:99", "voice:1", "unsupported"):
        body["line_id"] = bad_choice
        for action in ("analyze", "practice"):
            assert client.post(f"/api/songs/test-song/{action}", json=body).status_code == 422


@pytest.mark.parametrize(("part", "staff", "low"), [("B", "P3", "C3"), ("AI", "P2", "G4"), ("SII", "P1", "C5")])
def test_unnamed_staff_inspection_precedes_both_actions(client, part, staff, low):
    fixture = Path(__file__).parent / "fixtures" / "unnamed.musicxml"
    imported = client.post("/api/songs/test-song/musicxml",
                           files={"file": ("unnamed.musicxml", fixture.read_bytes(), "application/xml")}).json()
    body = {"file_id": imported["id"], "part": part}
    info = client.post("/api/songs/test-song/score-info", json=body)
    assert info.status_code == 200
    assert info.json()["automatic_part_id"] is None
    assert info.json()["suggested_part_id"] == staff
    assert [p["staff"] for p in info.json()["parts"]] == [1, 2, 3]
    chosen = next(p for p in info.json()["parts"] if p["id"] == staff)
    assert chosen["range"]["low"] == low
    assert chosen["name"] == "Voice"
    assert chosen["multiple_lines"] is False
    for action in ("analyze", "practice"):
        assert client.post(f"/api/songs/test-song/{action}", json=body).status_code == 422
    body["part_id"] = staff
    analysis = client.post("/api/songs/test-song/analyze", json=body)
    assert analysis.status_code == 200, analysis.text
    assert analysis.json()["selected_part"]["id"] == staff
    assert analysis.json()["range"]["low"] == low
    audio = client.post("/api/songs/test-song/practice", json=body)
    assert audio.status_code == 200, audio.text
    output = Path(audio.json()["local_path"])
    assert output.parent == main.GENERATED.resolve()
    assert output.name == audio.json()["filename"]
    assert output.is_file()
    assert audio.json()["drive_modified"] is False
    downloaded = client.get(audio.json()["url"])
    assert downloaded.content == output.read_bytes()
    assert downloaded.content[:4] == b"RIFF"
    assert output.name in downloaded.headers["content-disposition"]


def test_missing_omr_returns_real_pdf_metadata(client, monkeypatch):
    import pymupdf
    from backend import scores
    file_id = "pdf-1234567890"
    path = main.CACHE / f"{file_id}.pdf"
    pdf = pymupdf.open()
    page = pdf.new_page()
    page.insert_text((50, 50), "Actual score PDF metadata")
    pdf.save(path)
    pdf.close()
    with store.database() as db:
        db.execute("INSERT INTO files VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                   (file_id, "test-song", None, "test.pdf", "application/pdf", "pdf", None, 0, 0, "", None, path.stat().st_size))

    def missing(*args, **kwargs):
        raise ScoreError("Install Audiveris or import MusicXML.")
    monkeypatch.setattr(scores, "convert_pdf", missing)
    response = client.post("/api/songs/test-song/analyze", json={"part": "SI"})
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == "omr_required"
    assert "Actual score PDF metadata" in str(detail["pdf"])
    assert "notes" not in detail


def test_sync_records_new_materials_locally(client, monkeypatch):
    with store.database() as db:
        db.execute("INSERT INTO files VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                   ("remote-old-12345", "test-song", None, "A - Old.m4a", "audio/mp4", "audio", "A", 0, 0, "", None, 100))

    async def sync_without_network(root, event=None):
        with store.database() as db:
            db.execute("INSERT OR REPLACE INTO files VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                       ("remote-new-12345", "test-song", None, "A - New.m4a", "audio/mp4", "audio", "A", 0, 0, "", None, 200))
        return {"songs": 1, "files": 2, "events": 0, "warnings": []}

    monkeypatch.setattr(main.drive, "sync", sync_without_network)
    response = client.post("/api/sync", json={})
    assert response.status_code == 200
    assert response.json()["new_materials"] == 1
    state = client.get("/api/planning/state?part=AI").json()
    assert len(state["changes"]) == 1
    assert "A - New.m4a" in str(state["changes"])
    assert client.post("/api/sync", json={}).json()["new_materials"] == 0
    assert client.post("/api/planning/changes/ack", json={}).status_code == 200
    assert client.get("/api/planning/state?part=AI").json()["changes"] == []
