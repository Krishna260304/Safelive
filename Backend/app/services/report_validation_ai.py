from __future__ import annotations

import base64
import binascii
import math
import re
from dataclasses import dataclass

SOURCE = "heuristic_multimodal"
MIN_VALID_SCORE = 0.55
MIN_DESCRIPTION_SCORE = 0.35
MIN_IMAGE_SCORE = 0.2

CATEGORY_HINTS = {
    "pothole": ("pothole", "road", "street", "crack", "damage"),
    "waterlogging": ("waterlogging", "flood", "water", "drain", "overflow"),
    "garbage": ("garbage", "waste", "trash", "dump", "sanitation"),
    "streetlight": ("streetlight", "light", "lamp", "pole", "dark"),
    "water_leakage": ("leak", "pipe", "water", "burst", "seepage"),
    "electricity": ("electricity", "power", "wire", "spark", "transformer"),
    "drainage": ("drain", "sewer", "block", "clog", "overflow"),
    "safety": ("unsafe", "crime", "accident", "security", "danger"),
}

SUSPICIOUS_TEXT_HINTS = (
    "test report",
    "dummy report",
    "just checking",
    "ignore this",
    "fake report",
    "nothing happened",
)

LOCATION_HINTS = (
    "near",
    "road",
    "street",
    "lane",
    "market",
    "sector",
    "ward",
    "opposite",
    "beside",
    "behind",
)


@dataclass(frozen=True)
class ReportValidationPrediction:
    is_valid: bool
    confidence: float
    combined_score: float
    description_score: float
    image_score: float
    reason: str
    source: str = SOURCE


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _clean(value: str | None) -> str:
    return (value or "").strip().lower()


def _word_tokens(value: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", value)


def _normalize_image_payload(payload: str | None) -> str:
    value = (payload or "").strip()
    if not value:
        return ""
    if "," in value and "base64" in value[:60].lower():
        return value.split(",", 1)[1].strip()
    return value


def _has_known_image_signature(raw: bytes) -> bool:
    if raw.startswith(b"\xff\xd8\xff"):  # JPEG
        return True
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):  # PNG
        return True
    if raw.startswith((b"GIF87a", b"GIF89a")):  # GIF
        return True
    if raw.startswith(b"RIFF") and b"WEBP" in raw[:16]:  # WEBP
        return True
    if raw.startswith((b"BM", b"II*\x00", b"MM\x00*")):  # BMP/TIFF
        return True
    return False


def _byte_entropy(raw: bytes) -> float:
    if not raw:
        return 0.0
    sample = raw[: min(len(raw), 4096)]
    counts = [0] * 256
    for byte in sample:
        counts[byte] += 1
    total = len(sample)
    entropy = 0.0
    for count in counts:
        if not count:
            continue
        p = count / total
        entropy -= p * math.log2(p)
    return entropy


def _score_description(title: str | None, description: str | None, category: str | None) -> tuple[float, list[str]]:
    text = " ".join(part for part in [_clean(title), _clean(description)] if part).strip()
    category_value = _clean(category)
    words = _word_tokens(text)
    unique_count = len(set(words))
    word_count = len(words)
    char_count = len(text)
    score = 0.0
    reasons: list[str] = []

    if char_count >= 40:
        score += 0.35
    else:
        reasons.append("Description is too short for reliable validation.")

    if word_count >= 8:
        score += 0.3
    else:
        reasons.append("Description needs more specific detail.")

    diversity = (unique_count / word_count) if word_count else 0.0
    if diversity >= 0.5:
        score += 0.15
    elif word_count:
        score += 0.05

    if any(token in text for token in LOCATION_HINTS):
        score += 0.1
    else:
        reasons.append("Location detail is limited in the description.")

    if category_value:
        hints = CATEGORY_HINTS.get(category_value, ())
        if any(hint in text for hint in hints):
            score += 0.1
        elif hints:
            reasons.append("Text does not clearly match the selected category.")

    if re.search(r"(.)\1{6,}", text):
        score -= 0.2
        reasons.append("Description appears repetitive or noisy.")

    if any(flag in text for flag in SUSPICIOUS_TEXT_HINTS):
        score -= 0.3
        reasons.append("Description looks like a test/dummy report.")

    return _clamp(score, 0.0, 1.0), reasons


def _score_images(image_payloads: list[str] | None) -> tuple[float, list[str]]:
    payloads = image_payloads or []
    if not payloads:
        return 0.0, ["At least one incident photo is required for verification."]

    total = 0.0
    valid_images = 0
    reasons: list[str] = []

    for payload in payloads:
        normalized = _normalize_image_payload(payload)
        if not normalized:
            continue

        try:
            raw = base64.b64decode(normalized, validate=True)
        except (binascii.Error, ValueError):
            continue

        if not raw:
            continue

        valid_images += 1
        score = 0.2

        size_kb = len(raw) / 1024.0
        if size_kb >= 20:
            score += 0.25
        elif size_kb >= 10:
            score += 0.15
        else:
            score -= 0.1

        if _has_known_image_signature(raw):
            score += 0.3
        else:
            score -= 0.15

        entropy = _byte_entropy(raw)
        if entropy >= 5.2:
            score += 0.25
        elif entropy >= 4.2:
            score += 0.15
        else:
            score -= 0.1

        total += _clamp(score, 0.0, 1.0)

    if valid_images == 0:
        return 0.0, ["Incident photo is missing or invalid."]

    average = total / valid_images
    if average < 0.4:
        reasons.append("Incident photo quality is too low for confident verification.")

    return _clamp(average, 0.0, 1.0), reasons


def validate_incident_report(
    *,
    title: str | None,
    description: str | None,
    category: str | None,
    image_payloads: list[str] | None,
) -> ReportValidationPrediction:
    description_score, description_reasons = _score_description(title, description, category)
    image_score, image_reasons = _score_images(image_payloads)

    combined = _clamp((description_score * 0.6) + (image_score * 0.4), 0.0, 1.0)
    is_valid = (
        combined >= MIN_VALID_SCORE
        and description_score >= MIN_DESCRIPTION_SCORE
        and image_score >= MIN_IMAGE_SCORE
    )

    confidence = _clamp(0.5 + abs(combined - MIN_VALID_SCORE), 0.5, 0.99)
    confidence = round(confidence, 4)

    if is_valid:
        reason = "Report content and attached image appear consistent."
    else:
        reason_parts = description_reasons + image_reasons
        reason = reason_parts[0] if reason_parts else "Report requires supervisor review."

    return ReportValidationPrediction(
        is_valid=is_valid,
        confidence=confidence,
        combined_score=round(combined, 4),
        description_score=round(description_score, 4),
        image_score=round(image_score, 4),
        reason=reason,
    )
