import asyncio

import httpx
import pytest

from backend.drive import Drive, DriveError, FOLDER_MIME


def test_public_listing_and_read_only():
    requests = []
    html = """
    <div class="flip-entries">
      <div class="flip-entry"><a href="https://drive.google.com/drive/folders/1234567890folder">
      <div class="flip-entry-title">Koncert</div></a></div>
      <div class="flip-entry"><a href="https://drive.google.com/file/d/1234567890file/view">
      <div class="flip-entry-title">SI - Rota wolniej.m4a</div></a></div>
    </div>"""

    def handler(request):
        requests.append(request)
        return httpx.Response(200, text=html)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await Drive().listing(client, "1234567890root")

    rows = asyncio.run(run())
    assert rows[0].mime == FOLDER_MIME
    assert rows[1].id == "1234567890file"
    assert rows[1].name == "SI - Rota wolniej.m4a"
    assert all(request.method == "GET" for request in requests)


def test_missing_listing_is_error():
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, text="<html>sign in</html>"))) as client:
            await Drive().listing(client, "1234567890root")
    with pytest.raises(DriveError):
        asyncio.run(run())


def test_reject_invalid_id():
    async def run():
        async with httpx.AsyncClient() as client:
            await Drive().listing(client, "../etc")
    with pytest.raises(DriveError):
        asyncio.run(run())
