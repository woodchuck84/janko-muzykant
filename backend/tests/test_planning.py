from datetime import date

import httpx
import pymupdf
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import planning, store
from backend.drive import DriveError, drive

PIL = "1fCFEIulRwuD6IQidZqahGwC7CKZxwDGP"
WRO = "1vK1jee6NUlVO3oIJoFzqzNSmR8BlPkLg"
POZ = "1lkSN2okiF2FkpR6GqD6Qu4cogFwJfWra"
CAL = "1RUbElY5q773AMqRD-mg34iML73t0Zx3G"
CAL_NAME = "Vox Apostoli - Kalendarz, repertuar 2026_2027.pdf"


def file_row(file_id, name, song=None, event=None, modified=None, size=None, kind="audio", part=None):
    return {"id": file_id, "song_id": song, "event_id": event, "name": name, "mime": "audio/mp4", "kind": kind,
            "part": part, "slow": 0, "full": 0, "section": "", "modified": modified, "size": size}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA", tmp_path)
    monkeypatch.setattr(store, "CACHE", tmp_path / "cache")
    monkeypatch.setattr(store, "GENERATED", tmp_path / "generated")
    monkeypatch.setattr(planning, "today", lambda: date(2026, 10, 31))
    store.initialize()
    planning.initialize_planning()
    planning.initialize_planning()
    with store.database() as db:
        db.executemany("INSERT INTO events VALUES (?,?)", [
            (PIL, "7.11 - Koncert niepodległościowy w Piławie"),
            (WRO, "8.11 - Koncert niepodległościowy - Wrocław"),
            (POZ, "Konkurs w Poznaniu")])
        db.executemany("INSERT INTO songs VALUES (?,?)", [
            ("song-z", "Łączko zielona"), ("song-a", "Arka"), ("song-p", "Piechota"), ("song-r", "Rota")])
        db.executemany("INSERT INTO event_songs VALUES (?,?,?)", [
            (WRO, "song-z", "f1"), (WRO, "song-a", "f2"), (WRO, "song-p", "f3"), (PIL, "song-p", "f4")])
    app = FastAPI()
    app.include_router(planning.router)
    with TestClient(app) as value:
        yield value


def make_calendar(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    pdf = pymupdf.open()
    page = pdf.new_page()
    lines = ["Kalendarz sezonu 2026/2027", "7.11 Koncert w Pilawie, godz. 18.00",
             "8.11 Wroclaw - koncert niepodleglosciowy", "13-14.11 Konkurs chóralny w Poznaniu",
             "17.01 Kolędy", "Proba: 12 maja"]
    for index, line in enumerate(lines):
        page.insert_text((50, 60 + index * 20), line, fontname="helv")
    pdf.save(path)
    pdf.close()


def add_calendar_record():
    with store.database() as db:
        db.execute("INSERT INTO files VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                   (CAL, None, None, CAL_NAME, "application/pdf", "pdf", None, 0, 0, "", None, None))


def test_state_defaults_and_validation(client):
    state = client.get("/api/planning/state", params={"part": "AI"}).json()
    assert state["today"] == "2026-10-31"
    assert state["statuses"] == [] and state["dates"] == [] and state["changes"] == []
    assert state["calendar"] is None
    wro = next(s for s in state["setlists"] if s["event_id"] == WRO)
    assert wro["song_ids"] == ["song-a", "song-z", "song-p"]
    assert wro["custom"] is False and "alfabetyczna" in wro["order_note"]
    assert client.get("/api/planning/state", params={"part": "X"}).status_code == 422


def test_progress_is_per_part_and_clearable(client):
    assert client.post("/api/planning/progress", json={"song_id": "song-a", "part": "AI", "status": "memory"}).status_code == 200
    assert client.post("/api/planning/progress", json={"song_id": "song-a", "part": "SI", "status": "listened"}).status_code == 200
    assert client.post("/api/planning/progress", json={"song_id": "song-a", "part": "AI", "status": "great"}).status_code == 422
    assert client.post("/api/planning/progress", json={"song_id": "nope", "part": "AI", "status": "memory"}).status_code == 404
    statuses = client.get("/api/planning/state?part=AI").json()["statuses"]
    assert [(s["song_id"], s["status"]) for s in statuses] == [("song-a", "memory")]
    client.post("/api/planning/progress", json={"song_id": "song-a", "part": "AI", "status": "none"})
    assert client.get("/api/planning/state?part=AI").json()["statuses"] == []
    assert client.get("/api/planning/state?part=SI").json()["statuses"][0]["status"] == "listened"


def test_sessions_bounded_and_streak(client, monkeypatch):
    for day, seconds in ((date(2026, 10, 29), 300), (date(2026, 10, 30), 120), (date(2026, 10, 31), 60)):
        monkeypatch.setattr(planning, "today", lambda day=day: day)
        response = client.post("/api/planning/session", json={"song_id": "song-p", "part": "AI", "seconds": seconds})
        assert response.status_code == 200, response.text
    for bad in (0, -5, planning.MAX_SESSION + 1):
        assert client.post("/api/planning/session", json={"song_id": "song-p", "part": "AI", "seconds": bad}).status_code == 422
    assert client.post("/api/planning/session", json={"song_id": "x", "part": "AI", "seconds": 10}).status_code == 404
    sessions = client.get("/api/planning/state?part=AI").json()["sessions"]
    assert sessions["today_seconds"] == 60 and sessions["streak_days"] == 3 and sessions["total_seconds"] == 480
    assert sessions["by_song"] == {"song-p": 480}
    assert sessions["last_days"][-1] == {"day": "2026-10-31", "seconds": 60}
    monkeypatch.setattr(planning, "today", lambda: date(2026, 11, 1))
    assert client.get("/api/planning/state?part=AI").json()["sessions"]["streak_days"] == 3
    monkeypatch.setattr(planning, "today", lambda: date(2026, 11, 2))
    assert client.get("/api/planning/state?part=AI").json()["sessions"]["streak_days"] == 0
    for _ in range(4):
        client.post("/api/planning/session", json={"song_id": "song-p", "part": "AI", "seconds": planning.MAX_SESSION})
    assert client.post("/api/planning/session", json={"song_id": "song-p", "part": "AI", "seconds": 60}).status_code == 422


def test_dates_countdown_and_setlists(client):
    client.post("/api/planning/progress", json={"song_id": "song-a", "part": "AI", "status": "concert"})
    saved = client.post("/api/planning/date", json={"event_id": WRO, "date": "2026-11-08"}).json()
    assert saved["days_until"] == 8 and saved["source"] == "manual"
    client.post("/api/planning/date", json={"event_id": PIL, "date": "2026-10-01"})
    assert client.post("/api/planning/date", json={"event_id": WRO, "date": "2026-02-30"}).status_code == 422
    assert client.post("/api/planning/date", json={"event_id": "missing-event", "date": "2026-11-08"}).status_code == 404
    state = client.get("/api/planning/state?part=AI").json()
    assert [d["event_id"] for d in state["dates"]] == [PIL, WRO]
    assert state["upcoming"] == [{"event_id": WRO, "name": "8.11 - Koncert niepodległościowy - Wrocław",
                                  "date": "2026-11-08", "days_until": 8, "song_count": 3,
                                  "not_ready": ["song-z", "song-p"]}]
    order = ["song-p", "song-r", "song-a"]
    custom = client.post("/api/planning/setlist", json={"event_id": WRO, "song_ids": order}).json()
    assert custom["song_ids"] == order and custom["custom"] is True and custom["unlisted_song_ids"] == ["song-z"]
    assert client.post("/api/planning/setlist", json={"event_id": WRO, "song_ids": ["song-a", "song-a"]}).status_code == 422
    assert client.post("/api/planning/setlist", json={"event_id": WRO, "song_ids": ["ghost"]}).status_code == 422
    state = client.get("/api/planning/state?part=AI").json()
    assert next(s for s in state["setlists"] if s["event_id"] == WRO)["song_ids"] == order
    assert state["upcoming"][0]["not_ready"] == ["song-p", "song-r"]
    reset = client.post("/api/planning/setlist", json={"event_id": WRO, "song_ids": None}).json()
    assert reset["custom"] is False and reset["song_ids"] == ["song-a", "song-z", "song-p"]
    assert client.post("/api/planning/date", json={"event_id": WRO, "date": None}).json()["date"] is None


def test_calendar_extracts_candidates_without_confirming(client, monkeypatch):
    add_calendar_record()
    calls = []

    async def fake_download(file):
        calls.append(file["id"])
        target = store.CACHE / f"{file['id']}.pdf"
        make_calendar(target)
        return target
    monkeypatch.setattr(drive, "download", fake_download)
    response = client.post("/api/planning/calendar")
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["downloaded"] is True and result["confirmed"] is False and calls == [CAL]
    pdf = [c for c in result["candidates"] if c["source"] == "pdf"]
    by_date = {c["date"]: c for c in pdf}
    assert set(by_date) == {"2026-11-07", "2026-11-08", "2026-11-13", "2027-01-17", "2027-05-12"}
    assert by_date["2026-11-07"]["event_id"] == PIL and "Pilawie" in by_date["2026-11-07"]["excerpt"]
    assert by_date["2026-11-08"]["event_id"] == WRO
    assert by_date["2026-11-13"]["end_date"] == "2026-11-14" and by_date["2026-11-13"]["event_id"] == POZ
    assert by_date["2027-01-17"]["event_id"] is None and by_date["2027-01-17"]["year_inferred"] is True
    assert any(c["source"] == "folder" and c["event_id"] == WRO for c in result["candidates"])
    state = client.get("/api/planning/state?part=AI").json()
    assert state["dates"] == [] and state["calendar"]["candidates"] == result["candidates"]
    again = client.post("/api/planning/calendar").json()
    assert again["downloaded"] is False and calls == [CAL]
    candidate = by_date["2026-11-08"]
    confirmed = client.post("/api/planning/date", json={"event_id": WRO, "date": candidate["date"],
                                                        "source": "calendar", "excerpt": candidate["excerpt"]})
    assert confirmed.json()["source"] == "calendar"
    assert client.get("/api/planning/state?part=AI").json()["dates"][0]["excerpt"] == candidate["excerpt"]


def test_calendar_errors_are_explicit(client, monkeypatch):
    missing = client.post("/api/planning/calendar")
    assert missing.status_code == 404 and "kalendarza" in missing.json()["detail"]
    add_calendar_record()

    async def denied(file):
        raise DriveError("Brak dostępu Google Drive")
    monkeypatch.setattr(drive, "download", denied)
    response = client.post("/api/planning/calendar")
    assert response.status_code == 409 and "Brak dostępu" in response.json()["detail"]

    async def offline(file):
        raise httpx.ConnectError("offline")
    monkeypatch.setattr(drive, "download", offline)
    assert client.post("/api/planning/calendar").status_code == 502
    store.CACHE.mkdir(parents=True, exist_ok=True)
    (store.CACHE / f"{CAL}.pdf").write_bytes(b"not a pdf")
    broken = client.post("/api/planning/calendar")
    assert broken.status_code == 422 and "PDF" in broken.json()["detail"]
    pdf = pymupdf.open()
    pdf.new_page()
    pdf.save(store.CACHE / f"{CAL}.pdf")
    pdf.close()
    empty = client.post("/api/planning/calendar")
    assert empty.status_code == 422 and "ręcznie" in empty.json()["detail"]


def test_capture_changes_baseline_and_ack(client):
    after = [file_row("aaaaaaaaaaaa", "A - Arka.m4a", "song-a", WRO, "2026-10-01T00:00:00Z")]
    assert planning.capture_changes([], after) == 0
    before = after + [file_row("bbbbbbbbbbbb", "Rota.pdf", "song-r", WRO, None, 100, "pdf"),
                      file_row("cccccccccccc", "S - Rota.m4a", "song-r", WRO, "2026-10-01T00:00:00Z")]
    after = [file_row("aaaaaaaaaaaa", "A - Arka.m4a", "song-a", WRO, "2026-10-05T00:00:00Z"),
             file_row("bbbbbbbbbbbb", "Rota.pdf", "song-r", WRO, None, 120, "pdf"),
             file_row("cccccccccccc", "S - Rota.m4a", "song-r", WRO, "2026-10-01T00:00:00Z"),
             file_row("dddddddddddd", "A - Rota wolniej.m4a", "song-r", WRO, "2026-10-06T00:00:00Z", part="A"),
             file_row("local-123456", "local.musicxml", "song-r", None, None, 5, "musicxml"),
             file_row("omr-12345678", "omr.mxl", "song-r", None, None, 5, "musicxml")]
    assert planning.capture_changes(before, after) == 3
    assert planning.capture_changes(after, after) == 0
    assert planning.capture_changes(after, [after[3] | {"modified": "2026-10-07T00:00:00Z"}]) == 1
    changes = client.get("/api/planning/state?part=AI").json()["changes"]
    assert sorted((c["file_id"], c["change"]) for c in changes) == [
        ("aaaaaaaaaaaa", "modified"), ("bbbbbbbbbbbb", "modified"), ("dddddddddddd", "new")]
    first = next(c for c in changes if c["file_id"] == "dddddddddddd")
    assert first["song_name"] == "Rota" and first["event_name"].startswith("8.11")
    assert client.post("/api/planning/changes/ack", json={"ids": [first["id"]]}).json() == {"acknowledged": 1}
    assert len(client.get("/api/planning/state?part=AI").json()["changes"]) == 2
    assert client.post("/api/planning/changes/ack", json={}).json() == {"acknowledged": 2}
    assert client.get("/api/planning/state?part=AI").json()["changes"] == []


def test_find_dates_variants():
    base = date(2026, 10, 31)
    found = planning.find_dates("8.11.2026, 23 maja, 6.XII, 19.30, 31.02", None, base)
    assert [f["date"] for f in found] == ["2026-11-08", "2026-12-06", "2027-05-23"]
    assert found[0]["year_inferred"] is False and found[1]["year_inferred"] is True

def test_changes_ack_validation(client):
    planning.capture_changes([file_row("aaaaaaaaaaaa", "A.m4a", "song-a", WRO, "2026-10-01")],
                             [file_row("aaaaaaaaaaaa", "A.m4a", "song-a", WRO, "2026-10-01"),
                              file_row("eeeeeeeeeeee", "B - Arka.m4a", "song-a", WRO, "2026-10-02")])
    change_id = client.get("/api/planning/state?part=AI").json()["changes"][0]["id"]
    for bad in ({"ids": ["abc"]}, {"ids": "1"}, {"ids": list(range(1001))}, {"ids": [None]}):
        assert client.post("/api/planning/changes/ack", json=bad).status_code == 422
    assert client.post("/api/planning/changes/ack", json={"ids": []}).json() == {"acknowledged": 0}
    assert client.post("/api/planning/changes/ack", json={"ids": [change_id + 999]}).json() == {"acknowledged": 0}
    assert len(client.get("/api/planning/state?part=AI").json()["changes"]) == 1
    assert client.post("/api/planning/changes/ack", json={"ids": [change_id]}).json() == {"acknowledged": 1}
    assert client.post("/api/planning/changes/ack", json={"ids": [change_id]}).json() == {"acknowledged": 0}
    planning.capture_changes([file_row("eeeeeeeeeeee", "B - Arka.m4a", "song-a", WRO, "2026-10-02")],
                             [file_row("eeeeeeeeeeee", "B - Arka.m4a", "song-a", WRO, "2026-10-09")])
    fresh = client.get("/api/planning/state?part=AI").json()["changes"]
    assert [(c["change"], c["id"] > change_id) for c in fresh] == [("modified", True)]