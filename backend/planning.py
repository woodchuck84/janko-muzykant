"""Phase 4 planning: progress, practice time, event dates, setlists and Drive change notes.

Everything is stored locally in SQLite. Google Drive is only read (cached download of the
calendar PDF); nothing is ever written back to Drive.
"""
import hashlib
import json
import logging
import re
import unicodedata
from collections.abc import Iterable, Mapping
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from . import store
from .drive import DOC_MIME, DriveError, drive
from .parser import normalize_song
from .security import user_id

log = logging.getLogger("janko.planning")
router = APIRouter(prefix="/api/planning", tags=["planning"])

PART_PATTERN = r"^(SI|SII|AI|AII|B)$"
STATUSES = ("listened", "with-score", "memory", "concert")
MAX_SESSION = 4 * 3600
MAX_DAY = 16 * 3600
LOCAL_PREFIXES = ("local-", "omr-")
CALENDAR_NAME = re.compile(r"kalendar|calendar|harmonogram|terminarz", re.I)
ORDER_NOTE = "Kolejność alfabetyczna — kolejność dyrygenta nie jest znana. Ułóż utwory samodzielnie."


def today() -> date:
    return date.today()


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def initialize_planning():
    with store.database() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS planning_progress(song_id TEXT NOT NULL,part TEXT NOT NULL,
          status TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(song_id,part));
        CREATE TABLE IF NOT EXISTS planning_sessions(id INTEGER PRIMARY KEY AUTOINCREMENT,
          song_id TEXT NOT NULL,part TEXT NOT NULL,seconds INTEGER NOT NULL,day TEXT NOT NULL,
          created_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS planning_sessions_day ON planning_sessions(day);
        CREATE TABLE IF NOT EXISTS planning_dates(event_id TEXT PRIMARY KEY,date TEXT NOT NULL,
          source TEXT NOT NULL,excerpt TEXT,confirmed_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS planning_setlists(event_id TEXT PRIMARY KEY,song_ids TEXT NOT NULL,
          updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS planning_changes(id INTEGER PRIMARY KEY AUTOINCREMENT,
          file_id TEXT NOT NULL,name TEXT NOT NULL,change TEXT NOT NULL,song_id TEXT,event_id TEXT,
          kind TEXT,part TEXT,slow INTEGER NOT NULL DEFAULT 0,detected_at TEXT NOT NULL,
          acknowledged INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS planning_calendar(file_id TEXT PRIMARY KEY,name TEXT NOT NULL,
          modified TEXT,extracted_at TEXT NOT NULL,pages INTEGER NOT NULL,candidates TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS planning_seen(
          user_id TEXT NOT NULL,change_id INTEGER NOT NULL,PRIMARY KEY(user_id,change_id));
        """)
        # Existing personal data remains owned by local mode, never by the first hosted visitor.
        for table, columns, key in (
            ("planning_progress", "song_id,part,status,updated_at", "song_id,part"),
            ("planning_setlists", "event_id,song_ids,updated_at", "event_id"),
        ):
            if "user_id" not in {row["name"] for row in db.execute(f"PRAGMA table_info({table})")}:
                db.execute(f"ALTER TABLE {table} RENAME TO {table}_legacy")
                if table == "planning_progress":
                    db.execute(f"CREATE TABLE {table}(song_id TEXT NOT NULL,part TEXT NOT NULL,status TEXT NOT NULL,updated_at TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(user_id,{key}))")
                else:
                    db.execute(f"CREATE TABLE {table}(event_id TEXT NOT NULL,song_ids TEXT NOT NULL,updated_at TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(user_id,{key}))")
                db.execute(f"INSERT INTO {table} SELECT {columns},'local' FROM {table}_legacy")
                db.execute(f"DROP TABLE {table}_legacy")
        if "user_id" not in {row["name"] for row in db.execute("PRAGMA table_info(planning_sessions)")}:
            db.execute("ALTER TABLE planning_sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local'")
        db.execute("INSERT OR IGNORE INTO planning_seen SELECT 'local',id FROM planning_changes WHERE acknowledged=1")


# ---------------------------------------------------------------- Drive change notes

def _value(row: Mapping, key: str):
    try:
        return row[key]
    except (KeyError, IndexError):
        return None


def capture_changes(before: Iterable[Mapping], after: Iterable[Mapping]) -> int:
    """Record new/modified remote files between two `files` table snapshots.

    An empty `before` snapshot is the initial baseline and records nothing. Local imports and
    OMR results are ignored. Returns the number of recorded change notes.
    """
    previous = {str(_value(row, "id")): row for row in before if _value(row, "id")}
    if not previous:
        return 0
    recorded = 0
    with store.database() as db:
        for row in after:
            file_id = str(_value(row, "id") or "")
            if not file_id or file_id.startswith(LOCAL_PREFIXES):
                continue
            old = previous.get(file_id)
            if old is None:
                change = "new"
            else:
                old_mod, new_mod = _value(old, "modified"), _value(row, "modified")
                old_size, new_size = _value(old, "size"), _value(row, "size")
                if old_mod and new_mod and old_mod != new_mod:
                    change = "modified"
                elif not old_mod and not new_mod and old_size is not None and new_size is not None and old_size != new_size:
                    change = "modified"
                else:
                    continue
            values = (str(_value(row, "name") or file_id), _value(row, "song_id"), _value(row, "event_id"),
                      _value(row, "kind"), _value(row, "part"), int(bool(_value(row, "slow"))), now())
            pending = db.execute("""SELECT id,change FROM planning_changes WHERE file_id=? AND acknowledged=0
                                 AND NOT EXISTS(SELECT 1 FROM planning_seen WHERE change_id=planning_changes.id)""",
                                 (file_id,)).fetchone()
            if pending:
                db.execute("UPDATE planning_changes SET name=?,song_id=?,event_id=?,kind=?,part=?,slow=?,detected_at=?,change=? WHERE id=?",
                           (*values, "new" if pending["change"] == "new" else change, pending["id"]))
            else:
                db.execute("INSERT INTO planning_changes(name,song_id,event_id,kind,part,slow,detected_at,file_id,change) VALUES (?,?,?,?,?,?,?,?,?)",
                           (*values, file_id, change))
            recorded += 1
    return recorded


# ---------------------------------------------------------------- calendar parsing

MONTH_STEMS = (("stycz", 1), ("lut", 2), ("marz", 3), ("marc", 3), ("kwie", 4), ("maj", 5), ("czerw", 6),
               ("lip", 7), ("sierp", 8), ("wrze", 9), ("pazdz", 10), ("listop", 11), ("grud", 12))
ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8, "IX": 9, "X": 10, "XI": 11, "XII": 12}
NUMERIC_DATE = re.compile(
    r"(?<![\d.,:/])(?P<d1>\d{1,2})(?:\s*[-–—]\s*(?P<d2>\d{1,2}))?\s*[./]\s*"
    r"(?P<m>1[0-2]|0?[1-9]|XII|XI|IX|X|VIII|VII|VI|IV|V|III|II|I)(?![\dA-Za-z])"
    r"(?:\s*[./]\s*(?P<y>20\d\d|\d\d)(?!\d))?")
TEXT_DATE = re.compile(
    r"(?<!\d)(?P<d1>\d{1,2})(?:\s*[-–—]\s*(?P<d2>\d{1,2}))?\s+(?P<mn>[^\W\d_]{3,})\.?(?:\s+(?P<y>20\d\d)(?!\d))?")
STOPWORDS = {"koncert", "koncertu", "chor", "choru", "chorow", "oraz", "godz", "godzina", "sezon", "repertuar",
             "kalendarz", "niepodleglosciowy", "niepodleglosciowe", "proba", "proby"}


def _fold(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.casefold().replace("ł", "l"))
    return "".join(c for c in text if not unicodedata.combining(c))


def _month_from_name(word: str) -> int | None:
    folded = _fold(word)
    return next((month for stem, month in MONTH_STEMS if folded.startswith(stem)), None)


def _season(name: str) -> tuple[int, int] | None:
    found = re.search(r"(20\d\d)\s*[_/–—-]\s*(20\d\d)", name)
    if found and int(found[2]) == int(found[1]) + 1:
        return int(found[1]), int(found[2])
    return None


def _resolve_year(month: int, day: int, explicit: str | None, season: tuple[int, int] | None, base: date):
    if explicit:
        return (int(explicit) + 2000 if len(explicit) == 2 else int(explicit)), False
    if season:
        return (season[0] if month >= 8 else season[1]), True
    year = base.year
    try:
        if date(year, month, day) < base - timedelta(days=60):
            year += 1
    except ValueError:
        pass
    return year, True


def find_dates(text: str, season: tuple[int, int] | None, base: date) -> list[dict]:
    """Return date mentions in one line of text. Invalid day/month combinations are skipped."""
    found, taken = [], []
    for pattern in (NUMERIC_DATE, TEXT_DATE):
        for match in pattern.finditer(text):
            if any(start < match.end() and match.start() < end for start, end in taken):
                continue
            if pattern is NUMERIC_DATE:
                token = match["m"]
                month = ROMAN.get(token.upper()) if token.isalpha() else int(token)
            else:
                month = _month_from_name(match["mn"])
            if not month:
                continue
            day = int(match["d1"])
            year, inferred = _resolve_year(month, day, match["y"], season, base)
            try:
                start = date(year, month, day)
                end = date(year, month, int(match["d2"])) if match["d2"] else None
            except ValueError:
                continue
            if end and end <= start:
                continue
            taken.append((match.start(), match.end()))
            found.append({"date": start.isoformat(), "end_date": end.isoformat() if end else None,
                          "year_inferred": inferred, "match": match[0].strip()})
    return found


def _stems(text: str) -> set[str]:
    words = re.findall(r"[a-z]{4,}", _fold(text))
    return {word[:5] for word in words if word not in STOPWORDS}


def _match_event(candidate: dict, line: str, events: list[dict], season, base) -> tuple[str | None, str]:
    day_month = candidate["date"][5:]
    stems = _stems(line)
    scores = []
    for event in events:
        score, reasons = 0, []
        named = find_dates(event["name"], season, base)
        if any(item["date"][5:] == day_month for item in named):
            score += 3
            reasons.append("ta sama data w nazwie folderu")
        overlap = sorted(stems & _stems(event["name"]))
        if overlap:
            score += len(overlap)
            reasons.append("wspólne słowa: " + ", ".join(overlap))
        scores.append((score, event["id"], "; ".join(reasons)))
    scores.sort(reverse=True)
    if scores and scores[0][0] >= 2 and (len(scores) == 1 or scores[1][0] < scores[0][0]):
        return scores[0][1], scores[0][2]
    return None, ""


def extract_candidates(pages: list[str], file_name: str, events: list[dict], base: date | None = None) -> list[dict]:
    base = base or today()
    season = _season(file_name)
    candidates, seen = [], set()

    def add(source: str, page: int | None, line: str, excerpt: str, item: dict):
        key = (source, item["date"], item["end_date"], _fold(line))
        if key in seen:
            return
        seen.add(key)
        event_id, reason = _match_event(item, line, events, season, base)
        digest = hashlib.sha1(repr(key).encode()).hexdigest()[:16]
        candidates.append({"id": digest, "source": source, "page": page, "date": item["date"],
                           "end_date": item["end_date"], "year_inferred": item["year_inferred"],
                           "match": item["match"], "excerpt": excerpt[:320],
                           "event_id": event_id, "match_reason": reason})

    for number, text in enumerate(pages, start=1):
        lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
        lines = [line for line in lines if line]
        for index, line in enumerate(lines):
            for item in find_dates(line, season, base):
                excerpt = " · ".join(lines[max(0, index - 1): index + 2])
                add("pdf", number, line, excerpt, item)
    for event in events:
        for item in find_dates(event["name"], season, base):
            add("folder", None, event["name"], f"Nazwa folderu wydarzenia: {event['name']}", item)
    candidates.sort(key=lambda c: (c["date"], c["source"] != "pdf"))
    return candidates


def _calendar_file() -> dict:
    with store.database() as db:
        rows = [dict(row) for row in db.execute(
            "SELECT * FROM files WHERE song_id IS NULL AND kind='pdf' ORDER BY event_id IS NOT NULL, name DESC")]
    matches = [row for row in rows if CALENDAR_NAME.search(row["name"])]
    if not matches:
        raise HTTPException(404, "Nie znaleziono PDF kalendarza w folderze głównym biblioteki. "
                                 "Zsynchronizuj Google Drive (tylko odczyt) i spróbuj ponownie.")
    return matches[0]


def _cached_pdf(file: dict) -> Path | None:
    suffix = ".txt" if file["mime"] == DOC_MIME else Path(file["name"]).suffix.lower()
    path = store.CACHE / f"{file['id']}{suffix}"
    return path if path.is_file() else None


def _read_pdf(path: Path) -> list[str]:
    import pymupdf
    try:
        with pymupdf.open(path) as document:
            if document.needs_pass:
                raise HTTPException(422, "PDF kalendarza jest zabezpieczony hasłem — nie można odczytać tekstu.")
            return [page.get_text() for page in document]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(422, f"Nie można odczytać PDF kalendarza: {exc}") from exc


# ---------------------------------------------------------------- helpers

def _event_names(db) -> dict[str, str]:
    return {row["id"]: row["name"] for row in db.execute("SELECT id,name FROM events")}


def _require(db, table: str, key: str, message: str):
    if not db.execute(f"SELECT 1 FROM {table} WHERE id=?", (key,)).fetchone():
        raise HTTPException(404, message)


def _sort_key(name: str):
    return (_fold(name), name)


def _setlists(db) -> list[dict]:
    songs = {row["id"]: row["name"] for row in db.execute("SELECT id,name FROM songs")}
    members: dict[str, list[str]] = {}
    for row in db.execute("SELECT DISTINCT event_id,song_id FROM event_songs"):
        if row["song_id"] in songs:
            members.setdefault(row["event_id"], []).append(row["song_id"])
    stored = {row["event_id"]: row for row in db.execute("SELECT * FROM planning_setlists WHERE user_id=?", (user_id(),))}
    result = []
    for event in db.execute("SELECT id FROM events ORDER BY name"):
        event_id = event["id"]
        default = sorted(set(members.get(event_id, [])), key=lambda song: _sort_key(songs[song]))
        saved = stored.get(event_id)
        if saved:
            ids = [song for song in json.loads(saved["song_ids"]) if song in songs]
            result.append({"event_id": event_id, "song_ids": ids, "custom": True, "order_note": None,
                           "updated_at": saved["updated_at"],
                           "unlisted_song_ids": [song for song in default if song not in ids]})
        else:
            result.append({"event_id": event_id, "song_ids": default, "custom": False, "order_note": ORDER_NOTE,
                           "updated_at": None, "unlisted_song_ids": []})
    return result


def _practice(db, part: str, base: date) -> dict:
    days = {row["day"]: row["seconds"] for row in db.execute(
        "SELECT day,SUM(seconds) AS seconds FROM planning_sessions WHERE user_id=? GROUP BY day", (user_id(),))}
    streak, cursor = 0, base if days.get(base.isoformat()) else base - timedelta(days=1)
    while days.get(cursor.isoformat()):
        streak += 1
        cursor -= timedelta(days=1)
    by_song = {row["song_id"]: row["seconds"] for row in db.execute(
        "SELECT song_id,SUM(seconds) AS seconds FROM planning_sessions WHERE part=? AND user_id=? GROUP BY song_id", (part, user_id()))}
    recent = [dict(row) for row in db.execute(
        "SELECT id,song_id,part,seconds,day,created_at FROM planning_sessions WHERE user_id=? ORDER BY id DESC LIMIT 20", (user_id(),))]
    return {"today_seconds": days.get(base.isoformat(), 0), "streak_days": streak,
            "total_seconds": sum(days.values()),
            "last_days": [{"day": (base - timedelta(days=offset)).isoformat(),
                           "seconds": days.get((base - timedelta(days=offset)).isoformat(), 0)}
                          for offset in range(13, -1, -1)],
            "by_song": by_song, "recent": recent}


# ---------------------------------------------------------------- API

@router.get("/state")
def state(part: str = Query("AI", pattern=PART_PATTERN)):
    base = today()
    with store.database() as db:
        names = _event_names(db)
        statuses = [dict(row) for row in db.execute(
            "SELECT p.song_id,p.status,p.updated_at FROM planning_progress p JOIN songs s ON s.id=p.song_id WHERE p.part=? AND p.user_id=?",
            (part, user_id()))]
        status_map = {row["song_id"]: row["status"] for row in statuses}
        dates = []
        for row in db.execute("SELECT * FROM planning_dates ORDER BY date"):
            if row["event_id"] not in names:
                continue
            days_until = (date.fromisoformat(row["date"]) - base).days
            dates.append(dict(row) | {"days_until": days_until})
        setlists = _setlists(db)
        by_event = {item["event_id"]: item for item in setlists}
        upcoming = []
        for item in dates:
            if item["days_until"] < 0:
                continue
            song_ids = by_event.get(item["event_id"], {}).get("song_ids", [])
            upcoming.append({"event_id": item["event_id"], "name": names[item["event_id"]], "date": item["date"],
                             "days_until": item["days_until"], "song_count": len(song_ids),
                             "not_ready": [song for song in song_ids if status_map.get(song) != "concert"]})
        changes = [dict(row) | {"slow": bool(row["slow"])} for row in db.execute(
            """SELECT c.id,c.file_id,c.name,c.change,c.song_id,c.event_id,c.kind,c.part,c.slow,c.detected_at,
                      s.name AS song_name,e.name AS event_name
               FROM planning_changes c LEFT JOIN songs s ON s.id=c.song_id LEFT JOIN events e ON e.id=c.event_id
               WHERE NOT EXISTS(SELECT 1 FROM planning_seen WHERE change_id=c.id AND user_id=?)
               ORDER BY c.id DESC LIMIT 200""", (user_id(),))]
        calendar_row = db.execute("SELECT * FROM planning_calendar ORDER BY extracted_at DESC LIMIT 1").fetchone()
        calendar = None
        if calendar_row:
            calendar = {"file_id": calendar_row["file_id"], "name": calendar_row["name"],
                        "extracted_at": calendar_row["extracted_at"], "pages": calendar_row["pages"],
                        "candidates": json.loads(calendar_row["candidates"])}
        practice = _practice(db, part, base)
    return {"part": part, "today": base.isoformat(), "statuses": statuses, "sessions": practice,
            "dates": dates, "upcoming": upcoming, "setlists": setlists, "changes": changes, "calendar": calendar}


class ProgressBody(BaseModel):
    song_id: str = Field(min_length=1, max_length=120)
    part: str = Field(pattern=PART_PATTERN)
    status: Literal["none", "listened", "with-score", "memory", "concert"]


@router.post("/progress")
def progress(body: ProgressBody):
    with store.database() as db:
        _require(db, "songs", body.song_id, "Nie znaleziono utworu.")
        if body.status == "none":
            db.execute("DELETE FROM planning_progress WHERE song_id=? AND part=? AND user_id=?", (body.song_id, body.part, user_id()))
            return {"song_id": body.song_id, "part": body.part, "status": None, "updated_at": None}
        stamp = now()
        db.execute("INSERT OR REPLACE INTO planning_progress VALUES (?,?,?,?,?)",
                   (body.song_id, body.part, body.status, stamp, user_id()))
    return {"song_id": body.song_id, "part": body.part, "status": body.status, "updated_at": stamp}


class SessionBody(BaseModel):
    song_id: str = Field(min_length=1, max_length=120)
    part: str = Field(pattern=PART_PATTERN)
    seconds: int = Field(ge=1, le=MAX_SESSION)


@router.post("/session")
def session(body: SessionBody):
    day = today().isoformat()
    with store.database() as db:
        _require(db, "songs", body.song_id, "Nie znaleziono utworu.")
        total = db.execute("SELECT COALESCE(SUM(seconds),0) AS total FROM planning_sessions WHERE day=? AND user_id=?",
                           (day, user_id())).fetchone()["total"]
        if total + body.seconds > MAX_DAY:
            raise HTTPException(422, "Dzienny limit zapisanego ćwiczenia (16 godzin) zostałby przekroczony. Sprawdź stoper.")
        cursor = db.execute("INSERT INTO planning_sessions(song_id,part,seconds,day,created_at,user_id) VALUES (?,?,?,?,?,?)",
                            (body.song_id, body.part, body.seconds, day, now(), user_id()))
    return {"id": cursor.lastrowid, "day": day, "seconds": body.seconds, "today_seconds": total + body.seconds}


class DateBody(BaseModel):
    event_id: str = Field(min_length=1, max_length=120)
    date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    source: Literal["manual", "calendar", "folder"] = "manual"
    excerpt: str | None = Field(default=None, max_length=600)


@router.post("/date")
def set_date(body: DateBody):
    with store.database() as db:
        _require(db, "events", body.event_id, "Nie znaleziono wydarzenia.")
        if body.date is None:
            db.execute("DELETE FROM planning_dates WHERE event_id=?", (body.event_id,))
            return {"event_id": body.event_id, "date": None}
        try:
            value = date.fromisoformat(body.date)
        except ValueError as exc:
            raise HTTPException(422, "Nieprawidłowa data.") from exc
        if not 2000 <= value.year <= 2100:
            raise HTTPException(422, "Data poza obsługiwanym zakresem.")
        stamp = now()
        db.execute("INSERT OR REPLACE INTO planning_dates VALUES (?,?,?,?,?)",
                   (body.event_id, value.isoformat(), body.source, body.excerpt, stamp))
    return {"event_id": body.event_id, "date": value.isoformat(), "source": body.source,
            "excerpt": body.excerpt, "confirmed_at": stamp, "days_until": (value - today()).days}


class SetlistBody(BaseModel):
    event_id: str = Field(min_length=1, max_length=120)
    song_ids: list[str] | None = Field(default=None, max_length=300)


@router.post("/setlist")
def set_setlist(body: SetlistBody):
    with store.database() as db:
        _require(db, "events", body.event_id, "Nie znaleziono wydarzenia.")
        if body.song_ids is None:
            db.execute("DELETE FROM planning_setlists WHERE event_id=? AND user_id=?", (body.event_id, user_id()))
        else:
            if len(set(body.song_ids)) != len(body.song_ids):
                raise HTTPException(422, "Utwór może wystąpić w programie tylko raz.")
            known = {row["id"] for row in db.execute("SELECT id FROM songs")}
            unknown = [song for song in body.song_ids if song not in known]
            if unknown:
                raise HTTPException(422, f"Nieznane utwory w programie: {', '.join(unknown[:5])}.")
            db.execute("INSERT OR REPLACE INTO planning_setlists VALUES (?,?,?,?)",
                       (body.event_id, json.dumps(body.song_ids), now(), user_id()))
        return next(item for item in _setlists(db) if item["event_id"] == body.event_id)


@router.post("/calendar")
async def calendar():
    file = _calendar_file()
    path = _cached_pdf(file)
    downloaded = False
    if path is None:
        try:
            path = await drive.download(file)
        except DriveError as exc:
            raise HTTPException(409, f"Nie można pobrać kalendarza „{file['name']}”: {exc}") from exc
        except httpx.HTTPError as exc:
            log.warning("Calendar download failed: %s", exc)
            raise HTTPException(502, f"Nie można połączyć się z Google Drive, aby pobrać „{file['name']}”. "
                                     "Kalendarz nie jest jeszcze zapisany lokalnie.") from exc
        downloaded = True
    pages = _read_pdf(Path(path))
    if not any(page.strip() for page in pages):
        raise HTTPException(422, "PDF kalendarza nie zawiera tekstu (prawdopodobnie skan). Wpisz daty ręcznie.")
    with store.database() as db:
        events = [dict(row) for row in db.execute("SELECT id,name FROM events ORDER BY name")]
    candidates = extract_candidates(pages, file["name"], events)
    stamp = now()
    with store.database() as db:
        db.execute("INSERT OR REPLACE INTO planning_calendar VALUES (?,?,?,?,?,?)",
                   (file["id"], file["name"], file["modified"], stamp, len(pages), json.dumps(candidates)))
    return {"file_id": file["id"], "name": file["name"], "downloaded": downloaded, "pages": len(pages),
            "extracted_at": stamp, "candidates": candidates, "confirmed": False}


class AckBody(BaseModel):
    ids: list[int] | None = Field(default=None, max_length=1000)


@router.post("/changes/ack")
def acknowledge(body: AckBody):
    with store.database() as db:
        if body.ids is None:
            cursor = db.execute("INSERT OR IGNORE INTO planning_seen SELECT ?,id FROM planning_changes", (user_id(),))
        elif body.ids:
            marks = ",".join("?" for _ in body.ids)
            cursor = db.execute(f"INSERT OR IGNORE INTO planning_seen SELECT ?,id FROM planning_changes WHERE id IN ({marks})",
                                [user_id(), *body.ids])
        else:
            return {"acknowledged": 0}
    return {"acknowledged": cursor.rowcount}