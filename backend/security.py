"""Optional hosted boundary. Google credentials never leave the server."""
import asyncio
import hashlib
import json
import logging
import os
import secrets
import time
from contextvars import ContextVar
from urllib.parse import urlencode, urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response

from . import store

log = logging.getLogger("janko.security")
router = APIRouter()
identity: ContextVar[dict | None] = ContextVar("janko_identity", default=None)
drive_token: ContextVar[str | None] = ContextVar("janko_drive_token", default=None)
COOKIE = "__Host-janko"
STATE_COOKIE = "__Host-janko-oauth"
READONLY = "https://www.googleapis.com/auth/drive.readonly"
SCOPES = f"openid email {READONLY}"
MAX_BODY = 11 * 1024 * 1024
jobs = asyncio.Semaphore(2)


def hosted() -> bool:
    value = os.getenv("JANKO_HOSTED", "false").strip().lower()
    if value not in {"true", "false"}:
        raise RuntimeError("JANKO_HOSTED must be true or false.")
    return value == "true"


def public_url() -> str:
    return os.getenv("JANKO_PUBLIC_URL", "").rstrip("/")


def emails(name: str) -> set[str]:
    return {value.strip().casefold() for value in os.getenv(name, "").split(",") if value.strip()}


def user_id() -> str:
    user = identity.get()
    return user["user_id"] if user else "local"


def is_admin() -> bool:
    user = identity.get()
    return not hosted() or bool(user and user["email"].casefold() in emails("JANKO_ADMIN_EMAILS"))


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def initialize():
    if hosted():
        url = urlsplit(public_url())
        if url.scheme != "https" or not url.hostname or url.path or url.query or url.fragment or url.username is not None:
            raise RuntimeError("JANKO_PUBLIC_URL must be an HTTPS origin without a path.")
        from .drive import ROOT_ID, valid_id
        valid_id(ROOT_ID)
        if not os.getenv("GOOGLE_CLIENT_ID") or not os.getenv("GOOGLE_CLIENT_SECRET"):
            raise RuntimeError("Hosted mode requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.")
        if not emails("JANKO_ADMIN_EMAILS"):
            raise RuntimeError("Hosted mode requires JANKO_ADMIN_EMAILS.")
    with store.database() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS auth_states(
          hash TEXT PRIMARY KEY,expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS auth_sessions(
          hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,email TEXT NOT NULL,
          csrf TEXT NOT NULL,expires REAL NOT NULL,credentials TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS auth_limits(
          key TEXT PRIMARY KEY,start REAL NOT NULL,count INTEGER NOT NULL);
        """)


def limited(key: str, maximum: int, window: int = 60) -> bool:
    stamp = time.time()
    with store.database() as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("DELETE FROM auth_limits WHERE start<?", (stamp - 3600,))
        row = db.execute("SELECT start,count FROM auth_limits WHERE key=?", (key,)).fetchone()
        start, count = (row["start"], row["count"]) if row and row["start"] > stamp - window else (stamp, 0)
        db.execute("INSERT OR REPLACE INTO auth_limits VALUES (?,?,?)", (key, start, count + 1))
    return count >= maximum


def validate_scope(scope: str):
    scopes = scope.split()
    if READONLY not in scopes or any(s.startswith("https://www.googleapis.com/auth/drive") and s != READONLY for s in scopes):
        raise HTTPException(403, "Wymagany jest wyłącznie dostęp Drive tylko do odczytu.")


async def check_membership(client: httpx.AsyncClient, token: str, email: str):
    from .drive import ROOT_ID, FOLDER_MIME
    allowed = emails("JANKO_ADMIN_EMAILS") | emails("JANKO_ALLOWED_EMAILS")
    if email.casefold() not in allowed:
        raise HTTPException(403, "To konto nie znajduje się na liście chórzystów. Poproś administratora o dodanie adresu.")
    response = await client.get(
        f"https://www.googleapis.com/drive/v3/files/{ROOT_ID}",
        params={"fields": "id,mimeType,trashed", "supportsAllDrives": "true"},
        headers={"Authorization": f"Bearer {token}"})
    if response.status_code == 200:
        folder = response.json()
        if folder.get("mimeType") == FOLDER_MIME and not folder.get("trashed", False):
            return
    elif response.status_code not in (401, 403, 404):
        raise HTTPException(502, "Nie można teraz sprawdzić dostępu do folderu chóru.")
    if email.casefold() not in emails("JANKO_ADMIN_EMAILS"):
        raise HTTPException(403, "To konto nie ma dostępu do folderu chóru. Poproś administratora o dostęp.")


async def exchange_code(code: str, verifier: str) -> tuple[dict, dict]:
    async with httpx.AsyncClient(timeout=20) as client:
        result = await client.post("https://oauth2.googleapis.com/token", data={
            "code": code, "client_id": os.environ["GOOGLE_CLIENT_ID"],
            "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
            "redirect_uri": public_url() + "/auth/callback", "grant_type": "authorization_code",
            "code_verifier": verifier})
        if result.status_code != 200:
            raise HTTPException(401, "Google odrzucił logowanie. Spróbuj ponownie.")
        tokens = result.json()
        validate_scope(tokens.get("scope", ""))
        token = tokens["access_token"]
        response = await client.get("https://openidconnect.googleapis.com/v1/userinfo",
                                    headers={"Authorization": f"Bearer {token}"})
        if response.status_code != 200:
            raise HTTPException(401, "Nie można potwierdzić konta Google.")
        profile = response.json()
        if profile.get("email_verified") is not True or not profile.get("sub") or not profile.get("email"):
            raise HTTPException(403, "Google musi potwierdzić adres e-mail.")
        await check_membership(client, token, profile["email"])
    credentials = {"access_token": token, "refresh_token": tokens.get("refresh_token"),
                   "expires": time.time() + int(tokens.get("expires_in", 3600)), "checked": time.time()}
    return profile, credentials


async def load_session(raw: str) -> dict | None:
    if not raw:
        return None
    with store.database() as db:
        db.execute("DELETE FROM auth_sessions WHERE expires<=?", (time.time(),))
        row = db.execute("SELECT * FROM auth_sessions WHERE hash=? AND expires>?", (digest(raw), time.time())).fetchone()
    if not row:
        return None
    user = dict(row)
    if user["email"].casefold() not in emails("JANKO_ADMIN_EMAILS") | emails("JANKO_ALLOWED_EMAILS"):
        return None
    credentials = json.loads(user["credentials"])
    async with httpx.AsyncClient(timeout=20) as client:
        if credentials["expires"] < time.time() + 60:
            if not credentials.get("refresh_token"):
                return None
            response = await client.post("https://oauth2.googleapis.com/token", data={
                "client_id": os.environ["GOOGLE_CLIENT_ID"], "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
                "refresh_token": credentials["refresh_token"], "grant_type": "refresh_token"})
            if response.status_code != 200:
                with store.database() as db:
                    db.execute("DELETE FROM auth_sessions WHERE hash=?", (user["hash"],))
                return None
            tokens = response.json()
            validate_scope(tokens.get("scope", READONLY))
            credentials.update(access_token=tokens["access_token"],
                               expires=time.time() + int(tokens.get("expires_in", 3600)))
        if credentials["checked"] < time.time() - 900:
            await check_membership(client, credentials["access_token"], user["email"])
            credentials["checked"] = time.time()
    with store.database() as db:
        db.execute("UPDATE auth_sessions SET credentials=? WHERE hash=?", (json.dumps(credentials), user["hash"]))
    user["access_token"] = credentials["access_token"]
    return user


@router.get("/auth/login")
def login():
    if not hosted():
        return RedirectResponse("/")
    state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(48)
    # The verifier is server-side; cookie binds this state to the initiating browser.
    with store.database() as db:
        db.execute("DELETE FROM auth_states WHERE expires<?", (time.time(),))
        db.execute("INSERT INTO auth_states VALUES (?,?)", (digest(state) + ":" + verifier, time.time() + 600))
    import base64
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    response = RedirectResponse("https://accounts.google.com/o/oauth2/v2/auth?" + urlencode({
        "client_id": os.environ["GOOGLE_CLIENT_ID"], "redirect_uri": public_url() + "/auth/callback",
        "response_type": "code", "scope": SCOPES, "state": state, "access_type": "offline",
        "prompt": "consent", "code_challenge": challenge, "code_challenge_method": "S256"}))
    response.set_cookie(STATE_COOKIE, state, max_age=600, secure=True, httponly=True, samesite="lax", path="/")
    return response


@router.get("/auth/callback")
async def callback(request: Request):
    if not hosted():
        raise HTTPException(404)
    state = request.query_params.get("state", "")
    cookie = request.cookies.get(STATE_COOKIE, "")
    if not state or not cookie or not secrets.compare_digest(state, cookie):
        raise HTTPException(400, "Logowanie wygasło lub nie zostało rozpoczęte w tej przeglądarce.")
    with store.database() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT hash FROM auth_states WHERE hash LIKE ? AND expires>?",
                         (digest(state) + ":%", time.time())).fetchone()
        if row:
            db.execute("DELETE FROM auth_states WHERE hash=?", (row["hash"],))
    code = request.query_params.get("code")
    if not row or not code:
        raise HTTPException(400, "Logowanie anulowane lub wygasłe. Rozpocznij ponownie.")
    profile, credentials = await exchange_code(code, row["hash"].split(":", 1)[1])
    raw, csrf = secrets.token_urlsafe(48), secrets.token_urlsafe(32)
    lifetime = min(max(int(os.getenv("JANKO_SESSION_DAYS", "7")), 1), 30) * 86400
    with store.database() as db:
        db.execute("DELETE FROM auth_sessions WHERE expires<?", (time.time(),))
        db.execute("INSERT INTO auth_sessions VALUES (?,?,?,?,?,?)",
                   (digest(raw), profile["sub"], profile["email"], csrf, time.time() + lifetime, json.dumps(credentials)))
    response = RedirectResponse("/", status_code=303)
    response.set_cookie(COOKIE, raw, max_age=lifetime, secure=True, httponly=True, samesite="lax", path="/")
    response.delete_cookie(STATE_COOKIE, secure=True, httponly=True, samesite="lax", path="/")
    return response


@router.get("/api/session")
def session():
    user = identity.get()
    return {"hosted": hosted(), "user_id": user_id(), "email": user["email"] if user else None,
            "admin": is_admin(), "csrf": user["csrf"] if user else None}


@router.post("/auth/logout")
def logout(request: Request):
    with store.database() as db:
        db.execute("DELETE FROM auth_sessions WHERE hash=?", (digest(request.cookies.get(COOKIE, "")),))
    response = Response(status_code=204)
    response.delete_cookie(COOKIE, secure=True, httponly=True, samesite="lax", path="/")
    return response


def error(status: int, detail: str):
    return JSONResponse({"detail": detail}, status_code=status)


async def hosted_request(request: Request, call_next):
    path = request.url.path
    if request.headers.get("host", "").casefold() != urlsplit(public_url()).netloc.casefold():
        # Docker health probe needs no session, but exposes no user/library data.
        if path == "/api/health" and request.headers.get("host", "").split(":")[0] in {"localhost", "127.0.0.1"}:
            return await call_next(request)
        return error(400, "Nieprawidłowa domena aplikacji.")
    if request.headers.get("origin") and request.headers["origin"] != public_url():
        return error(403, "Niedozwolone źródło żądania.")
    try:
        length = int(request.headers.get("content-length", "0"))
    except ValueError:
        return error(400, "Nieprawidłowa długość żądania.")
    if length > MAX_BODY:
        return error(413, "Żądanie przekracza limit 11 MB.")
    # Bound chunked requests too, before multipart parsing or expensive processing.
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > MAX_BODY:
                return error(413, "Żądanie przekracza limit 11 MB.")
        request._body = bytes(body)
    if path in {"/auth/login", "/auth/callback"}:
        # No proxy-supplied client IP is trusted for authorization.
        if limited("oauth-global", 60):
            return error(429, "Zbyt wiele prób logowania. Spróbuj za minutę.")
        return await call_next(request)
    if path == "/api/health":
        return await call_next(request)
    if path in {"/docs", "/redoc", "/openapi.json"}:
        return error(404, "Nie znaleziono strony.")
    try:
        user = await load_session(request.cookies.get(COOKIE, ""))
    except HTTPException as exc:
        return error(exc.status_code, str(exc.detail))
    except httpx.HTTPError:
        log.warning("Google session verification unavailable")
        return error(502, "Google jest chwilowo niedostępne. Spróbuj ponownie.")
    if not user:
        if path.startswith(("/api/", "/auth/")):
            return error(401, "Zaloguj się kontem Google z dostępem do folderu chóru.")
        return RedirectResponse("/auth/login", status_code=303)
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        if not secrets.compare_digest(request.headers.get("x-csrf-token", ""), user["csrf"]):
            return error(403, "Brak poprawnego tokenu CSRF. Odśwież stronę.")
    who = identity.set(user)
    token = drive_token.set(user["access_token"])
    try:
        if path == "/api/auth":
            return error(403, "W trybie serwerowym połączeniem Google zarządza logowanie.")
        if path == "/sw.js":
            # Replace any previous local/offline worker when moving this origin to hosted mode.
            return Response(
                "self.addEventListener('install',()=>self.skipWaiting());"
                "self.addEventListener('activate',e=>e.waitUntil((async()=>{"
                "for(const k of await caches.keys())await caches.delete(k);"
                "await self.registration.unregister();await self.clients.claim();})()));",
                media_type="application/javascript")
        admin_action = (path == "/api/sync" or path in {"/api/planning/date", "/api/planning/calendar"}
                        or path.endswith("/musicxml"))
        if admin_action and not is_admin():
            return error(403, "Ta czynność jest dostępna tylko administratorowi chóru.")
        expensive = path.endswith(("/score-info", "/analyze", "/practice", "/cache", "/musicxml")) or path in {"/api/sync", "/api/planning/calendar"}
        if request.method == "POST" and expensive:
            if limited("expensive:" + user["user_id"], 8) or limited("expensive-global", 30):
                return error(429, "Limit analizy/pobierania: spróbuj ponownie za minutę.")
            if jobs.locked():
                return error(503, "Serwer analizuje już inne utwory. Spróbuj za chwilę.")
            async with jobs:
                return await call_next(request)
        return await call_next(request)
    finally:
        drive_token.reset(token)
        identity.reset(who)


def secure_headers(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Permissions-Policy"] = "microphone=(self), camera=()"
    return response
