"""Only GET requests to Drive. OAuth tokens live in memory, never on disk."""
import asyncio
import hashlib
import mimetypes
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse

import httpx
from bs4 import BeautifulSoup

from .parser import normalize_song, parse_filename
from .store import CACHE, database, set_setting

ROOT_ID = os.getenv("JANKO_DRIVE_ROOT_ID", "1fESe16CVAh9JBpNKw2_ucmKPAn7NbPtQ")
FOLDER_MIME = "application/vnd.google-apps.folder"
DOC_MIME = "application/vnd.google-apps.document"
ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{10,120}$")
MAX_FILE = 150 * 1024 * 1024


class DriveError(Exception):
    pass


def valid_id(value: str) -> str:
    if not ID_PATTERN.fullmatch(value):
        raise DriveError("Nieprawidłowy identyfikator pliku lub folderu Google Drive.")
    return value


@dataclass
class Entry:
    id: str
    name: str
    mime: str
    modified: str | None = None
    size: int | None = None


class Drive:
    def __init__(self):
        self._token: str | None = None
        self.sync_lock = asyncio.Lock()
        self.download_locks: dict[str, asyncio.Lock] = {}
        self.progress = {"running": False, "message": "", "warnings": [], "folders": 0, "files": 0}

    @property
    def token(self) -> str | None:
        from .security import hosted, drive_token
        return drive_token.get() if hosted() else self._token

    @token.setter
    def token(self, value: str | None):
        self._token = value

    async def connect(self, token: str):
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get("https://www.googleapis.com/oauth2/v1/tokeninfo", params={"access_token": token})
            if response.status_code != 200:
                raise DriveError("Token Google wygasł lub jest nieprawidłowy. Zaloguj się ponownie.")
            info = response.json()
            scopes = info.get("scope", "").split()
            readonly = "https://www.googleapis.com/auth/drive.readonly"
            if readonly not in scopes or any(s.startswith("https://www.googleapis.com/auth/drive") and s != readonly for s in scopes):
                raise DriveError("Akceptujemy tylko uprawnienie drive.readonly, bez uprawnień zapisu.")
            self.token = token

    async def listing(self, client: httpx.AsyncClient, folder: str) -> list[Entry]:
        valid_id(folder)
        if self.token:
            entries = []
            page = None
            while True:
                params = {"q": f"'{folder}' in parents and trashed = false",
                          "fields": "nextPageToken,files(id,name,mimeType,modifiedTime,size,shortcutDetails)",
                          "pageSize": 1000}
                if page:
                    params["pageToken"] = page
                response = await client.get("https://www.googleapis.com/drive/v3/files", params=params,
                                            headers={"Authorization": f"Bearer {self.token}"})
                self.check(response)
                payload = response.json()
                for item in payload.get("files", []):
                    shortcut = item.get("shortcutDetails")
                    entries.append(Entry(shortcut["targetId"] if shortcut else item["id"], item["name"],
                                         shortcut["targetMimeType"] if shortcut else item["mimeType"],
                                         item.get("modifiedTime"), int(item["size"]) if item.get("size") else None))
                page = payload.get("nextPageToken")
                if not page:
                    return entries
        response = await client.get("https://drive.google.com/embeddedfolderview", params={"id": folder})
        self.check(response)
        soup = BeautifulSoup(response.text, "html.parser")
        if soup.select_one('form[action*="accounts.google"]') or "ServiceLogin" in str(response.url):
            raise DriveError("Folder wymaga zalogowania do Google (tylko odczyt).")
        entries = []
        for item in soup.select(".flip-entry"):
            anchor = item.select_one("a")
            title = item.select_one(".flip-entry-title")
            if not anchor or not title:
                continue
            href = anchor.get("href", "")
            found = re.search(r"/(?:folders|d)/([A-Za-z0-9_-]+)", href)
            entry_id = found[1] if found else parse_qs(urlparse(href).query).get("id", [None])[0]
            if not entry_id:
                continue
            name = title.get_text(" ", strip=True)
            mime = FOLDER_MIME if "/folders/" in href else DOC_MIME if "docs.google.com/document" in href else mimetypes.guess_type(name)[0] or "application/octet-stream"
            entries.append(Entry(valid_id(entry_id), name, mime))
        if not entries and not soup.select_one(".flip-entries"):
            raise DriveError("Google nie udostępnił listy folderu. Spróbuj logowania tylko do odczytu.")
        return entries

    @staticmethod
    def check(response: httpx.Response):
        if response.status_code in (401, 403):
            raise DriveError("Brak dostępu Google Drive lub wygasła sesja. Zaloguj się ponownie (tylko odczyt).")
        if response.status_code >= 400:
            raise DriveError(f"Google Drive zwrócił błąd HTTP {response.status_code}.")

    async def sync(self, root: str, event_id: str | None = None):
        if self.sync_lock.locked():
            raise DriveError("Synchronizacja już trwa.")
        async with self.sync_lock:
            self.progress = {"running": True, "message": "Czytanie folderów Google Drive…",
                             "warnings": [], "folders": 0, "files": 0}
            staged_events, staged_songs, staged_links, staged_files = {}, {}, [], {}
            complete_events = set()
            warnings = self.progress["warnings"]
            visited = set()

            def add_file(entry: Entry, song: str | None, event: str | None, section=""):
                parsed = parse_filename(entry.name)
                kind = "document" if entry.mime == DOC_MIME else parsed["kind"]
                staged_files[entry.id] = (entry.id, song, event, entry.name, entry.mime, kind,
                    parsed["part"], int(parsed["slow"]), int(parsed["full"]), section, entry.modified, entry.size)
                self.progress["files"] = len(staged_files)

            async with httpx.AsyncClient(timeout=40, follow_redirects=True) as client:
                async def read_folder(folder: str) -> list[Entry] | None:
                    if folder in visited:
                        return None
                    if len(visited) >= 1000:
                        raise DriveError("Limit 1000 folderów. Wybierz pojedyncze wydarzenie.")
                    visited.add(folder)
                    self.progress["folders"] = len(visited)
                    try:
                        rows = await self.listing(client, folder)
                        if not rows:
                            warnings.append(f"Folder {folder}: pusty lub niedostępny anonimowo.")
                        return rows
                    except (DriveError, httpx.HTTPError) as exc:
                        warnings.append(f"Folder {folder}: {exc}")
                        return None

                async def materials(folder: Entry, song_id: str, event: str, section="", depth=0):
                    if depth > 8:
                        warnings.append(f"{folder.name}: przekroczono głębokość folderów.")
                        return
                    rows = await read_folder(folder.id)
                    if rows is None:
                        return
                    for row in rows:
                        if row.mime == FOLDER_MIME:
                            await materials(row, song_id, event, f"{section} / {row.name}".strip(" /"), depth + 1)
                        else:
                            add_file(row, song_id, event, section)

                async def event(folder: Entry):
                    warning_count = len(warnings)
                    self.progress["message"] = folder.name
                    rows = await read_folder(folder.id)
                    if rows is None:
                        return
                    staged_events[folder.id] = folder.name
                    for row in rows:
                        if row.mime == FOLDER_MIME:
                            song_id = hashlib.sha256(normalize_song(row.name).encode()).hexdigest()[:20]
                            staged_songs[song_id] = row.name.strip()
                            staged_links.append((folder.id, song_id, row.id))
                            await materials(row, song_id, folder.id)
                        else:
                            add_file(row, None, folder.id)
                    if len(warnings) == warning_count:
                        complete_events.add(folder.id)

                try:
                    roots = await self.listing(client, valid_id(root))
                    if event_id:
                        target = next((item for item in roots if item.id == event_id), None)
                        if not target:
                            # Seasons may wrap events one level deeper.
                            for parent in roots:
                                if parent.mime == FOLDER_MIME:
                                    children = await read_folder(parent.id)
                                    target = next((item for item in children or [] if item.id == event_id), None)
                                    if target:
                                        break
                        if not target:
                            raise DriveError("Nie znaleziono wybranego wydarzenia w folderze głównym.")
                        await event(target)
                    else:
                        for row in roots:
                            if row.mime != FOLDER_MIME:
                                add_file(row, None, None)
                                continue
                            if re.search(r"(20\d\d|sezon)", row.name, re.I):
                                children = await read_folder(row.id)
                                for child in children or []:
                                    if child.mime == FOLDER_MIME:
                                        await event(child)
                                    else:
                                        add_file(child, None, row.id)
                            else:
                                await event(row)
                    if not staged_events and not staged_files:
                        raise DriveError("Nie odczytano żadnych materiałów. Poprzednia biblioteka pozostaje bez zmian.")
                    with database() as db:
                        for complete in complete_events:
                            current_files = [key for key, value in staged_files.items() if value[2] == complete]
                            placeholders = ",".join("?" for _ in current_files)
                            clause = f"AND id NOT IN ({placeholders})" if current_files else ""
                            db.execute(f"DELETE FROM files WHERE event_id=? AND id NOT LIKE 'local-%' AND id NOT LIKE 'omr-%' {clause}",
                                       (complete, *current_files))
                            db.execute("DELETE FROM event_songs WHERE event_id=?", (complete,))
                        db.executemany("INSERT OR REPLACE INTO events VALUES (?,?)", staged_events.items())
                        db.executemany("INSERT OR REPLACE INTO songs VALUES (?,?)", staged_songs.items())
                        db.executemany("INSERT OR REPLACE INTO event_songs VALUES (?,?,?)", staged_links)
                        for file_id, values in staged_files.items():
                            previous = db.execute("SELECT modified FROM files WHERE id=?", (file_id,)).fetchone()
                            if previous and values[10] and previous["modified"] != values[10]:
                                for cached in CACHE.glob(f"{file_id}.*"):
                                    cached.unlink()
                            db.execute("INSERT OR REPLACE INTO files VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", values)
                    set_setting("last_sync", datetime.now(timezone.utc).isoformat())
                    return {"events": len(staged_events), "songs": len(staged_songs), "files": len(staged_files),
                            "warnings": warnings, "mode": "oauth" if self.token else "public"}
                finally:
                    self.progress["running"] = False

    async def download(self, file: dict):
        file_id = valid_id(file["id"])
        suffix = ".txt" if file["mime"] == DOC_MIME else "." + file["name"].rsplit(".", 1)[-1].lower()
        if not re.fullmatch(r"\.[a-z0-9]{1,12}", suffix):
            suffix = ".bin"
        target = CACHE / f"{file_id}{suffix}"
        lock = self.download_locks.setdefault(file_id, asyncio.Lock())
        async with lock:
            if target.exists():
                return target
            if file.get("size") and file["size"] > MAX_FILE:
                raise DriveError("Plik przekracza limit pamięci podręcznej 150 MB.")
            headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
            if self.token:
                url = f"https://www.googleapis.com/drive/v3/files/{file_id}"
                params = {"alt": "media"}
                if file["mime"] == DOC_MIME:
                    url += "/export"
                    params = {"mimeType": "text/plain"}
            elif file["mime"] == DOC_MIME:
                url, params = f"https://docs.google.com/document/d/{file_id}/export", {"format": "txt"}
            else:
                url, params = "https://drive.google.com/uc", {"export": "download", "id": file_id}
            temp = target.with_suffix(target.suffix + ".part")
            try:
                async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
                    async with client.stream("GET", url, params=params, headers=headers) as response:
                        self.check(response)
                        if "text/html" in response.headers.get("content-type", ""):
                            raise DriveError("Google nie udostępnił pliku (ekran logowania lub limit pobierania). Zaloguj się tylko do odczytu.")
                        total = 0
                        with temp.open("wb") as output:
                            async for chunk in response.aiter_bytes():
                                total += len(chunk)
                                if total > MAX_FILE:
                                    raise DriveError("Plik przekracza limit 150 MB.")
                                output.write(chunk)
                if not total:
                    raise DriveError("Google zwrócił pusty plik.")
                temp.replace(target)
                return target
            finally:
                temp.unlink(missing_ok=True)


drive = Drive()
