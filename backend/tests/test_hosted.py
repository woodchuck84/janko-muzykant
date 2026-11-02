import json
import time
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import main, security, store

ORIGIN = "https://choir.example.com"


@pytest.fixture
def hosted(tmp_path, monkeypatch):
    monkeypatch.setenv("JANKO_HOSTED", "true")
    monkeypatch.setenv("JANKO_PUBLIC_URL", ORIGIN)
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "fake-client")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "fake-secret")
    monkeypatch.setenv("JANKO_ADMIN_EMAILS", "admin@example.com")
    monkeypatch.setenv("JANKO_ALLOWED_EMAILS", "alice@example.com,bob@example.com")
    for module in (main, store):
        monkeypatch.setattr(module, "CACHE", tmp_path / "cache")
        monkeypatch.setattr(module, "GENERATED", tmp_path / "generated")
    monkeypatch.setattr(store, "DATA", tmp_path)
    with TestClient(main.app, base_url=ORIGIN) as client:
        with store.database() as db:
            db.execute("INSERT INTO songs VALUES ('song-a','Arka')")
            db.execute("INSERT INTO songs VALUES ('song-b','Rota')")
            db.execute("INSERT INTO events VALUES ('event-a','Koncert')")
            db.execute("INSERT INTO event_songs VALUES ('event-a','song-a','folder-a')")
        yield client


def signin(client, email="alice@example.com"):
    raw, csrf = "session-" + email, "csrf-" + email
    credentials = {"access_token": "fake-token-" + email, "refresh_token": "fake-refresh",
                   "expires": time.time() + 3600, "checked": time.time()}
    with store.database() as db:
        db.execute("INSERT OR REPLACE INTO auth_sessions VALUES (?,?,?,?,?,?)",
                   (security.digest(raw), email.split("@")[0], email, csrf, time.time() + 3600, json.dumps(credentials)))
    client.cookies.set(security.COOKIE, raw, domain="choir.example.com", path="/")
    return {"X-CSRF-Token": csrf}


def test_hosted_boundary(hosted):
    assert hosted.get("/api/health").json()["drive_access"] == "read-only"
    assert hosted.get("/api/library").status_code == 401
    assert hosted.get("/api/files/private-material").status_code == 401
    assert hosted.get("/api/practice/" + "a" * 32).status_code == 401
    assert hosted.get("/assets/private.js", follow_redirects=False).status_code == 303
    assert hosted.get("/", follow_redirects=False).headers["location"] == "/auth/login"
    assert hosted.get("/api/health", headers={"Host": "evil.example"}).status_code == 400
    assert hosted.get("/docs").status_code == 404
    headers = signin(hosted)
    response = hosted.get("/api/session")
    assert response.json() == {"hosted": True, "user_id": "alice", "email": "alice@example.com",
                               "admin": False, "csrf": headers["X-CSRF-Token"]}
    assert "max-age=31536000" in response.headers["strict-transport-security"]
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert hosted.post("/api/planning/progress", json={}).status_code == 403
    assert hosted.post("/api/planning/progress", headers=headers | {"Origin": "https://evil.example"}, json={}).status_code == 403
    assert hosted.post("/api/sync", headers=headers, json={}).status_code == 403
    assert hosted.post("/api/planning/date", headers=headers, json={}).status_code == 403
    assert hosted.post("/api/planning/calendar", headers=headers, json={}).status_code == 403
    assert hosted.post("/api/songs/song-a/musicxml", headers=headers).status_code == 403
    assert hosted.delete("/api/auth", headers=headers).status_code == 403
    assert hosted.get("/api/config").json()["client_id"] == ""


def test_oauth_redirect_state_pkce_and_cookie(hosted, monkeypatch):
    async def fake_exchange(code, verifier):
        assert code == "fake-google-code" and len(verifier) >= 43
        return {"sub": "google-user-id", "email": "alice@example.com"}, {
            "access_token": "private-access-token", "expires": time.time() + 3600, "checked": time.time()}
    monkeypatch.setattr(security, "exchange_code", fake_exchange)
    redirect = hosted.get("/auth/login", follow_redirects=False)
    query = parse_qs(urlsplit(redirect.headers["location"]).query)
    assert query["scope"] == [security.SCOPES]
    assert query["redirect_uri"] == [ORIGIN + "/auth/callback"]
    assert query["code_challenge_method"] == ["S256"]
    assert hosted.get("/auth/callback?state=wrong&code=fake", follow_redirects=False).status_code == 400
    url = "/auth/callback?state=" + query["state"][0] + "&code=fake-google-code"
    response = hosted.get(url, follow_redirects=False)
    assert response.status_code == 303
    cookie = response.headers.get_list("set-cookie")[0]
    assert "HttpOnly" in cookie and "Secure" in cookie and "SameSite=lax" in cookie
    session = hosted.get("/api/session").json()
    assert session["user_id"] == "google-user-id"
    assert "private-access-token" not in json.dumps(session)
    assert hosted.get(url, follow_redirects=False).status_code == 400
    assert hosted.post("/auth/logout", headers={"X-CSRF-Token": session["csrf"]}).status_code == 204
    assert hosted.get("/api/session").status_code == 401


@pytest.mark.anyio
async def test_real_exchange_contract_uses_fake_google(monkeypatch, hosted):
    calls = []

    def google(request):
        calls.append(request)
        if request.url.path == "/token":
            return httpx.Response(200, json={"access_token": "fake-google-access", "refresh_token": "fake-refresh",
                                             "expires_in": 3600, "scope": security.SCOPES})
        if request.url.path.endswith("/userinfo"):
            return httpx.Response(200, json={"sub": "google-sub", "email": "alice@example.com", "email_verified": True})
        return httpx.Response(200, json={"id": main.ROOT_ID, "mimeType": "application/vnd.google-apps.folder"})

    original = httpx.AsyncClient
    monkeypatch.setattr(security.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(google), **kwargs))
    profile, credentials = await security.exchange_code("fake-code", "fake-verifier")
    assert profile["sub"] == "google-sub"
    assert credentials["access_token"] == "fake-google-access"
    assert [request.method for request in calls] == ["POST", "GET", "GET"]
    assert str(calls[-1].url).startswith("https://www.googleapis.com/drive/v3/files/")
    assert calls[-1].headers["authorization"] == "Bearer fake-google-access"
    with pytest.raises(main.HTTPException):
        security.validate_scope(security.SCOPES + " https://www.googleapis.com/auth/drive")


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_public_root_always_requires_explicit_members(hosted, monkeypatch):
    async with httpx.AsyncClient(transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json={"mimeType": "application/vnd.google-apps.folder"}))) as client:
        with pytest.raises(main.HTTPException) as exc:
            await security.check_membership(client, "fake", "outsider@example.com")
        assert exc.value.status_code == 403
        # A stale or mistakenly supplied flag cannot disable the required allowlist.
        monkeypatch.setenv("JANKO_RESTRICT_EMAILS", "false")
        with pytest.raises(main.HTTPException):
            await security.check_membership(client, "fake", "outsider@example.com")
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(403))) as client:
        await security.check_membership(client, "fake", "admin@example.com")
        with pytest.raises(main.HTTPException):
            await security.check_membership(client, "fake", "alice@example.com")
        with pytest.raises(main.HTTPException):
            await security.check_membership(client, "fake", "outsider@example.com")
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(503))) as client:
        with pytest.raises(main.HTTPException) as exc:
            await security.check_membership(client, "fake", "admin@example.com")
        assert exc.value.status_code == 502


@pytest.mark.anyio
@pytest.mark.parametrize("profile", [
    {"sub": "google-id", "email": "alice@example.com", "email_verified": False},
    {"sub": "", "email": "alice@example.com", "email_verified": True},
    {"sub": "google-id", "email": "outsider@example.com", "email_verified": True},
])
async def test_google_identity_must_be_verified_and_allowed(hosted, monkeypatch, profile):
    def google(request):
        if request.url.path == "/token":
            return httpx.Response(200, json={"access_token": "fake-token", "scope": security.SCOPES})
        if request.url.path.endswith("/userinfo"):
            return httpx.Response(200, json=profile)
        return httpx.Response(200, json={"mimeType": "application/vnd.google-apps.folder"})
    original = httpx.AsyncClient
    monkeypatch.setattr(security.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(google), **kwargs))
    with pytest.raises(main.HTTPException) as exc:
        await security.exchange_code("fake-code", "fake-verifier")
    assert exc.value.status_code == 403


def test_per_user_planning_and_notifications(hosted):
    with store.database() as db:
        db.execute("""INSERT INTO planning_changes(file_id,name,change,song_id,detected_at)
                      VALUES ('material','Nowy plik','new','song-a','2026-10-31')""")
    alice = signin(hosted)
    assert hosted.post("/api/planning/progress", headers=alice,
                       json={"song_id": "song-a", "part": "B", "status": "concert"}).status_code == 200
    assert hosted.post("/api/planning/session", headers=alice,
                       json={"song_id": "song-a", "part": "B", "seconds": 90}).status_code == 200
    assert hosted.post("/api/planning/setlist", headers=alice,
                       json={"event_id": "event-a", "song_ids": ["song-b", "song-a"]}).status_code == 200
    assert hosted.post("/api/planning/changes/ack", headers=alice, json={}).json()["acknowledged"] == 1
    state = hosted.get("/api/planning/state?part=B").json()
    assert state["statuses"][0]["status"] == "concert"
    assert state["sessions"]["total_seconds"] == 90
    assert state["setlists"][0]["song_ids"] == ["song-b", "song-a"]
    assert state["changes"] == []
    signin(hosted, "bob@example.com")
    state = hosted.get("/api/planning/state?part=B").json()
    assert state["statuses"] == [] and state["sessions"]["total_seconds"] == 0
    assert state["setlists"][0]["song_ids"] == ["song-a"]
    assert len(state["changes"]) == 1
    signin(hosted)
    assert hosted.get("/api/planning/state?part=B").json()["sessions"]["total_seconds"] == 90


def test_admin_import_generation_limits_and_no_debug(hosted):
    headers = signin(hosted, "admin@example.com")
    fixture = Path(__file__).parent / "fixtures" / "unnamed.musicxml"
    response = hosted.post("/api/songs/song-a/musicxml", headers=headers,
                           files={"file": ("unnamed.musicxml", fixture.read_bytes(), "application/xml")})
    assert response.status_code == 200, response.text
    body = {"file_id": response.json()["id"], "part": "B", "part_id": "P3"}
    for endpoint in ("score-info", "analyze", "practice"):
        response = hosted.post(f"/api/songs/song-a/{endpoint}", headers=headers, json=body)
        assert response.status_code == 200, response.text
    assert hosted.get(response.json()["url"]).content.startswith(b"RIFF")
    assert hosted.post("/api/sync", headers=headers, json={"root_id": "unrelated-folder"}).status_code == 403
    for _ in range(10):
        result = hosted.post("/api/songs/song-a/analyze", headers=headers, json=body)
        if result.status_code == 429:
            break
    assert result.status_code == 429
    response = hosted.post("/api/planning/session", headers=headers, content=b"x" * (security.MAX_BODY + 1))
    assert response.status_code == 413
    assert hosted.get("/openapi.json").status_code == 404


def test_removed_member_session_denied(hosted, monkeypatch):
    signin(hosted)
    monkeypatch.setenv("JANKO_ALLOWED_EMAILS", "bob@example.com")
    assert hosted.get("/api/library").status_code == 401


@pytest.mark.anyio
async def test_refresh_and_membership_revocation_fail_closed(hosted, monkeypatch):
    signin(hosted)
    with store.database() as db:
        db.execute("UPDATE auth_sessions SET credentials=?", (json.dumps({
            "access_token": "old-token", "refresh_token": "fake-refresh", "expires": 0, "checked": 0}),))
    calls = []

    def google(request):
        calls.append(request)
        if request.method == "POST":
            return httpx.Response(200, json={"access_token": "fresh-token", "expires_in": 3600,
                                             "scope": security.SCOPES})
        return httpx.Response(403)

    original = httpx.AsyncClient
    monkeypatch.setattr(security.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(google), **kwargs))
    with pytest.raises(main.HTTPException) as exc:
        await security.load_session("session-alice@example.com")
    assert exc.value.status_code == 403
    assert [request.method for request in calls] == ["POST", "GET"]
    assert calls[-1].headers["authorization"] == "Bearer fresh-token"


def test_drive_tokens_are_request_scoped(hosted, monkeypatch):
    from backend.drive import drive
    observed = []
    with store.database() as db:
        db.execute("INSERT INTO files VALUES ('remote-file','song-a',NULL,'song.pdf','application/pdf','pdf',NULL,0,0,'',NULL,3)")

    async def download(file):
        observed.append(drive.token)
        path = store.CACHE / "download.pdf"
        path.write_bytes(b"pdf")
        return path

    monkeypatch.setattr(drive, "download", download)
    signin(hosted)
    assert hosted.get("/api/files/remote-file").status_code == 200
    signin(hosted, "bob@example.com")
    assert hosted.get("/api/files/remote-file").status_code == 200
    assert observed == ["fake-token-alice@example.com", "fake-token-bob@example.com"]
    assert drive.token is None


def test_personal_legacy_migration_remains_local(hosted):
    from backend import planning
    with store.database() as db:
        db.execute("DROP TABLE planning_progress")
        db.execute("""CREATE TABLE planning_progress(song_id TEXT NOT NULL,part TEXT NOT NULL,
                      status TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(song_id,part))""")
        db.execute("INSERT INTO planning_progress VALUES ('song-a','B','concert','2026-10-31')")
    planning.initialize_planning()
    with store.database() as db:
        assert db.execute("SELECT user_id FROM planning_progress").fetchone()["user_id"] == "local"
    signin(hosted)
    assert hosted.get("/api/planning/state?part=B").json()["statuses"] == []


def test_hosted_config_fails_closed(hosted, monkeypatch):
    monkeypatch.setenv("JANKO_PUBLIC_URL", "http://choir.example.com")
    with pytest.raises(RuntimeError, match="HTTPS"):
        security.initialize()
    monkeypatch.setenv("JANKO_HOSTED", "1")
    with pytest.raises(RuntimeError, match="true or false"):
        security.hosted()
