import pytest

from backend.parser import normalize_song, parse_filename


@pytest.mark.parametrize("name,part,slow,full,kind", [
    ("SI - Contrapunto wolniej.m4a", "SI", True, False, "audio"),
    ("SII - Contrapunto.m4a", "SII", False, False, "audio"),
    ("A II - Gaude Mater.mp3", "AII", False, False, "audio"),
    ("A - Piechota.m4a", "A", False, False, "audio"),
    ("B - Rota wolniej.m4a", "B", True, False, "audio"),
    ("K_Łączko zielona.mp3", None, False, True, "audio"),
    ("1. Wojenko, wojenko - Chór.pdf", None, False, False, "pdf"),
    ("Piechota.musicxml", None, False, False, "musicxml"),
    ("Piechota.MXL", None, False, False, "musicxml"),
    ("Kot (Gatto).m4a", None, False, False, "audio"),
    ("Podział głosów", None, False, False, "document"),
])
def test_filename(name, part, slow, full, kind):
    parsed = parse_filename(name)
    assert (parsed["part"], parsed["slow"], parsed["full"], parsed["kind"]) == (part, slow, full, kind)


def test_normalized_deduplication():
    assert normalize_song(" Kto cię wołał, legionisto ") == normalize_song("Kto cię wołał legionisto")
    assert normalize_song("1. Łączko zielona - chór") == "laczko zielona"
    assert parse_filename("A - Rota wolniej.m4a")["song_key"] == parse_filename("Rota.pdf")["song_key"]
