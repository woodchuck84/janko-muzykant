import re
import unicodedata
from pathlib import PurePosixPath

AUDIO_EXTENSIONS = {".m4a", ".mp3", ".wav", ".ogg", ".flac", ".aac"}
SCORE_EXTENSIONS = {".musicxml", ".xml", ".mxl"}


def normalize_song(name: str) -> str:
    text = unicodedata.normalize("NFKD", name.casefold().replace("ł", "l"))
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"^\s*\d+[.)]\s*", "", text)
    text = re.sub(r"\s*[-–]\s*chor\s*$", "", text)
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def parse_filename(name: str) -> dict:
    ext = PurePosixPath(name).suffix.lower()
    stem = name[: -len(ext)] if ext else name
    part = None
    match = re.match(r"^\s*(S\s*II|S\s*I|A\s*II|A\s*I|S|A|B)\s*[-–_]\s*(.+)$", stem, re.I)
    if match:
        part = re.sub(r"\s+", "", match[1].upper())
        stem = match[2]
    full = bool(re.match(r"^K[_ -]", stem, re.I))
    stem = re.sub(r"^K[_ -]", "", stem, flags=re.I)
    slow = bool(re.search(r"\b(wolniej|slow)\b", stem, re.I))
    stem = re.sub(r"\s*\b(wolniej|slow)\b", "", stem, flags=re.I).strip()
    kind = "audio" if ext in AUDIO_EXTENSIONS else "pdf" if ext == ".pdf" else "musicxml" if ext in SCORE_EXTENSIONS else "document"
    return {"kind": kind, "part": part, "slow": slow, "full": full, "song_key": normalize_song(stem)}
