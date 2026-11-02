import asyncio
import hashlib
import json
import logging
import mimetypes
import os
import shutil
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .drive import DOC_MIME, ROOT_ID, DriveError, drive, valid_id
from .store import CACHE, GENERATED, ROOT, database, initialize, setting
from .planning import router as planning_router, initialize_planning, capture_changes
from . import security

log = logging.getLogger("janko")
score_locks: dict[str, asyncio.Lock] = {}
practice_locks: dict[str, asyncio.Lock] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    initialize()
    initialize_planning()
    security.initialize()
    yield


app = FastAPI(title="Janko Muzykant", lifespan=lifespan)
app.include_router(planning_router)
app.include_router(security.router)
ORIGINS = {"http://127.0.0.1:5173", "http://localhost:5173",
           "http://127.0.0.1:8000", "http://localhost:8000"}
app.add_middleware(CORSMiddleware, allow_origins=list(ORIGINS), allow_methods=["GET", "POST", "DELETE"],
                   allow_headers=["Content-Type"])


@app.middleware("http")
async def local_only(request: Request, call_next):
    if security.hosted():
        response = await security.hosted_request(request, call_next)
        return security.secure_headers(response)
    origin = request.headers.get("origin")
    host = request.headers.get("host", "").split(":")[0]
    if host not in {"127.0.0.1", "localhost", "testserver"}:
        return JSONResponse({"detail": "Aplikacja jest przeznaczona wyłącznie do lokalnego użytku."}, status_code=403)
    if origin and origin not in ORIGINS:
        return JSONResponse({"detail": "Niedozwolone źródło żądania."}, status_code=403)
    return await call_next(request)


@app.exception_handler(DriveError)
async def drive_error(request: Request, exc: DriveError):
    log.warning("Drive operation failed: %s", exc)
    return JSONResponse({"detail": str(exc)}, status_code=409)


@app.exception_handler(httpx.HTTPError)
async def connection_error(request: Request, exc: httpx.HTTPError):
    log.warning("Drive connection failed: %s", exc)
    return JSONResponse({"detail": "Nie można połączyć się z Google Drive. Zapisane pliki nadal działają offline."}, status_code=502)


def file_record(file_id: str) -> dict:
    with database() as db:
        row = db.execute("SELECT * FROM files WHERE id=?", (file_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Nie znaleziono pliku.")
    return dict(row)


def song_exists(song_id: str):
    with database() as db:
        if not db.execute("SELECT 1 FROM songs WHERE id=?", (song_id,)).fetchone():
            raise HTTPException(404, "Nie znaleziono utworu.")


def score_error_detail(exc):
    if not security.hosted():
        return exc.to_dict()
    from .scores import PartSelectionError
    log.warning("Score operation failed (%s): %s", exc.code, exc)
    if isinstance(exc, PartSelectionError):
        return exc.to_dict()
    return {"error": exc.code, "message": "Nie można przetworzyć partytury. Sprawdź plik MusicXML lub poproś administratora o sprawdzenie OMR.",
            "hint": "Szczegóły techniczne są dostępne administratorowi w dzienniku serwera."}


def cache_path(file: dict) -> Path | None:
    suffix = ".txt" if file["mime"] == DOC_MIME else Path(file["name"]).suffix.lower()
    path = CACHE / f"{file['id']}{suffix}"
    return path if path.is_file() else None


def present_file(row) -> dict:
    value = dict(row)
    value["slow"], value["full"] = bool(value["slow"]), bool(value["full"])
    value["cached"] = cache_path(value) is not None
    value["url"] = f"/api/files/{value['id']}"
    value["drive_url"] = None if value["id"].startswith(("local-", "omr-")) else f"https://drive.google.com/file/d/{value['id']}/view"
    return value


@app.get("/api/health")
def health():
    return {"status": "ok", "drive_access": "read-only", "app": "janko-muzykant"}


@app.get("/api/config")
def config():
    return {"root_id": ROOT_ID, "client_id": "" if security.hosted() else os.environ.get("GOOGLE_CLIENT_ID", ""),
            "connected": drive.token is not None, "last_sync": setting("last_sync"),
            "sync": drive.progress}


class TokenBody(BaseModel):
    token: str = Field(min_length=10, max_length=4096)


@app.post("/api/auth")
async def auth(body: TokenBody):
    await drive.connect(body.token)
    return {"connected": True, "scope": "drive.readonly"}


@app.delete("/api/auth")
def disconnect():
    drive.token = None
    return {"connected": False}


class SyncBody(BaseModel):
    root_id: str = ROOT_ID
    event_id: str | None = None


@app.post("/api/sync")
async def sync(body: SyncBody):
    if security.hosted() and body.root_id != ROOT_ID:
        raise HTTPException(403, "W trybie serwerowym można czytać tylko skonfigurowany folder chóru.")
    with database() as db:
        before = [dict(row) for row in db.execute("SELECT * FROM files")]
    result = await drive.sync(valid_id(body.root_id), valid_id(body.event_id) if body.event_id else None)
    with database() as db:
        after = [dict(row) for row in db.execute("SELECT * FROM files")]
    new_materials = capture_changes(before, after)
    return result | {"new_materials": new_materials}


@app.get("/api/library")
def library():
    with database() as db:
        events = [dict(row) for row in db.execute("SELECT * FROM events ORDER BY name")]
        songs = {row["id"]: dict(row) | {"files": [], "event_ids": []}
                 for row in db.execute("SELECT * FROM songs ORDER BY name COLLATE NOCASE")}
        for row in db.execute("SELECT DISTINCT event_id,song_id FROM event_songs"):
            if row["song_id"] in songs:
                songs[row["song_id"]]["event_ids"].append(row["event_id"])
        other = []
        for row in db.execute("SELECT * FROM files ORDER BY section,name"):
            target = songs.get(row["song_id"])
            if target:
                target["files"].append(present_file(row))
            else:
                other.append(present_file(row))
    return {"events": events, "songs": list(songs.values()), "other": other, "last_sync": setting("last_sync")}


@app.get("/api/files/{file_id}")
async def get_file(file_id: str):
    file = file_record(file_id)
    path = cache_path(file)
    if not path:
        if file_id.startswith(("local-", "omr-")):
            raise HTTPException(404, "Lokalny plik został usunięty. Zaimportuj MusicXML ponownie.")
        path = await drive.download(file)
    mime = "text/plain" if file["mime"] == DOC_MIME else mimetypes.guess_type(file["name"])[0] or "application/octet-stream"
    if file["kind"] == "musicxml":
        mime = "application/xml" if path.suffix != ".mxl" else "application/vnd.recordare.musicxml"
    return FileResponse(path, media_type=mime, headers={"Cache-Control": "private, max-age=3600"})


@app.post("/api/songs/{song_id}/cache")
async def cache_song(song_id: str):
    song_exists(song_id)
    with database() as db:
        files = [dict(row) for row in db.execute("SELECT * FROM files WHERE song_id=?", (song_id,))]
    failed, count = [], 0
    for file in files:
        try:
            if cache_path(file) is None:
                if file["id"].startswith(("local-", "omr-")):
                    raise DriveError("Brak lokalnego pliku. Zaimportuj go ponownie.")
                await drive.download(file)
            count += 1
        except (DriveError, httpx.HTTPError) as exc:
            log.warning("Cache failed for %s: %s", file["name"], exc)
            failed.append({"name": file["name"], "error": str(exc)})
    return {"cached": count, "failed": failed}


@app.post("/api/songs/{song_id}/musicxml")
async def import_xml(song_id: str, file: UploadFile = File(...)):
    from .scores import ScoreError, load_score
    song_exists(song_id)
    extension = Path(file.filename or "").suffix.lower()
    if extension not in {".xml", ".musicxml", ".mxl"}:
        raise HTTPException(422, "Wybierz plik MusicXML (.musicxml, .xml lub .mxl).")
    content = await file.read(10 * 1024 * 1024 + 1)
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(413, "MusicXML przekracza 10 MB.")
    file_id = "local-" + hashlib.sha256(song_id.encode() + content).hexdigest()[:24]
    path = CACHE / f"{file_id}{extension}"
    path.write_bytes(content)
    try:
        await asyncio.to_thread(load_score, path)
    except (ScoreError, ValueError) as exc:
        path.unlink(missing_ok=True)
        raise HTTPException(422, score_error_detail(exc) if isinstance(exc, ScoreError) and security.hosted()
                            else "Nieprawidłowy MusicXML." if security.hosted()
                            else f"Nieprawidłowy MusicXML: {exc}") from exc
    with database() as db:
        db.execute("INSERT OR REPLACE INTO files VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                   (file_id, song_id, None, Path(file.filename or "score.musicxml").name, "application/xml",
                    "musicxml", None, 0, 0, "MusicXML lokalny", None, len(content)))
    return {"id": file_id, "url": f"/api/files/{file_id}", "drive_modified": False}


async def _score_source(song_id: str, file_id: str | None):
    song_exists(song_id)
    with database() as db:
        candidates = [dict(row) for row in db.execute(
            "SELECT * FROM files WHERE song_id=? AND kind IN ('musicxml','pdf') ORDER BY CASE WHEN kind='musicxml' THEN 0 ELSE 1 END,name",
            (song_id,))]
    if not candidates:
        raise HTTPException(404, "Brak partytury. Zaimportuj MusicXML z komputera.")
    selected = next((row for row in candidates if row["id"] == file_id), None) if file_id else candidates[0]
    if not selected:
        raise HTTPException(404, "Ta partytura nie należy do wybranego utworu.")
    if selected["kind"] == "pdf":
        xml = next((row for row in candidates if row["kind"] == "musicxml" and
                    (not row["section"] or row["section"] == selected["section"] or row["id"].startswith("local-"))), None)
        if xml:
            selected = xml
    path = cache_path(selected)
    if path is None:
        if selected["id"].startswith(("local-", "omr-")):
            raise HTTPException(404, "Brak lokalnego MusicXML. Zaimportuj ponownie.")
        path = await drive.download(selected)
    if selected["kind"] == "pdf":
        from .scores import ScoreError, convert_pdf, inspect_pdf
        try:
            converted = await asyncio.to_thread(convert_pdf, path, GENERATED / selected["id"])
        except ScoreError as exc:
            metadata = await asyncio.to_thread(inspect_pdf, path)
            raise HTTPException(409, {"code": "omr_required", "message": score_error_detail(exc)["message"],
                                     "pdf": metadata, "file_id": selected["id"]}) from exc
        xml_id = "omr-" + hashlib.sha256(converted.read_bytes()).hexdigest()[:24]
        extension = converted.suffix.lower()
        xml_name = f"{selected['name'].rsplit('.', 1)[0]}{extension}"
        shutil.copyfile(converted, CACHE / f"{xml_id}{extension}")
        with database() as db:
            db.execute("INSERT OR REPLACE INTO files VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                       (xml_id, song_id, selected["event_id"], xml_name, "application/xml", "musicxml",
                        None, 0, 0, selected["section"], None, converted.stat().st_size))
        selected, path = file_record(xml_id), CACHE / f"{xml_id}{extension}"
    return selected, path


async def score_source(song_id: str, file_id: str | None):
    async with score_locks.setdefault(song_id, asyncio.Lock()):
        return await _score_source(song_id, file_id)


class AnalysisBody(BaseModel):
    part: str = Field(default="SI", pattern=r"^(SI|SII|AI|AII|S|A|B)$")
    part_id: str | None = None
    line_id: str | None = Field(default=None, pattern=r"^(voice:[^:\s]+|upper|lower)$")
    file_id: str | None = None
    tempo_factor: float = Field(default=1, ge=0.4, le=1.5)
    transpose: int = Field(default=0, ge=-12, le=12)
    include_bass: bool = False


@app.post("/api/songs/{song_id}/score-info")
async def score_info(song_id: str, body: AnalysisBody):
    from .scores import ScoreError, inspect_parts
    source, path = await score_source(song_id, body.file_id)
    try:
        info = await asyncio.to_thread(inspect_parts, path, body.part)
    except ScoreError as exc:
        raise HTTPException(422, score_error_detail(exc)) from exc
    return info | {"source_id": source["id"], "musicxml_url": f"/api/files/{source['id']}"}


@app.post("/api/songs/{song_id}/analyze")
async def analyze_song(song_id: str, body: AnalysisBody):
    from .scores import ScoreError, analyze
    source, path = await score_source(song_id, body.file_id)
    try:
        result = await asyncio.to_thread(analyze, path, part=body.part, part_id=body.part_id,
                                        tempo_factor=body.tempo_factor, transpose=body.transpose, line_id=body.line_id)
    except ScoreError as exc:
        raise HTTPException(422, score_error_detail(exc)) from exc
    if source["id"].startswith("omr-"):
        result["warnings"] = ["MusicXML pochodzi z automatycznego OMR. Sprawdź rytm, nuty, powtórzenia i tekst z oryginalnym PDF przed nauką."] + result.get("warnings", [])
    return result | {"source_id": source["id"], "musicxml_url": f"/api/files/{source['id']}"}


@app.post("/api/songs/{song_id}/practice")
async def practice(song_id: str, body: AnalysisBody):
    from .scores import ScoreError, synthesize
    source, path = await score_source(song_id, body.file_id)
    digest = hashlib.sha256(path.read_bytes() + json.dumps(body.model_dump(), sort_keys=True).encode()).hexdigest()[:32]
    target = GENERATED / f"{digest}.wav"
    async with practice_locks.setdefault(digest, asyncio.Lock()):
        if not target.exists():
            try:
                await asyncio.to_thread(synthesize, path, target, part=body.part, part_id=body.part_id,
                                        tempo_factor=body.tempo_factor, transpose=body.transpose, include_bass=body.include_bass,
                                        line_id=body.line_id)
            except ScoreError as exc:
                raise HTTPException(422, score_error_detail(exc)) from exc
    return {"url": f"/api/practice/{digest}", "source_id": source["id"], "instrumental": True,
            "local_path": str(target.resolve()), "filename": target.name, "drive_modified": False}


@app.get("/api/practice/{digest}")
def practice_file(digest: str):
    if len(digest) != 32 or not all(c in "0123456789abcdef" for c in digest):
        raise HTTPException(404, "Nie znaleziono nagrania.")
    path = GENERATED / f"{digest}.wav"
    if not path.exists():
        raise HTTPException(404, "Nie znaleziono nagrania.")
    return FileResponse(path, media_type="audio/wav", filename=path.name, content_disposition_type="inline",
                        headers={"Cache-Control": "private, max-age=86400"})


if (ROOT / "dist").is_dir():
    app.mount("/", StaticFiles(directory=ROOT / "dist", html=True), name="frontend")
