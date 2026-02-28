import csv
import logging
import re
from pathlib import Path
from threading import Lock

from app.config.settings import settings

LOGGER = logging.getLogger(__name__)
PINCODE_PATTERN = re.compile(r"^\d{6}$")


class PincodeIndex:
    def __init__(self) -> None:
        self._lock = Lock()
        self._loaded = False
        self._source_path: str | None = None
        self._pincodes: set[str] = set()
        self._records: dict[str, dict[str, str]] = {}

    def ensure_loaded(self) -> None:
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return
            self._load()
            self._loaded = True

    def _load(self) -> None:
        path = _resolve_csv_path()
        if not path:
            LOGGER.warning("Pincode CSV file not found; pincode validation will reject all unknown values")
            return

        with path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                pincode = str((row or {}).get("pincode") or "").strip()
                if not PINCODE_PATTERN.fullmatch(pincode):
                    continue
                self._pincodes.add(pincode)
                if pincode not in self._records:
                    self._records[pincode] = {
                        "taluk": str((row or {}).get("Taluk") or "").strip(),
                        "district": str((row or {}).get("Districtname") or "").strip(),
                        "state": str((row or {}).get("statename") or "").strip(),
                    }

        self._source_path = str(path)
        LOGGER.info("Loaded %d pincodes from %s", len(self._pincodes), path)

    @property
    def source_path(self) -> str | None:
        self.ensure_loaded()
        return self._source_path

    @property
    def count(self) -> int:
        self.ensure_loaded()
        return len(self._pincodes)

    def contains(self, value: str | None) -> bool:
        normalized = normalize_pincode(value)
        if not normalized:
            return False
        self.ensure_loaded()
        return normalized in self._pincodes

    def get_record(self, value: str | None) -> dict[str, str] | None:
        normalized = normalize_pincode(value)
        if not normalized:
            return None
        self.ensure_loaded()
        record = self._records.get(normalized)
        if not record:
            return None
        return {"pincode": normalized, **record}


def _candidate_paths() -> list[Path]:
    paths: list[Path] = []
    configured = str(getattr(settings, "PINCODE_CSV_PATH", "") or "").strip()
    if configured:
        paths.append(Path(configured))

    paths.append(settings.BASE_DIR / "data" / "india pincode final.csv")
    paths.append(settings.BASE_DIR.parent / "india pincode final.csv")
    paths.append(Path.home() / "Downloads" / "india pincode final.csv")

    unique_paths: list[Path] = []
    seen: set[str] = set()
    for path in paths:
        resolved = str(path)
        if resolved in seen:
            continue
        seen.add(resolved)
        unique_paths.append(path)
    return unique_paths


def _resolve_csv_path() -> Path | None:
    for path in _candidate_paths():
        if path.exists() and path.is_file():
            return path
    return None


def normalize_pincode(value: str | None) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    if not PINCODE_PATTERN.fullmatch(text):
        return None
    return text


_PINCODE_INDEX = PincodeIndex()


def warmup_pincode_index() -> None:
    _PINCODE_INDEX.ensure_loaded()


def is_valid_pincode(value: str | None) -> bool:
    return _PINCODE_INDEX.contains(value)


def get_pincode_record(value: str | None) -> dict[str, str] | None:
    return _PINCODE_INDEX.get_record(value)


def get_pincode_index_info() -> dict[str, str | int | None]:
    return {
        "sourcePath": _PINCODE_INDEX.source_path,
        "count": _PINCODE_INDEX.count,
    }
