import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("JANKO_DATA", ROOT / "data"))
CACHE = DATA / "cache"
GENERATED = DATA / "generated"


@contextmanager
def database():
    DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = DATA / "library.sqlite3"
    conn = sqlite3.connect(path, timeout=30)
    path.chmod(0o600)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def initialize():
    CACHE.mkdir(parents=True, exist_ok=True)
    GENERATED.mkdir(parents=True, exist_ok=True)
    with database() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,name TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS songs(id TEXT PRIMARY KEY,name TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS event_songs(event_id TEXT NOT NULL,song_id TEXT NOT NULL,
          folder_id TEXT NOT NULL,PRIMARY KEY(event_id,folder_id));
        CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY,song_id TEXT,event_id TEXT,
          name TEXT NOT NULL,mime TEXT,kind TEXT,part TEXT,slow INTEGER,full INTEGER,
          section TEXT NOT NULL DEFAULT '',modified TEXT,size INTEGER);
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
        """)


def setting(key: str) -> str | None:
    with database() as db:
        row = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return row["value"] if row else None


def set_setting(key: str, value: str):
    with database() as db:
        db.execute("INSERT OR REPLACE INTO settings VALUES (?,?)", (key, value))
