"""Score intelligence for the choir practice app (Phase 2).

Pipeline: PDF -> (optional Audiveris OMR) -> MusicXML -> analysis / practice audio.

Public API (all functions raise :class:`ScoreError` with an actionable message):

* ``inspect_pdf(path)``                -> dict  (page count + extracted text, no musical guessing)
* ``convert_pdf(path, output_dir)``    -> Path  (MusicXML ``.mxl`` produced by Audiveris)
* ``load_score(path)``                 -> music21 Score (``.xml`` / ``.musicxml`` / ``.mxl``)
* ``list_parts(path)``                 -> list of parts with detected voice codes
* ``analyze(path, part='SI', ...)``    -> dict  (timeline, range, difficulty, breaths, entrances, lyrics)
* ``synthesize(path, output_path, ...)`` -> Path (mono 16-bit WAV instrumental guide, not sung lyrics)
* ``audiveris_status()``               -> dict  (is the OMR engine available?)

Source files are only ever read; outputs are written to caller-provided paths.
"""

from __future__ import annotations

import bisect
import math
import os
import re
import shlex
import shutil
import subprocess
import threading
import time
import unicodedata
import wave
import zipfile
import xml.etree.ElementTree as ET
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

# --------------------------------------------------------------------------- limits

MAX_XML_BYTES = 25 * 1024 * 1024
MAX_MXL_BYTES = 25 * 1024 * 1024
MAX_MXL_UNCOMPRESSED = 60 * 1024 * 1024
MAX_MXL_ENTRIES = 500
MAX_COMPRESSION_RATIO = 100
MAX_PDF_BYTES = 200 * 1024 * 1024
MAX_PDF_TEXT_PAGES = 300
MAX_PDF_TEXT_CHARS = 500_000
MAX_MEASURES = 5_000
MAX_NOTES = 20_000
MAX_SYNTH_SECONDS = 900.0
SAMPLE_RATE = 22_050
DEFAULT_TEMPO = 100.0
DEFAULT_AUDIVERIS_TIMEOUT = 900.0
TEMPO_FACTOR_RANGE = (0.25, 4.0)
TRANSPOSE_RANGE = (-24, 24)
LONG_PHRASE_SECONDS = 10.0

PROJECT_ROOT = Path(__file__).resolve().parents[1]
LOCAL_TOOLS_DIR = PROJECT_ROOT / "data" / "tools"

AUDIVERIS_SETUP_HINT = (
    "Install Audiveris (https://github.com/Audiveris/audiveris/releases) and either "
    "put it on PATH, extract it under data\\tools\\Audiveris, or set AUDIVERIS_COMMAND, e.g. "
    'AUDIVERIS_COMMAND="C:\\Program Files\\Audiveris\\Audiveris.exe". '
    "Best alternative: ask the conductor for a MusicXML export from Sibelius "
    "(File > Export > MusicXML) and upload the .mxl/.musicxml file instead. See docs/SCORE_SETUP.md."
)


# --------------------------------------------------------------------------- errors


class ScoreError(Exception):
    """User-facing error with a stable ``code`` and optional ``hint``/``details``."""

    code = "score_error"

    def __init__(self, message: str, *, code: str | None = None, hint: str | None = None,
                 details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        if code:
            self.code = code
        self.hint = hint
        self.details = details or {}

    def to_dict(self) -> dict[str, Any]:
        return {"error": self.code, "message": self.message, "hint": self.hint, **self.details}


class EngineMissingError(ScoreError):
    code = "omr_engine_missing"


class PartSelectionError(ScoreError):
    code = "part_selection"

    def __init__(self, message: str, available_parts: list[dict[str, Any]], **kwargs: Any) -> None:
        details = dict(kwargs.pop("details", None) or {})
        details["available_parts"] = available_parts
        super().__init__(message, details=details, **kwargs)
        self.available_parts = available_parts


# --------------------------------------------------------------------------- helpers


def _check_file(path: Path, max_bytes: int, kind: str) -> Path:
    path = Path(path)
    if not path.is_file():
        raise ScoreError(f"{kind} file not found: {path}", code="not_found")
    size = path.stat().st_size
    if size == 0:
        raise ScoreError(f"{kind} file is empty: {path.name}", code="invalid_file")
    if size > max_bytes:
        raise ScoreError(f"{kind} file is too large ({size // 1024 // 1024} MB, limit "
                         f"{max_bytes // 1024 // 1024} MB): {path.name}", code="file_too_large")
    return path


def _read_limited(fh: Any, limit: int, what: str) -> bytes:
    data = fh.read(limit + 1)
    if len(data) > limit:
        raise ScoreError(f"{what} exceeds the {limit // 1024 // 1024} MB limit", code="file_too_large")
    return data


def _round(value: float, digits: int = 4) -> float:
    return float(round(float(value), digits))


def _tail(path: Path, limit: int = 4000) -> str:
    try:
        with open(path, "rb") as fh:
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            fh.seek(max(0, size - limit))
            return fh.read().decode("utf-8", "replace").strip()
    except OSError:
        return ""


# --------------------------------------------------------------------------- PDF


def inspect_pdf(path: Path) -> dict[str, Any]:
    """Return factual PDF information: page count, metadata and extracted text layer.

    No musical analysis is attempted on PDFs - notes require MusicXML (export or OMR).
    """
    path = _check_file(Path(path), MAX_PDF_BYTES, "PDF")
    with open(path, "rb") as fh:
        if not fh.read(1024).lstrip().startswith(b"%PDF"):
            raise ScoreError(f"{path.name} is not a PDF file", code="invalid_file")
    result: dict[str, Any] = {
        "path": str(path), "file_size": path.stat().st_size, "page_count": None,
        "metadata": {}, "pages": [], "text": "", "has_text_layer": False,
        "text_truncated": False, "omr": audiveris_status(), "warnings": [],
    }
    try:
        import pymupdf  # type: ignore
    except ImportError:
        try:
            import fitz as pymupdf  # type: ignore
        except ImportError:
            result["warnings"].append("PyMuPDF is not installed (pip install pymupdf); page count and text are unavailable.")
            return result
    try:
        doc = pymupdf.open(str(path))
    except Exception as exc:  # noqa: BLE001 - library raises many types
        raise ScoreError(f"Could not open PDF {path.name}: {exc}", code="invalid_file") from exc
    with doc:
        if doc.needs_pass:
            raise ScoreError(f"PDF {path.name} is password protected", code="invalid_file")
        result["page_count"] = doc.page_count
        meta = doc.metadata or {}
        result["metadata"] = {k: meta.get(k) or None for k in ("title", "author", "subject", "creator", "producer")}
        texts: list[str] = []
        budget = MAX_PDF_TEXT_CHARS
        for index, page in enumerate(doc):
            if index >= MAX_PDF_TEXT_PAGES:
                result["text_truncated"] = True
                result["warnings"].append(f"Text extracted from the first {MAX_PDF_TEXT_PAGES} pages only.")
                break
            text = page.get_text("text") or ""
            if len(text) > budget:
                text = text[:budget]
                result["text_truncated"] = True
            budget -= len(text)
            texts.append(text)
            result["pages"].append({
                "number": index + 1, "text": text, "char_count": len(text),
                "image_count": len(page.get_images(full=False)),
                "width": _round(page.rect.width, 1), "height": _round(page.rect.height, 1),
            })
            if budget <= 0:
                if index + 1 < doc.page_count:
                    result["warnings"].append("Text output truncated at the character limit.")
                break
    result["text"] = "\n".join(texts)
    result["has_text_layer"] = any(t.strip() for t in texts)
    if not result["has_text_layer"]:
        result["warnings"].append("No text layer found (probably a scanned image PDF); OMR quality may be lower.")
    return result


# --------------------------------------------------------------------------- Audiveris


def _split_command(command: str) -> list[str]:
    if os.name == "nt":
        parts = shlex.split(command, posix=False)
        return [p[1:-1] if len(p) >= 2 and p[0] == p[-1] and p[0] in "\"'" else p for p in parts]
    return shlex.split(command)


def _default_audiveris_locations() -> list[Path]:
    candidates: list[Path] = []
    if LOCAL_TOOLS_DIR.is_dir():
        names = ("Audiveris.exe", "audiveris.exe", "Audiveris.bat", "Audiveris", "audiveris")
        for depth in ("", "*/", "*/*/", "*/*/*/", "*/*/*/*/"):
            for name in names:
                candidates.extend(p for p in sorted(LOCAL_TOOLS_DIR.glob(depth + name)) if p.is_file())
            if candidates:
                break
    if os.name == "nt":
        for base in filter(None, (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)"),
                                  os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs"))):
            candidates += [Path(base) / "Audiveris" / "Audiveris.exe",
                           Path(base) / "Audiveris" / "bin" / "Audiveris.bat"]
    else:
        candidates += [Path("/Applications/Audiveris.app/Contents/MacOS/Audiveris"),
                       Path("/opt/audiveris/bin/Audiveris"), Path("/opt/audiveris/bin/audiveris")]
    return candidates


def _find_audiveris() -> tuple[list[str], str]:
    env = os.environ.get("AUDIVERIS_COMMAND", "").strip()
    if env:
        try:
            argv = _split_command(env)
        except ValueError as exc:
            raise EngineMissingError(f"AUDIVERIS_COMMAND cannot be parsed: {exc}", hint=AUDIVERIS_SETUP_HINT) from exc
        if not argv:
            raise EngineMissingError("AUDIVERIS_COMMAND is empty", hint=AUDIVERIS_SETUP_HINT)
        exe = argv[0]
        if Path(exe).is_file():
            return argv, "env"
        found = shutil.which(exe)
        if found:
            return [found, *argv[1:]], "env"
        raise EngineMissingError(f"AUDIVERIS_COMMAND points to {exe!r}, which does not exist.",
                                 hint=AUDIVERIS_SETUP_HINT)
    for name in ("audiveris", "Audiveris"):
        found = shutil.which(name)
        if found:
            return [found], "path"
    for candidate in _default_audiveris_locations():
        if candidate.is_file():
            return [str(candidate)], "default-location"
    raise EngineMissingError(
        "Audiveris OMR engine was not found, so the PDF cannot be converted to MusicXML automatically.",
        hint=AUDIVERIS_SETUP_HINT)


def audiveris_status() -> dict[str, Any]:
    """Report whether the OMR engine can be found (does not run it)."""
    try:
        argv, source = _find_audiveris()
    except EngineMissingError as exc:
        return {"available": False, "command": None, "source": None, "error": exc.message, "hint": exc.hint}
    return {"available": True, "command": argv, "source": source, "error": None, "hint": None}


def convert_pdf(path: Path, output_dir: Path) -> Path:
    """Convert a PDF score to MusicXML (.mxl) with Audiveris in batch mode.

    The PDF is only read. Audiveris output and logs are written into ``output_dir``.
    Expect OMR mistakes: the result should be checked against the PDF.
    """
    pdf = _check_file(Path(path), MAX_PDF_BYTES, "PDF").resolve()
    argv, _source = _find_audiveris()
    out = Path(output_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)
    try:
        timeout = float(os.environ.get("AUDIVERIS_TIMEOUT", DEFAULT_AUDIVERIS_TIMEOUT))
    except ValueError:
        timeout = DEFAULT_AUDIVERIS_TIMEOUT
    before = {p: p.stat().st_mtime_ns for p in out.rglob("*.mxl")}
    stdout_log = out / f"{pdf.stem}.audiveris.stdout.log"
    stderr_log = out / f"{pdf.stem}.audiveris.stderr.log"
    cmd = [*argv, "-batch", "-export", "-output", str(out), str(pdf)]
    kwargs: dict[str, Any] = {}
    if os.name == "nt":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        with open(stdout_log, "wb") as so, open(stderr_log, "wb") as se:
            proc = subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=so, stderr=se, timeout=timeout,
                                  shell=False, check=False, cwd=str(out), **kwargs)
    except FileNotFoundError as exc:
        raise EngineMissingError(f"Could not start Audiveris ({argv[0]}): {exc}", hint=AUDIVERIS_SETUP_HINT) from exc
    except subprocess.TimeoutExpired as exc:
        raise ScoreError(f"Audiveris did not finish within {timeout:.0f} s for {pdf.name}.", code="omr_timeout",
                         hint="Increase AUDIVERIS_TIMEOUT or convert fewer pages; a MusicXML export avoids OMR.") from exc
    except OSError as exc:
        raise ScoreError(f"Could not run Audiveris: {exc}", code="omr_failed", hint=AUDIVERIS_SETUP_HINT) from exc
    produced = [p for p in out.rglob("*.mxl") if before.get(p) != p.stat().st_mtime_ns]
    stderr_text = _tail(stderr_log)
    if proc.returncode != 0 or not produced:
        detail = stderr_text or _tail(stdout_log) or "(no output)"
        raise ScoreError(
            f"Audiveris failed for {pdf.name} (exit code {proc.returncode}, "
            f"{'no MusicXML produced' if not produced else 'non-zero exit'}): {detail[-1500:]}",
            code="omr_failed",
            hint="Check the logs in the output folder. Audiveris needs Java (bundled in the MSI) and a clean score PDF.",
            details={"stderr": stderr_text, "logs": [str(stdout_log), str(stderr_log)]})

    def rank(p: Path) -> tuple[int, str]:
        if p.stem == pdf.stem:
            return (0, p.name)
        if p.stem.startswith(pdf.stem):
            return (1, p.name)
        return (2, p.name)

    return sorted(produced, key=rank)[0]


# --------------------------------------------------------------------------- loading


def _decode_xml(data: bytes) -> str:
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16")
    head = data[:200].decode("ascii", "replace")
    match = re.search(r"encoding\s*=\s*[\"']([A-Za-z0-9_\-]+)[\"']", head)
    encoding = match.group(1) if match else "utf-8"
    try:
        text = data.decode("utf-8-sig" if encoding.lower().replace("_", "-") == "utf-8" else encoding)
    except (LookupError, UnicodeDecodeError) as exc:
        raise ScoreError(f"Cannot decode MusicXML text ({encoding}): {exc}", code="invalid_score") from exc
    return re.sub(r"^\s*<\?xml[^>]*\?>", "", text, count=1)


def _check_xml_text(text: str) -> None:
    if re.search(r"<!ENTITY", text, re.IGNORECASE):
        raise ScoreError("MusicXML contains DTD entity declarations, which are refused for safety.", code="invalid_score")
    if "<score-timewise" in text:
        raise ScoreError("Timewise MusicXML is not supported; export partwise MusicXML instead.", code="invalid_score")
    if "<score-partwise" not in text:
        raise ScoreError("File is not a partwise MusicXML score.", code="invalid_score")


def _read_mxl(path: Path) -> bytes:
    try:
        zf = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError) as exc:
        raise ScoreError(f"{path.name} is not a valid compressed MusicXML (.mxl) archive: {exc}", code="invalid_score") from exc
    with zf:
        infos = zf.infolist()
        if len(infos) > MAX_MXL_ENTRIES:
            raise ScoreError(f"{path.name}: archive has too many entries ({len(infos)})", code="unsafe_archive")
        total = sum(i.file_size for i in infos)
        if total > MAX_MXL_UNCOMPRESSED:
            raise ScoreError(f"{path.name}: archive expands to {total // 1024 // 1024} MB, over the limit", code="unsafe_archive")
        for info in infos:
            if info.flag_bits & 0x1:
                raise ScoreError(f"{path.name}: encrypted archives are not supported", code="unsafe_archive")
            if info.file_size > 1024 * 1024 and info.file_size > MAX_COMPRESSION_RATIO * max(info.compress_size, 1):
                raise ScoreError(f"{path.name}: suspicious compression ratio in {info.filename!r} (possible zip bomb)",
                                 code="unsafe_archive")
        by_name = {i.filename: i for i in infos}
        root: str | None = None
        container = by_name.get("META-INF/container.xml")
        if container is not None:
            with zf.open(container) as fh:
                ctext = _read_limited(fh, 1024 * 1024, "container.xml").decode("utf-8", "replace")
            for m in re.finditer(r"<rootfile\b[^>]*>", ctext):
                tag = m.group(0)
                fp = re.search(r"full-path\s*=\s*[\"']([^\"']+)[\"']", tag)
                mt = re.search(r"media-type\s*=\s*[\"']([^\"']+)[\"']", tag)
                if fp and (not mt or "musicxml" in mt.group(1) or mt.group(1).endswith("xml")):
                    root = fp.group(1)
                    break
        if root is None:
            xmls = [n for n in by_name if n.lower().endswith((".xml", ".musicxml")) and not n.startswith("META-INF/")]
            root = sorted(xmls, key=lambda n: (n.count("/"), n))[0] if xmls else None
        if root is None or root not in by_name:
            raise ScoreError(f"{path.name}: no MusicXML root file found in archive", code="invalid_score")
        if root.startswith(("/", "\\")) or ".." in root.replace("\\", "/").split("/"):
            raise ScoreError(f"{path.name}: unsafe path in archive: {root!r}", code="unsafe_archive")
        with zf.open(by_name[root]) as fh:
            return _read_limited(fh, MAX_XML_BYTES, f"{path.name}:{root}")


def load_score(path: Path):
    """Parse .xml/.musicxml/.mxl into a music21 Score with size and archive safety checks."""
    from music21 import converter, stream

    path = Path(path)
    suffix = path.suffix.lower()
    if suffix in (".xml", ".musicxml"):
        _check_file(path, MAX_XML_BYTES, "MusicXML")
        data = path.read_bytes()
    elif suffix == ".mxl":
        _check_file(path, MAX_MXL_BYTES, "MusicXML")
        data = _read_mxl(path)
    elif suffix == ".pdf":
        raise ScoreError("PDF scores must be converted to MusicXML first (convert_pdf / Audiveris).",
                         code="unsupported_format", hint=AUDIVERIS_SETUP_HINT)
    else:
        raise ScoreError(f"Unsupported score format {suffix or '(none)'}; use .musicxml, .xml or .mxl.",
                         code="unsupported_format")
    text = _decode_xml(data)
    _check_xml_text(text)
    try:
        score = converter.parseData(text, format="musicxml")
    except Exception as exc:  # noqa: BLE001 - music21 raises many exception types
        raise ScoreError(f"Could not parse MusicXML {path.name}: {exc}", code="invalid_score") from exc
    if isinstance(score, stream.Opus):
        scores = list(score.scores)
        if not scores:
            raise ScoreError(f"{path.name} contains no scores", code="invalid_score")
        score = scores[0]
    if not isinstance(score, stream.Score):
        wrapper = stream.Score()
        wrapper.insert(0, score)
        score = wrapper
    if not list(score.parts):
        raise ScoreError(f"{path.name} contains no parts", code="invalid_score")
    # music21 flattens single-voice measures; retain their original identifier.
    for source, parsed in zip(ET.fromstring(text).findall("part"), score.parts):
        for original, measure in zip(source.findall("measure"), parsed.getElementsByClass(stream.Measure)):
            voices = {n.findtext("voice", "1").strip() for n in original.findall("note")}
            if len(voices) == 1:
                measure.editorial["source_voice_id"] = next(iter(voices))
    return score

# --------------------------------------------------------------------------- part matching

_DIV = r"(iii|ii|i|[123])"
_WORD_BASES = {
    "S": r"soprano|soprani|sopranos|sopran|sopr|sop|treble|dyszkant",
    "A": r"alto|alti|altos|alt|contralto",
    "T": r"tenor|tenori|tenore|tenory|tenors|ten",
    "B": r"bass|basso|bassi|basses|bas|basy|baritone|baritono|baryton|barytony|bar",
}
_WORD_RE = re.compile(
    r"(?<![a-z])(?:" + "|".join(f"(?P<{k}>{v})" for k, v in _WORD_BASES.items()) + r")(?![a-z])"
    r"(?:\s*" + _DIV + r"(?![a-z0-9])(?:\s*[/,&+]\s*" + _DIV + r"(?![a-z0-9]))?)?")
_COMPACT_RE = re.compile(r"([satb])" + _DIV + r"?(?:[/,&+]" + _DIV + r")?")
_DIV_VALUE = {"i": 1, "1": 1, "ii": 2, "2": 2, "iii": 3, "3": 3}
_ROMAN = {1: "I", 2: "II", 3: "III"}


def _normalize(label: str) -> str:
    text = unicodedata.normalize("NFKD", label or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", re.sub(r"[._\-()]", " ", text)).strip()


def _parse_label(label: str | None) -> list[tuple[str, int | None]]:
    """Return voice slots such as [('S', 1)], [('S', 1), ('S', 2)] or [('S', None), ('A', None)]."""
    if not label:
        return []
    norm = _normalize(label)
    m = _COMPACT_RE.fullmatch(norm.replace(" ", ""))
    if m:
        base = m.group(1).upper()
        divs = [d for d in (m.group(2), m.group(3)) if d]
        return [(base, _DIV_VALUE[d]) for d in divs] or [(base, None)]
    slots: list[tuple[str, int | None]] = []
    for m in _WORD_RE.finditer(norm):
        base = next(k for k in _WORD_BASES if m.group(k))
        divs = [d for d in m.groups()[-2:] if d]
        slots += [(base, _DIV_VALUE[d]) for d in divs] or [(base, None)]
    return slots


def _code(slots: list[tuple[str, int | None]]) -> str | None:
    if not slots:
        return None
    return "/".join(base + (_ROMAN[div] if div else "") for base, div in slots)


@dataclass
class _PartInfo:
    index: int
    id: str
    name: str
    slots: list[tuple[str, int | None]]
    aliases: tuple[str, ...] = ()
    multiple_lines: bool = False
    bass_clef: bool = False

    def public(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "code": _code(self.slots)}


def _part_infos(score: Any) -> list[_PartInfo]:
    from music21 import chord, clef, stream

    infos: list[_PartInfo] = []
    used: set[str] = set()
    for index, part in enumerate(score.parts):
        inst = part.getInstrument(returnDefault=False)
        pid = (getattr(inst, "partId", None) if inst else None) or str(part.id) or f"P{index + 1}"
        if pid in used:
            pid = f"{pid}-{index + 1}"
        used.add(pid)
        name = (part.partName or (getattr(inst, "partName", None) if inst else None) or pid).strip()
        slots = (_parse_label(part.partName) or _parse_label(getattr(part, "partAbbreviation", None))
                 or _parse_label(str(part.id)))
        aliases = tuple(a for a in {str(part.id), part.partName or "", name} if a and a != pid)
        multiple_lines = (any(len(list(m.getElementsByClass(stream.Voice))) > 1
                              for m in part.getElementsByClass(stream.Measure))
                          or any(isinstance(n, chord.Chord) and len({p.ps for p in n.pitches}) > 1
                                 for n in part.recurse().notes))
        bass_clef = any(c.sign == "F" for c in part.recurse().getElementsByClass(clef.Clef))
        infos.append(_PartInfo(index, pid, name, slots, aliases, multiple_lines, bass_clef))
    return infos


def _parse_request(part: str) -> tuple[str, int | None]:
    slots = _parse_label(part)
    if len(slots) != 1:
        raise ScoreError(f"Unknown voice part {part!r}; use SI, SII, AI, AII, S, A, T or B.", code="invalid_part")
    return slots[0]


def _mode_for(slots: list[tuple[str, int | None]], slot: tuple[str, int | None]) -> str | None:
    if len(slots) <= 1:
        return None
    return "lower" if slots.index(slot) == len(slots) - 1 else "upper"


def _req_name(req: tuple[str, int | None]) -> str:
    return req[0] + (_ROMAN[req[1]] if req[1] else "")


def _select_part(infos: list[_PartInfo], part: str, part_id: str | None,
                 line_id: str | None = None) -> tuple[_PartInfo, str | None, str | None]:
    """Return (part, extraction mode, warning). Never silently guesses a different voice."""
    available = [i.public() for i in infos]
    if part_id is not None:
        match = [i for i in infos if i.id == part_id] or [i for i in infos if part_id in i.aliases]
        if len(match) > 1:
            raise PartSelectionError(f"part_id {part_id!r} matches several parts.", available)
        if not match:
            raise PartSelectionError(f"No part with id {part_id!r}.", available)
        info = match[0]
        if line_id is not None:
            return info, line_id, f"Explicit line {line_id} on staff '{info.name}'; compare with the PDF."
        try:
            req = _parse_request(part)
        except ScoreError:
            return info, None, None
        if req in info.slots:
            mode = _mode_for(info.slots, req)
            warning = (f"'{info.name}' holds several voices; using the {mode} notes for {_req_name(req)}."
                       if mode else None)
            return info, mode, warning
        if req[1] and info.slots == [(req[0], None)]:
            mode = "upper" if req[1] == 1 else "lower"
            return info, mode, (f"'{info.name}' is not split into {_req_name(req)}; where it divides, "
                                f"the {mode} note is used.")
        if not info.slots:
            if info.multiple_lines:
                raise PartSelectionError(
                    f"Staff {info.id} has no voice name and contains multiple lines/divisi. "
                    "A staff selection alone cannot identify your voice. Import corrected MusicXML "
                    "with separately named voice parts; no upper/lower line will be guessed.", available)
            return info, None, (f"Linia '{info.name}' ({info.id}) nie ma nazwy głosu. "
                                f"Używamy jej dla {_req_name(req)} zgodnie z Twoim wyborem. Sprawdź ją z PDF.")
        return info, None, (f"Part '{info.name}' was chosen explicitly by id but does not look like "
                            f"{_req_name(req)}.")

    req = _parse_request(part)
    rname = _req_name(req)

    def ambiguous(cands: list[_PartInfo]) -> PartSelectionError:
        return PartSelectionError(
            f"Part {rname} is ambiguous: {', '.join(repr(c.name) for c in cands)}. Choose one with part_id.", available)

    dedicated = [i for i in infos if i.slots == [req]]
    if len(dedicated) == 1:
        return dedicated[0], None, None
    if len(dedicated) > 1:
        raise ambiguous(dedicated)
    shared = [i for i in infos if req in i.slots]
    if len(shared) == 1:
        info = shared[0]
        mode = _mode_for(info.slots, req)
        return info, mode, (f"{rname} shares the staff '{info.name}' with other voices; using the {mode} notes "
                            "(chord tops/bottoms or voice 1/2). Check the result against the score.")
    if len(shared) > 1:
        raise ambiguous(shared)
    base, div = req
    if div is not None:
        combined = [i for i in infos if i.slots == [(base, None)]]
        if len(combined) == 1:
            info = combined[0]
            mode = "upper" if div == 1 else "lower"
            return info, mode, (f"The score has no separate {rname} part; using the combined part '{info.name}'. "
                                f"Where it divides, the {mode} note is used for {rname}.")
        if len(combined) > 1:
            raise ambiguous(combined)
        multi = [i for i in infos if (base, None) in i.slots]
        if len(multi) == 1:
            info = multi[0]
            mode = _mode_for(info.slots, (base, None))
            return info, mode, (f"The score has no separate {rname} part; using the {mode} notes of the shared "
                                f"staff '{info.name}'.")
        if len(multi) > 1:
            raise ambiguous(multi)
    else:
        divided = [i for i in infos if any(b == base and d is not None for b, d in i.slots)]
        if divided:
            raise PartSelectionError(
                f"The score divides this voice ({', '.join(repr(i.name) for i in divided)}); choose "
                f"{base}I or {base}II (or a part_id).", available)
    unlabeled = [i for i in infos if not i.slots]
    if unlabeled and len(unlabeled) == len(infos):
        layouts = {3: "SAB", 4: "SATB"}
        layout = layouts.get(len(infos), "")
        suggestion = None
        if base in layout and (len(infos) != 3 or base != "T"):
            suggestion = infos[layout.index(base)].id
        raise PartSelectionError(
            f"No part matches {rname}: the parts have no voice names ({', '.join(repr(i.name) for i in infos)}), "
            "which is common after OMR. Choose the staff with part_id (staves are listed top to bottom).",
            available, hint=(f"In a {layout} score {rname} is usually staff {suggestion}; check it against the PDF."
                             if suggestion else None),
            details={"suggested_part_id": suggestion})
    raise PartSelectionError(f"No part matches {rname}.", available)


# --------------------------------------------------------------------------- timeline preparation


@dataclass
class _Event:
    offset: float          # playback quarter offset (after repeat expansion)
    ql: float
    midi: int
    pitch: Any             # music21 Pitch (written spelling)
    bar: int
    beat: float
    written_offset: float | None
    pass_index: int
    lyric: str | None
    tie_open: bool
    chromatic: bool
    dotted: bool
    tuplet: bool
    split: bool


@dataclass
class _Measure:
    number: int
    offset: float
    length: float
    beat_dur: float
    padding: float
    written_offset: float | None
    pass_index: int


@dataclass
class _Timeline:
    events: list[_Event]
    rests: list[tuple[float, float]]
    measures: list[_Measure]
    voice_count: int

    def measure(self, number: int) -> _Measure | None:
        return next((m for m in self.measures if m.number == number), None)


@dataclass
class _Prepared:
    infos: list[_PartInfo]
    expanded_parts: list[Any]
    written_offsets: dict[int, float]
    tempo_map: list[tuple[float, float]]
    total_ql: float
    warnings: list[str]
    title: str | None
    timelines: dict[tuple[int, str | None], _Timeline] = field(default_factory=dict)
    lock: threading.Lock = field(default_factory=threading.Lock)


_CACHE: "OrderedDict[tuple[str, int, int], _Prepared]" = OrderedDict()
_CACHE_LOCK = threading.Lock()
_CACHE_SIZE = 8


def _has_repeats(score: Any) -> bool:
    from music21 import bar, repeat, spanner, stream

    for m in score.recurse().getElementsByClass(stream.Measure):
        if isinstance(m.leftBarline, bar.Repeat) or isinstance(m.rightBarline, bar.Repeat):
            return True
    return any(isinstance(el, (repeat.RepeatExpression, spanner.RepeatBracket)) for el in score.recurse())


def _prepare(path: Path) -> _Prepared:
    from music21 import stream, tempo

    path = Path(path)
    try:
        st = path.stat()
    except OSError as exc:
        raise ScoreError(f"Score file not found: {path}", code="not_found") from exc
    key = (str(path.resolve()), st.st_mtime_ns, st.st_size)
    with _CACHE_LOCK:
        if key in _CACHE:
            _CACHE.move_to_end(key)
            return _CACHE[key]
    score = load_score(path)
    warnings: list[str] = []
    if max(len(p.getElementsByClass(stream.Measure)) for p in score.parts) > MAX_MEASURES:
        raise ScoreError("Score has too many measures", code="score_too_large")
    written: dict[int, float] = {}
    for m in score.parts[0].getElementsByClass(stream.Measure):
        written.setdefault(int(m.number or 0), float(m.offset))
    expanded = score
    if _has_repeats(score):
        try:
            expanded = score.expandRepeats()
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"Repeats could not be expanded ({exc}); playback follows the written order once.")
    expanded_parts = list(expanded.parts)
    if max(len(p.getElementsByClass(stream.Measure)) for p in expanded_parts) > MAX_MEASURES:
        raise ScoreError("Score is too long after expanding repeats", code="score_too_large")

    marks: dict[float, float] = {}
    for part in expanded_parts:
        for mm in part.recurse().getElementsByClass(tempo.MetronomeMark):
            try:
                qpm = mm.getQuarterBPM()
                off = round(float(mm.getOffsetInHierarchy(part)), 6)
            except Exception:  # noqa: BLE001
                continue
            if qpm and qpm > 0 and off not in marks:
                marks[off] = float(qpm)
    tempo_map = []
    for off, qpm in sorted(marks.items()):
        if not tempo_map or abs(tempo_map[-1][1] - qpm) > 1e-9:
            tempo_map.append((off, qpm))
    if not tempo_map:
        warnings.append(f"No metronome mark in the score; assuming {DEFAULT_TEMPO:g} BPM (quarter note).")
        tempo_map = [(0.0, DEFAULT_TEMPO)]
    elif tempo_map[0][0] > 0:
        warnings.append(f"The first metronome mark appears later in the score; using {tempo_map[0][1]:g} BPM from the start.")
        tempo_map.insert(0, (0.0, tempo_map[0][1]))
    total_ql = max(float(p.highestTime) for p in expanded_parts)
    starts: dict[int, set[float]] = {}
    for part in score.parts:
        for m in part.getElementsByClass(stream.Measure):
            starts.setdefault(int(m.number or 0), set()).add(round(float(m.offset), 4))
    mismatched = [n for n, offs in starts.items() if len(offs) > 1]
    if mismatched:
        warnings.append(
            f"Parts disagree on bar positions from bar {min(mismatched)} ({len(mismatched)} bars affected); "
            "rhythms are probably mis-recognised (OMR) - entrance cues and timing may be off.")
    title = None
    if score.metadata is not None:
        title = score.metadata.title or score.metadata.movementName
    prepared = _Prepared(_part_infos(score), expanded_parts, written, tempo_map, total_ql, warnings, title)
    with _CACHE_LOCK:
        _CACHE[key] = prepared
        while len(_CACHE) > _CACHE_SIZE:
            _CACHE.popitem(last=False)
    return prepared


def _sorted_voices(measure: Any) -> list[Any]:
    def key(v: Any) -> tuple[int, str]:
        try:
            return (int(str(v.id)), "")
        except ValueError:
            return (10_000, str(v.id))
    return sorted(measure.voices, key=key)


def _lyric_text(el: Any, pass_index: int) -> str | None:
    lyrics = [ly for ly in (getattr(el, "lyrics", None) or []) if (ly.text or "").strip()]
    if not lyrics:
        return None
    lyrics.sort(key=lambda ly: ly.number or 0)
    chosen = lyrics[pass_index] if pass_index < len(lyrics) else lyrics[0]
    text = (chosen.text or "").strip()
    if text and chosen.syllabic in ("begin", "middle"):
        text += "-"
    return text or None


def _timeline(prep: _Prepared, index: int, mode: str | None) -> _Timeline:
    from music21 import chord, meter, note, stream

    with prep.lock:
        cached = prep.timelines.get((index, mode))
        if cached is not None:
            return cached
        part = prep.expanded_parts[index]
        events: list[_Event] = []
        rests: list[tuple[float, float]] = []
        measures: list[_Measure] = []
        seen: dict[int, int] = {}
        ts = meter.TimeSignature("4/4")
        ks = None
        voice_count = 1
        mlist = list(part.getElementsByClass(stream.Measure))
        for idx, m in enumerate(mlist):
            if m.timeSignature is not None:
                ts = m.timeSignature
            if m.keySignature is not None:
                ks = m.keySignature
            number = int(m.number or 0)
            pass_index = seen.get(number, 0)
            seen[number] = pass_index + 1
            m_off = float(m.offset)
            length = (float(mlist[idx + 1].offset) - m_off if idx + 1 < len(mlist)
                      else float(m.duration.quarterLength))
            bar_ql = float(ts.barDuration.quarterLength)
            padding = float(m.paddingLeft or 0.0)
            if idx == 0 and padding == 0 and 0 < length < bar_ql:
                padding = bar_ql - length
            beat_dur = float(ts.beatDuration.quarterLength) or 1.0
            w_off = prep.written_offsets.get(number)
            measures.append(_Measure(number, m_off, length, beat_dur, padding, w_off, pass_index))
            voices = _sorted_voices(m)
            voice_count = max(voice_count, len(voices) or 1)
            sources: list[tuple[float, Any]] = []
            if voices:
                chosen = (next((v for v in voices if str(v.id) == mode[6:]), None)
                          if mode and mode.startswith("voice:") else voices[-1] if mode == "lower" else voices[0])
                if chosen is not None:
                    sources.append((float(chosen.offset), chosen.getElementsByClass((note.Note, note.Rest, chord.Chord))))
            if not mode or not mode.startswith("voice:") or (
                    not voices and m.editorial.get("source_voice_id", "1") == mode[6:]):
                sources.append((0.0, m.getElementsByClass((note.Note, note.Rest, chord.Chord))))
            for base, elements in sources:
                for el in elements:
                    ql = float(el.duration.quarterLength)
                    if ql <= 0 or el.duration.isGrace:
                        continue
                    local = base + float(el.offset)
                    off = m_off + local
                    if isinstance(el, note.Rest):
                        rests.append((off, ql))
                        continue
                    tie = el.tie
                    split = False
                    if isinstance(el, chord.Chord):
                        chord_notes = sorted(el.notes, key=lambda n: n.pitch.ps)
                        if not chord_notes:
                            continue
                        if mode is not None and any(abs(float(n.duration.quarterLength) - ql) > 1e-6
                                                    for n in chord_notes):
                            raise ScoreError("Chord notes have different durations; independent layers are unsupported.",
                                             code="unsupported_polyphony")
                        picked = chord_notes[0] if mode == "lower" else chord_notes[-1]
                        pitch = picked.pitch
                        tie = picked.tie or el.tie
                        split = len({n.pitch.ps for n in chord_notes}) > 1
                        if split and mode and mode.startswith("voice:"):
                            raise ScoreError("Selected internal voice contains chords; choose an explicit upper/lower "
                                             "policy on a single-voice staff or import separated voices.",
                                             code="line_selection")
                    elif isinstance(el, note.Note):
                        pitch = el.pitch
                    else:
                        continue
                    if mode is not None and len(voices) > 1:
                        split = True
                    expected = 0.0
                    if ks is not None:
                        acc = ks.accidentalByStep(pitch.step)
                        expected = float(acc.alter) if acc is not None else 0.0
                    actual = float(pitch.accidental.alter) if pitch.accidental is not None else 0.0
                    events.append(_Event(
                        off, ql, int(round(pitch.ps)), pitch, number, 1.0 + (padding + local) / beat_dur,
                        None if w_off is None else w_off + local, pass_index, _lyric_text(el, pass_index),
                        bool(tie is not None and tie.type in ("start", "continue")),
                        abs(actual - expected) > 1e-6, el.duration.dots > 0, bool(el.duration.tuplets), split))
            if len(events) > MAX_NOTES:
                raise ScoreError(f"Too many notes in part (> {MAX_NOTES})", code="score_too_large")
        events.sort(key=lambda e: (e.offset, -e.midi if mode != "lower" else e.midi))
        merged: list[_Event] = []
        for ev in events:
            prev = merged[-1] if merged else None
            if prev is not None and abs(prev.offset - ev.offset) < 1e-9:
                if mode is not None:
                    raise ScoreError("Selected voice contains simultaneous independent layers.",
                                     code="unsupported_polyphony")
                continue  # one line only: keep the chosen (upper/lower) note at this onset
            if (mode and (mode.startswith("voice:") or mode in ("upper", "lower"))
                    and prev is not None and ev.offset < prev.offset + prev.ql - 1e-6):
                raise ScoreError("Selected line contains overlapping independent layers.",
                                 code="unsupported_polyphony")
            if (prev is not None and prev.tie_open and prev.midi == ev.midi
                    and abs(prev.offset + prev.ql - ev.offset) < 1e-6):
                prev.ql += ev.ql
                prev.tie_open = ev.tie_open
                continue
            merged.append(ev)
        rests.sort()
        result = _Timeline(merged, rests, measures, voice_count)
        prep.timelines[(index, mode)] = result
        return result


class _Clock:
    """Maps playback quarter offsets to seconds using the tempo map and tempo factor."""

    def __init__(self, tempo_map: list[tuple[float, float]], factor: float) -> None:
        self.offsets = [o for o, _ in tempo_map]
        self.qpm = [q for _, q in tempo_map]
        self.factor = factor
        self.starts = [0.0]
        for i in range(1, len(tempo_map)):
            self.starts.append(self.starts[-1] + (self.offsets[i] - self.offsets[i - 1]) * 60.0 / self.qpm[i - 1])

    def seconds(self, offset: float) -> float:
        i = max(0, bisect.bisect_right(self.offsets, offset + 1e-9) - 1)
        return (self.starts[i] + (offset - self.offsets[i]) * 60.0 / self.qpm[i]) / self.factor


def _locate(measures: list[_Measure], offset: float) -> tuple[int, float]:
    if not measures:
        return 0, 1.0
    i = max(0, bisect.bisect_right([m.offset for m in measures], offset + 1e-9) - 1)
    m = measures[i]
    return m.number, 1.0 + (m.padding + offset - m.offset) / m.beat_dur


def _transposed(pitch: Any, semitones: int) -> str:
    return (pitch.transpose(semitones) if semitones else pitch).nameWithOctave


def _validate_params(tempo_factor: float, transpose: int) -> tuple[float, int]:
    try:
        factor = float(tempo_factor)
        shift = int(transpose)
    except (TypeError, ValueError) as exc:
        raise ScoreError("tempo_factor must be a number and transpose an integer", code="invalid_parameter") from exc
    if not math.isfinite(factor) or not TEMPO_FACTOR_RANGE[0] <= factor <= TEMPO_FACTOR_RANGE[1]:
        raise ScoreError(f"tempo_factor must be between {TEMPO_FACTOR_RANGE[0]} and {TEMPO_FACTOR_RANGE[1]}",
                         code="invalid_parameter")
    if shift != transpose or not TRANSPOSE_RANGE[0] <= shift <= TRANSPOSE_RANGE[1]:
        raise ScoreError(f"transpose must be an integer between {TRANSPOSE_RANGE[0]} and {TRANSPOSE_RANGE[1]}",
                         code="invalid_parameter")
    return factor, shift

# --------------------------------------------------------------------------- analysis


def list_parts(path: Path) -> list[dict[str, Any]]:
    """Parts of a MusicXML score with detected voice codes (e.g. 'SI', 'A', 'S/A')."""
    return [i.public() for i in _prepare(Path(path)).infos]


def _line_choices(prep: _Prepared, index: int) -> list[dict[str, Any]]:
    from music21 import chord, stream

    staff = prep.expanded_parts[index]
    voice_ids: set[str] = set()
    for measure in staff.getElementsByClass(stream.Measure):
        for voice in measure.voices:
            if list(voice.notes):
                voice_ids.add(str(voice.id))
        if list(measure.notes):
            voice_ids.add(measure.editorial.get("source_voice_id", "1"))
    has_chords = any(isinstance(n, chord.Chord) and len({p.ps for p in n.pitches}) > 1
                     for n in staff.recurse().notes)
    candidates = [(f"voice:{v}", f"Głos wewnętrzny {v}") for v in sorted(voice_ids)]
    if has_chords and len(voice_ids) == 1:
        candidates += [("upper", "Górna nuta akordu"), ("lower", "Dolna nuta akordu")]
    choices = []
    for line_id, name in candidates:
        try:
            events = _timeline(prep, index, line_id).events
        except ScoreError:
            continue
        if events:
            low, high = min(events, key=lambda e: e.midi), max(events, key=lambda e: e.midi)
            choices.append({"id": line_id, "name": name, "range": {
                "low": low.pitch.nameWithOctave, "high": high.pitch.nameWithOctave,
                "low_midi": low.midi, "high_midi": high.midi}})
    return choices


def _validated_selection(prep: _Prepared, part: str, part_id: str | None,
                         line_id: str | None) -> tuple[_PartInfo, str | None, str | None]:
    if line_id is not None and part_id is None:
        raise PartSelectionError("Choose a staff with part_id before choosing line_id.",
                                 [i.public() for i in prep.infos])
    info, mode, warning = _select_part(prep.infos, part, part_id, line_id)
    if mode is None and info.multiple_lines:
        raise PartSelectionError(
            f"Staff {info.id} contains multiple lines/divisi. Choose an explicit line_id; "
            "no internal voice or chord note will be guessed.", [i.public() for i in prep.infos],
            details={"line_choices": _line_choices(prep, info.index)})
    if line_id is not None:
        choices = _line_choices(prep, info.index)
        if not any(c["id"] == line_id for c in choices):
            raise ScoreError(f"Line {line_id!r} is not an extractable monophonic choice on staff {info.id}.",
                             code="line_selection", details={"line_choices": choices})
    return info, mode, warning


def inspect_parts(path: Path, part: str) -> dict[str, Any]:
    """Inspect all staves without requiring a successful voice selection."""
    prep = _prepare(Path(path))
    parts = []
    for info, staff in zip(prep.infos, prep.expanded_parts):
        pitches = [p for n in staff.recurse().notes for p in n.pitches]
        low = min(pitches, key=lambda p: p.ps) if pitches else None
        high = max(pitches, key=lambda p: p.ps) if pitches else None
        parts.append(info.public() | {
            "staff": info.index + 1,
            "range": {"low": low.nameWithOctave, "high": high.nameWithOctave} if low and high else None,
            "multiple_lines": info.multiple_lines,
            "bass_clef": info.bass_clef,
            "line_choices": _line_choices(prep, info.index),
        })
    suggested_part_id = None
    try:
        selected, _, _ = _select_part(prep.infos, part, None)
    except PartSelectionError as exc:
        automatic_part_id = None
        suggestion = exc.details.get("suggested_part_id")
        if part == "B" and prep.infos:
            bass_staves = [i for i in prep.infos if i.bass_clef]
            suggestion = (bass_staves[-1] if bass_staves else prep.infos[-1]).id
        if suggestion and not any(i.multiple_lines for i in prep.infos):
            suggested_part_id = suggestion
    else:
        automatic_part_id = selected.id
    return {"parts": parts, "automatic_part_id": automatic_part_id, "suggested_part_id": suggested_part_id}


def _difficulty(events: list[_Event], tl: _Timeline, clock: _Clock, low: int, high: int,
                bar_numbers: list[int]) -> list[dict[str, Any]]:
    from music21 import interval

    per_bar: dict[int, list[tuple[_Event, _Event | None]]] = {n: [] for n in bar_numbers}
    prev: _Event | None = None
    for ev in events:
        if ev.pass_index == 0:
            per_bar.setdefault(ev.bar, []).append((ev, prev))
        prev = ev
    out = []
    span = high - low
    for number in bar_numbers:
        notes = per_bar.get(number, [])
        if not notes:
            out.append({"number": number, "difficulty": 0, "reasons": ["rest bar (no singing)"]})
            continue
        measure = tl.measure(number)
        beat_dur = measure.beat_dur if measure else 1.0
        score = 0.0
        reasons: list[str] = []
        biggest = None
        for ev, prv in notes:
            if prv is None or ev.offset - (prv.offset + prv.ql) >= beat_dur - 1e-9:
                continue  # first note of a phrase: no leap to sing
            leap = abs(ev.midi - prv.midi)
            if leap >= 5 and (biggest is None or leap > biggest[0]):
                biggest = (leap, prv, ev)
        if biggest:
            leap, a, b = biggest
            name = interval.Interval(noteStart=a.pitch, noteEnd=b.pitch).niceName.lower()
            score += 35 if leap >= 12 else 25 if leap >= 8 else 18 if leap == 6 else 10
            reasons.append(f"leap of a {name} ({a.pitch.nameWithOctave} to {b.pitch.nameWithOctave})")
        chromatic = [ev for ev, _ in notes if ev.chromatic]
        if chromatic:
            score += min(30, 12 * len(chromatic))
            reasons.append("accidental outside the key signature: "
                           + ", ".join(sorted({e.pitch.nameWithOctave for e in chromatic})))
        shortest = min(clock.seconds(e.offset + e.ql) - clock.seconds(e.offset) for e, _ in notes)
        if shortest < 0.2:
            score += 20
            reasons.append(f"fast notes ({shortest:.2f} s)")
        elif shortest < 0.35:
            score += 10
            reasons.append(f"quick notes ({shortest:.2f} s)")
        if any(e.dotted for e, _ in notes):
            score += 8
            reasons.append("dotted rhythm")
        if any(e.tuplet for e, _ in notes):
            score += 10
            reasons.append("tuplets")
        if any((e.beat - 1) % 1 > 1e-6 and e.ql / beat_dur > 1 - (e.beat - 1) % 1 + 1e-6 for e, _ in notes):
            score += 10
            reasons.append("syncopation (note held across the beat)")
        if measure:
            bar_seconds = clock.seconds(measure.offset + measure.length) - clock.seconds(measure.offset)
            if bar_seconds > 0 and len(notes) / bar_seconds > 4:
                score += 10
                reasons.append(f"many notes per second ({len(notes) / bar_seconds:.1f})")
        if span >= 7:
            tops = [e for e, _ in notes if e.midi >= high - 1]
            bottoms = [e for e, _ in notes if e.midi <= low + 1]
            if tops:
                score += 10
                reasons.append(f"top of your range ({tops[0].pitch.nameWithOctave})")
            if bottoms:
                score += 5
                reasons.append(f"bottom of your range ({bottoms[0].pitch.nameWithOctave})")
        if any(e.split for e, _ in notes):
            score += 10
            reasons.append("divisi: your line is one of several notes on the staff")
        out.append({"number": number, "difficulty": int(max(0, min(100, round(score)))), "reasons": reasons})
    return out


_PUNCT_RE = re.compile(r"[,.;:!?\u2026]+[\"')\]]*$")


def _breaths(events: list[_Event], tl: _Timeline, clock: _Clock) -> list[dict[str, Any]]:
    found: dict[float, dict[str, Any]] = {}

    def add(offset: float, reason: str) -> None:
        key = round(offset, 6)
        if key not in found:
            bar, beat = _locate(tl.measures, offset)
            found[key] = {"bar": bar, "beat": _round(beat, 3), "reason": reason,
                          "time": _round(clock.seconds(offset)), "playback_offset": _round(offset)}

    for ev, nxt in zip(events, events[1:]):
        end = ev.offset + ev.ql
        gap = nxt.offset - end
        if gap > 1e-6:
            bar, _ = _locate(tl.measures, end)
            measure = tl.measure(bar)
            beats = gap / (measure.beat_dur if measure else 1.0)
            add(end, f"rest ({beats:g} beat{'' if beats == 1 else 's'})")
        elif ev.lyric:
            match = _PUNCT_RE.search(ev.lyric)
            if match:
                add(end, f"punctuation '{match.group(0)[0]}' in the lyrics - shorten the note slightly to breathe")
    if events:
        bounds = sorted({events[0].offset, events[-1].offset + events[-1].ql, *found})
        for a, b in zip(bounds, bounds[1:]):
            length = clock.seconds(b) - clock.seconds(a)
            if length <= LONG_PHRASE_SECONDS:
                continue
            inside = [e for e in events if a + 1e-9 < e.offset + e.ql < b - 1e-9]
            if inside:
                mid = (a + b) / 2
                best = max(inside, key=lambda e: (e.ql, -abs(e.offset + e.ql - mid)))
                add(best.offset + best.ql, f"long phrase ({length:.0f} s) - optional catch breath after a long note")
    return sorted(found.values(), key=lambda b: b["time"])


def _entrances(events: list[_Event], tl: _Timeline, clock: _Clock, others: list[tuple[str, _Timeline]],
               shift: int) -> list[dict[str, Any]]:
    from music21 import interval

    out = []
    prev_end: float | None = None
    for ev in events:
        measure = tl.measure(ev.bar)
        beat_dur = measure.beat_dur if measure else 1.0
        rest = None if prev_end is None else ev.offset - prev_end
        prev_end = ev.offset + ev.ql
        if rest is not None and rest < beat_dur - 1e-9:
            continue
        pitch_name = _transposed(ev.pitch, shift)
        sounding: list[tuple[float, str, _Event]] = []
        before: list[tuple[float, str, _Event]] = []
        together: list[str] = []
        for name, other in others:
            for o in other.events:
                if o.offset > ev.offset + 1e-9:
                    break
                if abs(o.offset - ev.offset) < 1e-9:
                    together.append(name)
                elif o.offset + o.ql > ev.offset + 1e-9:
                    sounding.append((o.offset, name, o))
                elif ev.offset - (o.offset + o.ql) <= 4 * beat_dur:
                    before.append((o.offset, name, o))
        parts: list[str] = []
        ref = max(sounding, key=lambda x: x[0]) if sounding else max(before, key=lambda x: x[0]) if before else None
        if ref:
            _, name, o = ref
            iv = interval.Interval(noteStart=o.pitch, noteEnd=ev.pitch)
            if iv.semitones == 0:
                rel = "the same note as theirs"
            else:
                rel = f"a {iv.niceName.lower()} {'above' if iv.semitones > 0 else 'below'} their note"
            verb = "while" if sounding else "after"
            parts.append(f"{verb} {name} sing{'' if verb == 'while' else 's'} {_transposed(o.pitch, shift)} "
                         f"(bar {o.bar}, beat {o.beat:g}): start on {pitch_name}, {rel}")
        elif together:
            parts.append(f"start on {pitch_name}")
        else:
            parts.append(f"you start alone on {pitch_name}"
                         + (" - take the note from a pitch pipe" if rest is None else ""))
        if together:
            parts.append("together with " + ", ".join(sorted(set(together))))
        if rest is not None:
            beats = rest / beat_dur
            parts.append(f"after {beats:g} beat{'' if beats == 1 else 's'} of rest")
        out.append({"bar": ev.bar, "beat": _round(ev.beat, 3), "pitch": pitch_name, "cue": "; ".join(parts),
                    "time": _round(clock.seconds(ev.offset)),
                    "cue_part": ref[1] if ref else None})
    return out


def analyze(path: Path, part: str = "SI", part_id: str | None = None, tempo_factor: float = 1,
            transpose: int = 0, line_id: str | None = None) -> dict[str, Any]:
    """Analyze one voice of a MusicXML score. Schema documented in docs/SCORE_SETUP.md."""
    factor, shift = _validate_params(tempo_factor, transpose)
    prep = _prepare(Path(path))
    info, mode, warning = _validated_selection(prep, part, part_id, line_id)
    tl = _timeline(prep, info.index, mode)
    clock = _Clock(prep.tempo_map, factor)
    warnings = list(prep.warnings)
    if warning:
        warnings.insert(0, warning)
    if line_id is not None:
        warnings.append("Internal voice identifiers may change between bars in OMR. Only the chosen voice is "
                        "included; missing bars are not filled from another voice. Compare with the PDF.")
    if tl.voice_count > 1 and mode is None:
        warnings.append(f"'{info.name}' contains {tl.voice_count} voices on one staff; voice 1 (upper) is used.")
    events = tl.events
    if not events:
        raise ScoreError(f"Part '{info.name}' contains no notes.", code="empty_part")
    if shift:
        warnings.append(f"Pitches, range and practice audio are transposed by {shift:+d} semitones; the rendered "
                        "score still shows the written key unless it is transposed too.")
    if factor != 1:
        warnings.append(f"Times are scaled by tempo factor {factor:g}.")
    low = min(events, key=lambda e: e.midi)
    high = max(events, key=lambda e: e.midi)
    notes = []
    lyrics = []
    for ev in events:
        start = clock.seconds(ev.offset)
        beat = _round(ev.beat, 3)
        notes.append({
            "time": _round(start), "duration": _round(clock.seconds(ev.offset + ev.ql) - start),
            "midi": ev.midi + shift, "pitch": _transposed(ev.pitch, shift), "bar": ev.bar, "beat": beat,
            "lyric": ev.lyric,
            "offset": None if ev.written_offset is None else _round(ev.written_offset),
            "playback_offset": _round(ev.offset), "quarter_length": _round(ev.ql), "pass": ev.pass_index,
        })
        if ev.lyric:
            lyrics.append({"bar": ev.bar, "beat": beat, "text": ev.lyric, "time": _round(start)})
    first_measure: dict[int, _Measure] = {}
    for m in tl.measures:
        first_measure.setdefault(m.number, m)
    bars = _difficulty(events, tl, clock, low.midi, high.midi, list(first_measure))
    for b in bars:
        m = first_measure[b["number"]]
        start = m.written_offset if m.written_offset is not None else m.offset
        b["start_offset"] = _round(start)
        b["end_offset"] = _round(start + m.length)
        b["time"] = _round(clock.seconds(m.offset))
    others = []
    names = [i.name for i in prep.infos]
    for other in prep.infos:
        if other.index != info.index:
            otl = _timeline(prep, other.index, None)
            if otl.events:
                label = other.name if names.count(other.name) == 1 else f"{other.name} ({other.id})"
                others.append((label, otl))
    tempos = []
    for off, qpm in prep.tempo_map:
        bar, beat = _locate(tl.measures, off)
        tempos.append({"bar": bar, "beat": _round(beat, 3), "time": _round(clock.seconds(off)),
                       "bpm": _round(qpm * factor, 2)})
    return {
        "title": prep.title,
        "parts": [i.public() for i in prep.infos],
        "selected_part": {"id": info.id, "name": info.name},
        "requested_part": part,
        "line_id": line_id,
        "warning": warning,
        "range": {"low": _transposed(low.pitch, shift), "high": _transposed(high.pitch, shift),
                  "low_midi": low.midi + shift, "high_midi": high.midi + shift},
        "tempo": _round(prep.tempo_map[0][1] * factor, 2),
        "tempos": tempos,
        "tempo_factor": factor,
        "transpose": shift,
        "duration": _round(clock.seconds(prep.total_ql), 3),
        "notes": notes,
        "bars": bars,
        "breaths": _breaths(events, tl, clock),
        "entrances": _entrances(events, tl, clock, others, shift),
        "lyrics": lyrics,
        "warnings": warnings,
    }


# --------------------------------------------------------------------------- synthesis


def _render(buf: np.ndarray, start: float, duration: float, midi: int, gain: float, timbre: str) -> None:
    sr = SAMPLE_RATE
    release = 0.08
    i0 = int(start * sr)
    n = min(int((duration + release) * sr), len(buf) - i0)
    if i0 < 0 or n <= 0:
        return
    t = np.arange(n, dtype=np.float64) / sr
    freq = 440.0 * 2.0 ** ((midi - 69) / 12.0)
    if timbre == "guide":
        # soft "oo"-like tone with a light piano-style onset so repeated notes stay audible
        vibrato = 1.0 + 0.003 * np.sin(2 * np.pi * 5.0 * t) * np.clip((t - 0.25) / 0.3, 0, 1)
        phase = 2 * np.pi * freq * np.cumsum(vibrato) / sr
        tone = np.sin(phase) + 0.22 * np.sin(2 * phase) + 0.06 * np.sin(3 * phase)
        tone += 0.25 * np.sin(4 * phase) * np.exp(-t * 30)
        env = np.where(t < 0.03, t / 0.03, 0.85 + 0.15 * np.exp(-(t - 0.03) * 8))
    else:
        phase = 2 * np.pi * freq * t
        tone = np.sin(phase) + 0.45 * np.sin(2 * phase) + 0.18 * np.sin(3 * phase)
        env = np.minimum(t / 0.005, 1.0) * np.exp(-t * 2.2)
    env = np.where(t > duration, env * np.clip(1 - (t - duration) / release, 0, 1), env)
    buf[i0:i0 + n] += (gain * env * tone).astype(np.float32)


def _bass_line(prep: _Prepared, selected: int) -> tuple[int, str | None] | None:
    candidates = [i for i in prep.infos if i.index != selected and any(b == "B" for b, _ in i.slots)]
    if candidates:
        info = candidates[-1]
        return info.index, _mode_for(info.slots, next(s for s in info.slots if s[0] == "B"))
    lowest: tuple[float, int] | None = None
    for info in prep.infos:
        if info.index == selected:
            continue
        evs = _timeline(prep, info.index, None).events
        if evs:
            mean = sum(e.midi for e in evs) / len(evs)
            if lowest is None or mean < lowest[0]:
                lowest = (mean, info.index)
    return (lowest[1], None) if lowest else None


def synthesize(path: Path, output_path: Path, part: str = "SI", part_id: str | None = None,
               tempo_factor: float = 1, transpose: int = 0, include_bass: bool = False,
               line_id: str | None = None) -> Path:
    """Render the selected line as an instrumental guide (soft 'oo'/piano tone) to a mono 16-bit WAV.

    With ``include_bass`` the bass/baritone line (or the lowest other part) is mixed in quietly.
    """
    output_path = Path(output_path)
    if output_path.suffix.lower() != ".wav":
        raise ScoreError("output_path must end with .wav", code="invalid_parameter")
    factor, shift = _validate_params(tempo_factor, transpose)
    result = analyze(path, part=part, part_id=part_id, tempo_factor=factor, transpose=shift, line_id=line_id)
    total = float(result["duration"]) + 0.5
    if total > MAX_SYNTH_SECONDS:
        raise ScoreError(f"Practice audio would be {total:.0f} s long (limit {MAX_SYNTH_SECONDS:.0f} s).",
                         code="score_too_large", hint="Use a higher tempo_factor or a shorter score.")
    buf = np.zeros(int(total * SAMPLE_RATE) + 1, dtype=np.float32)
    for n in result["notes"]:
        _render(buf, n["time"], n["duration"], n["midi"], 0.6, "guide")
    if include_bass:
        prep = _prepare(Path(path))
        selected = next(i.index for i in prep.infos if i.id == result["selected_part"]["id"])
        bass = _bass_line(prep, selected)
        if bass is not None:
            clock = _Clock(prep.tempo_map, factor)
            for ev in _timeline(prep, *bass).events:
                start = clock.seconds(ev.offset)
                _render(buf, start, clock.seconds(ev.offset + ev.ql) - start, ev.midi + shift, 0.3, "piano")
    peak = float(np.max(np.abs(buf))) if buf.size else 0.0
    if peak > 0:
        buf *= 0.89 / peak
    pcm = (np.clip(buf, -1, 1) * 32767).astype("<i2")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = output_path.with_name(f"{output_path.name}.{os.getpid()}.{time.monotonic_ns()}.tmp")
    try:
        with wave.open(str(tmp), "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(pcm.tobytes())
        os.replace(tmp, output_path)
    finally:
        if tmp.exists():
            tmp.unlink()
    return output_path