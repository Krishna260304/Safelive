import logging
import os
import re
import threading
from dataclasses import dataclass

from app.config.settings import settings

LOGGER = logging.getLogger(__name__)

PRIORITY_LEVELS = ("low", "medium", "high", "critical")
PRIORITY_ORDER = {label: idx for idx, label in enumerate(PRIORITY_LEVELS)}

ZERO_SHOT_LABELS = {
    "low": "low priority routine civic issue with no safety risk",
    "medium": "medium priority incident that needs normal municipal response",
    "high": "high priority urgent incident with clear public safety risk",
    "critical": "critical priority emergency with immediate danger to life",
}
ZERO_SHOT_LABEL_TO_PRIORITY = {value.lower(): key for key, value in ZERO_SHOT_LABELS.items()}

CATEGORY_HINTS = {
    "fire": {"critical": 3.5, "high": 1.8},
    "emergency": {"critical": 3.2, "high": 1.7},
    "crime": {"critical": 2.4, "high": 2.0},
    "medical": {"critical": 2.8, "high": 1.8},
    "disaster": {"critical": 3.3, "high": 1.8},
    "traffic": {"high": 1.4, "medium": 1.0},
    "road": {"high": 1.2, "medium": 1.0},
    "electricity": {"high": 1.5, "medium": 1.0},
    "water": {"high": 1.3, "medium": 1.2},
    "sanitation": {"medium": 1.1, "low": 1.0},
    "waste": {"medium": 1.1, "low": 1.0},
    "maintenance": {"medium": 1.0, "low": 1.1},
}

KEYWORD_HINTS = {
    "critical": {
        "fire": 3.5,
        "building fire": 3.7,
        "large fire": 3.6,
        "house fire": 3.5,
        "structure fire": 3.6,
        "people trapped": 3.2,
        "explosion": 3.1,
        "blast": 3.1,
        "gas leak": 3.0,
        "electrocution": 3.0,
        "collapsed": 3.1,
        "collapse": 3.1,
        "building fell": 3.1,
        "not breathing": 3.2,
        "unconscious": 3.0,
        "trapped": 3.0,
        "dead": 3.1,
        "death": 3.1,
        "active shooter": 3.3,
        "shooting": 3.1,
        "stabbing": 2.8,
        "flooding fast": 2.7,
        "chemical spill": 3.1,
        "critical": 2.4,
        "severe injury": 3.0,
        "immediate danger": 3.1,
        "life threatening": 3.2,
        "multiple casualties": 3.2,
        "mass casualty": 3.2,
        "cardiac arrest": 3.1,
        "severe burns": 3.0,
    },
    "high": {
        "accident": 1.9,
        "crash": 2.0,
        "injured": 2.0,
        "injury": 1.8,
        "assault": 2.0,
        "robbery": 1.9,
        "road blocked": 1.7,
        "power outage": 1.8,
        "water outage": 1.7,
        "smoke": 1.8,
        "heavy smoke": 2.1,
        "flooding": 1.9,
        "urgent": 1.8,
        "emergency": 2.0,
        "asap": 1.7,
        "dangerous": 1.7,
        "high risk": 1.9,
    },
    "medium": {
        "pothole": 2.1,
        "large pothole": 2.3,
        "big pothole": 2.2,
        "road pothole": 2.1,
        "streetlight": 1.6,
        "broken streetlight": 1.8,
        "traffic signal": 1.7,
        "broken signal": 1.8,
        "drainage": 1.6,
        "clogged drainage": 1.8,
        "leak": 1.5,
        "water leak": 1.7,
        "overflow": 1.7,
        "garbage": 1.8,
        "garbage pile": 2.0,
        "blocked drain": 1.9,
        "water logging": 1.8,
        "broken": 1.4,
        "damaged": 1.4,
    },
    "low": {
        "graffiti": 1.9,
        "litter": 1.7,
        "minor": 1.7,
        "small": 1.4,
        "cosmetic": 1.8,
        "routine": 1.7,
        "non urgent": 2.0,
        "informational": 1.8,
        "suggestion": 1.6,
    },
}

SEVERITY_HINTS = {
    "critical": ("critical", "extreme", "severe", "very high", "life-threatening", "life threatening", "emergency"),
    "high": ("high", "major", "urgent"),
    "medium": ("medium", "moderate", "average"),
    "low": ("low", "minor"),
}

SCOPE_HINTS = {
    "critical": ("citywide", "statewide", "mass", "widespread"),
    "high": ("multiple", "multi area", "district", "major area"),
    "medium": ("local", "single area", "zone"),
}


def _clean(value: str | None) -> str:
    return (value or "").strip().lower()


def _resolve_hf_pipeline_device() -> tuple[int, str]:
    try:
        import torch  # type: ignore

        if torch.cuda.is_available():
            return 0, "cuda:0"
    except Exception as exc:
        LOGGER.debug("Torch CUDA detection failed, falling back to CPU: %s", exc)
    return -1, "cpu"


def _normalize_scores(raw: dict[str, float]) -> dict[str, float]:
    floor = 1e-6
    # Apply power scaling to make differences more pronounced (confidence boost)
    prepared = {priority: max(raw.get(priority, 0.0), 0.0) + floor for priority in PRIORITY_LEVELS}
    # Apply softmax-like scaling to increase confidence differentiation
    scaled = {priority: prepared[priority] ** 1.15 for priority in PRIORITY_LEVELS}
    total = sum(scaled.values())
    if total <= 0:
        return {priority: 1.0 / len(PRIORITY_LEVELS) for priority in PRIORITY_LEVELS}
    return {priority: scaled[priority] / total for priority in PRIORITY_LEVELS}


def _pick_priority(scores: dict[str, float]) -> str:
    return max(PRIORITY_LEVELS, key=lambda label: (scores.get(label, 0.0), PRIORITY_ORDER[label]))


@dataclass(frozen=True)
class PriorityPrediction:
    priority: str
    confidence: float
    source: str


class _ZeroShotPriorityModel:
    def __init__(self):
        self._pipeline = None
        self._load_attempted = False
        self._load_lock = threading.Lock()

    def _ensure_loaded(self):
        if self._load_attempted:
            return
        with self._load_lock:
            if self._load_attempted:
                return
            self._load_attempted = True
            if not settings.PRIORITY_AI_ENABLED:
                LOGGER.info("Incident priority AI model disabled; using heuristic scorer only.")
                return
            try:
                timeout = max(int(settings.PRIORITY_AI_REQUEST_TIMEOUT_SECONDS), 1)
                os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
                os.environ.setdefault("HF_HUB_ETAG_TIMEOUT", str(timeout))
                os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", str(timeout))
                if settings.PRIORITY_AI_OFFLINE_MODE:
                    os.environ["HF_HUB_OFFLINE"] = "1"
                else:
                    os.environ.pop("HF_HUB_OFFLINE", None)

                from transformers import pipeline  # type: ignore

                device_id, device_name = _resolve_hf_pipeline_device()
                self._pipeline = pipeline(
                    "zero-shot-classification",
                    model=settings.PRIORITY_AI_MODEL,
                    device=device_id,
                )
                LOGGER.info(
                    "Incident priority AI model loaded: %s (device=%s)",
                    settings.PRIORITY_AI_MODEL,
                    device_name,
                )
            except Exception as exc:
                LOGGER.warning(
                    "Failed to load incident priority AI model (%s). Falling back to heuristic scorer. Error: %s",
                    settings.PRIORITY_AI_MODEL,
                    exc,
                )
                self._pipeline = None

    def predict(self, text: str) -> dict[str, float] | None:
        self._ensure_loaded()
        if not self._pipeline:
            return None
        try:
            result = self._pipeline(
                sequences=text or "general civic incident",
                candidate_labels=list(ZERO_SHOT_LABELS.values()),
                hypothesis_template="This incident is {}.",
                multi_label=False,
            )
        except Exception as exc:
            LOGGER.warning("Incident priority AI inference failed, using heuristic fallback: %s", exc)
            return None

        raw: dict[str, float] = {}
        labels = result.get("labels") or []
        scores = result.get("scores") or []
        for label, score in zip(labels, scores):
            mapped = ZERO_SHOT_LABEL_TO_PRIORITY.get(_clean(label))
            if mapped in PRIORITY_LEVELS:
                raw[mapped] = float(score)

        if not raw:
            return None
        return _normalize_scores(raw)


class PriorityClassifier:
    def __init__(self):
        self._zero_shot_model = _ZeroShotPriorityModel()

    def _heuristic_scores(
        self,
        *,
        title: str | None,
        description: str | None,
        category: str | None,
        severity: str | None,
        scope: str | None,
        source: str | None,
        location: str | None,
    ) -> dict[str, float]:
        scores = {priority: 0.25 for priority in PRIORITY_LEVELS}
        text_blob = " ".join(
            part for part in [_clean(title), _clean(description), _clean(category), _clean(source), _clean(location)] if part
        )

        category_value = _clean(category)
        for token, boost in CATEGORY_HINTS.items():
            if token in category_value:
                for priority, value in boost.items():
                    scores[priority] += value
        
        # Special boost for critical categories
        critical_categories = ("fire", "emergency", "disaster")
        if any(cat in category_value for cat in critical_categories):
            scores["critical"] += 2.5
            scores["high"] = max(0.0, scores["high"] - 0.5)

        for priority, terms in KEYWORD_HINTS.items():
            for term, weight in terms.items():
                if term in text_blob:
                    scores[priority] += weight

        severity_value = _clean(severity)
        if severity_value:
            for priority, aliases in SEVERITY_HINTS.items():
                if any(alias in severity_value for alias in aliases):
                    # Increase boost for critical severity
                    boost_amount = 3.2 if priority == "critical" else 2.1
                    scores[priority] += boost_amount

        scope_value = _clean(scope)
        if scope_value:
            for priority, aliases in SCOPE_HINTS.items():
                if any(alias in scope_value for alias in aliases):
                    # Increase boost for critical scope
                    boost_amount = 2.0 if priority == "critical" else 1.4
                    scores[priority] += boost_amount

        number_match = re.search(r"\b(\d+)\s+(dead|injured|people|victims?)\b", text_blob)
        if number_match:
            count = int(number_match.group(1))
            if count >= 5:
                scores["critical"] += 3.0
                scores["high"] += 1.5
            elif count >= 3:
                scores["critical"] += 2.5
                scores["high"] += 1.2
            elif count >= 1:
                scores["high"] += 1.5
                scores["critical"] += 0.5

        if "no injury" in text_blob or "minor issue" in text_blob:
            scores["critical"] = max(0.0, scores["critical"] - 1.2)
            scores["high"] = max(0.0, scores["high"] - 0.8)
            scores["low"] += 0.8

        return _normalize_scores(scores)

    def predict(
        self,
        *,
        title: str | None,
        description: str | None,
        category: str | None,
        severity: str | None = None,
        scope: str | None = None,
        source: str | None = None,
        location: str | None = None,
    ) -> PriorityPrediction:
        text = " ".join(
            part
            for part in [
                (title or "").strip(),
                (description or "").strip(),
                f"Category {category}" if category else "",
                f"Severity {severity}" if severity else "",
                f"Scope {scope}" if scope else "",
                f"Source {source}" if source else "",
                f"Location {location}" if location else "",
            ]
            if part
        ).strip()

        heuristic = self._heuristic_scores(
            title=title,
            description=description,
            category=category,
            severity=severity,
            scope=scope,
            source=source,
            location=location,
        )
        zero_shot = self._zero_shot_model.predict(text)

        if zero_shot:
            model_weight = min(max(settings.PRIORITY_AI_MODEL_WEIGHT, 0.0), 1.0)
            heuristic_weight = 1.0 - model_weight
            combined = {
                priority: (zero_shot.get(priority, 0.0) * model_weight) + (heuristic.get(priority, 0.0) * heuristic_weight)
                for priority in PRIORITY_LEVELS
            }
            combined = _normalize_scores(combined)
            chosen = _pick_priority(combined)
            return PriorityPrediction(priority=chosen, confidence=round(combined.get(chosen, 0.0), 4), source="zero_shot_hybrid")

        chosen = _pick_priority(heuristic)
        return PriorityPrediction(priority=chosen, confidence=round(heuristic.get(chosen, 0.0), 4), source="heuristic_fallback")


_classifier = PriorityClassifier()


def predict_incident_priority(
    *,
    title: str | None,
    description: str | None,
    category: str | None,
    severity: str | None = None,
    scope: str | None = None,
    source: str | None = None,
    location: str | None = None,
) -> PriorityPrediction:
    return _classifier.predict(
        title=title,
        description=description,
        category=category,
        severity=severity,
        scope=scope,
        source=source,
        location=location,
    )


def warmup_priority_model() -> PriorityPrediction:
    prediction = _classifier.predict(
        title="Startup warmup incident",
        description="System startup warmup for incident priority model.",
        category="system",
        severity="low",
        source="startup",
        location="N/A",
    )
    LOGGER.info(
        "Incident priority model warmup completed. source=%s priority=%s confidence=%s",
        prediction.source,
        prediction.priority,
        prediction.confidence,
    )
    return prediction
