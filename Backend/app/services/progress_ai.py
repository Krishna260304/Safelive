from __future__ import annotations

import logging
import os
import re
import threading
from dataclasses import dataclass

from app.config.settings import settings

LOGGER = logging.getLogger(__name__)

PROGRESS_STEPS = tuple(range(5, 101, 5))
MIN_ZERO_SHOT_CONFIDENCE = 0.2
PROGRESS_LABELS = {
    step: f"{step}% completion of total field work for this ticket"
    for step in PROGRESS_STEPS
}
LABEL_TO_PROGRESS = {value.lower(): key for key, value in PROGRESS_LABELS.items()}


def _round_step(value: float) -> int:
    value = max(5.0, min(100.0, value))
    rounded = int(round(value / 5.0) * 5)
    return max(5, min(100, rounded))


def _resolve_hf_pipeline_device() -> tuple[int, str]:
    try:
        import torch  # type: ignore

        if torch.cuda.is_available():
            return 0, "cuda:0"
    except Exception as exc:
        LOGGER.debug("Torch CUDA detection failed for progress model, falling back to CPU: %s", exc)
    return -1, "cpu"


def _extract_explicit_percent(text: str) -> int | None:
    if not text:
        return None
    match = re.search(r"\b(\d{1,3})\s*%\b", text)
    if not match:
        return None
    try:
        value = float(match.group(1))
    except Exception:
        return None
    value = max(0.0, min(100.0, value))
    if value <= 0:
        return 5
    return _round_step(value)


def _heuristic_progress(text: str) -> tuple[int, float]:
    blob = (text or "").strip().lower()
    if not blob:
        return 5, 0.4

    score = 5.0
    has_incomplete_marker = any(
        token in blob
        for token in ("not done", "not completed", "incomplete", "pending", "remaining")
    )
    # Common plain-language completion markers used in field updates.
    if not has_incomplete_marker and any(
        token in blob for token in ("all done", "job done", "completed all", "everything completed")
    ):
        score = max(score, 95.0)
    # High-confidence completion markers.
    if any(token in blob for token in ("fully completed", "completed", "work done", "finished")):
        score = max(score, 95.0)
    if any(token in blob for token in ("verified completed", "all tasks closed", "handover complete")):
        score = max(score, 100.0)
    if any(token in blob for token in ("almost done", "near completion", "final stage")):
        score = max(score, 85.0)
    if any(token in blob for token in ("halfway", "half done", "50 percent")):
        score = max(score, 50.0)
    if any(token in blob for token in ("started", "initial", "site visit", "inspection done")):
        score = max(score, 15.0)
    if any(token in blob for token in ("materials arranged", "procurement complete")):
        score = max(score, 30.0)
    if any(token in blob for token in ("work in progress", "ongoing", "currently working")):
        score = max(score, 40.0)
    if any(token in blob for token in ("delay", "blocked", "waiting", "pending approval")):
        score = min(score, 35.0)

    return _round_step(score), 0.55


@dataclass(frozen=True)
class ProgressPrediction:
    percent: int
    confidence: float
    source: str


class _ProgressModel:
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
            if not settings.PROGRESS_AI_ENABLED:
                LOGGER.info("Ticket progress AI model disabled; using heuristic scorer only.")
                return
            try:
                timeout = max(int(settings.PROGRESS_AI_REQUEST_TIMEOUT_SECONDS), 1)
                os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
                os.environ.setdefault("HF_HUB_ETAG_TIMEOUT", str(timeout))
                os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", str(timeout))
                if settings.PROGRESS_AI_OFFLINE_MODE:
                    os.environ["HF_HUB_OFFLINE"] = "1"
                else:
                    os.environ.pop("HF_HUB_OFFLINE", None)

                from transformers import pipeline  # type: ignore

                device_id, device_name = _resolve_hf_pipeline_device()
                self._pipeline = pipeline(
                    "zero-shot-classification",
                    model=settings.PROGRESS_AI_MODEL,
                    device=device_id,
                )
                LOGGER.info(
                    "Ticket progress AI model loaded: %s (device=%s)",
                    settings.PROGRESS_AI_MODEL,
                    device_name,
                )
            except Exception as exc:
                LOGGER.warning(
                    "Failed to load ticket progress AI model (%s). Falling back to heuristic scorer. Error: %s",
                    settings.PROGRESS_AI_MODEL,
                    exc,
                )
                self._pipeline = None

    def predict(self, text: str) -> ProgressPrediction:
        explicit = _extract_explicit_percent(text)
        if explicit is not None:
            return ProgressPrediction(percent=explicit, confidence=0.98, source="explicit_percentage")

        self._ensure_loaded()
        if self._pipeline:
            try:
                result = self._pipeline(
                    sequences=text or "field work just started",
                    candidate_labels=list(PROGRESS_LABELS.values()),
                    hypothesis_template="This update indicates {}.",
                    multi_label=False,
                )
                labels = result.get("labels") or []
                scores = result.get("scores") or []
                if labels:
                    mapped = LABEL_TO_PROGRESS.get(str(labels[0]).strip().lower())
                    if mapped:
                        confidence = float(scores[0]) if scores else 0.6
                        confidence = round(max(0.0, min(1.0, confidence)), 4)
                        if confidence >= MIN_ZERO_SHOT_CONFIDENCE:
                            return ProgressPrediction(
                                percent=mapped,
                                confidence=confidence,
                                source="zero_shot_pretrained",
                            )
                        heuristic_value, heuristic_confidence = _heuristic_progress(text)
                        return ProgressPrediction(
                            percent=max(mapped, heuristic_value),
                            confidence=round(max(confidence, heuristic_confidence), 4),
                            source="hybrid_low_confidence",
                        )
            except Exception as exc:
                LOGGER.warning("Ticket progress inference failed, using heuristic fallback: %s", exc)

        value, confidence = _heuristic_progress(text)
        return ProgressPrediction(percent=value, confidence=confidence, source="heuristic_fallback")


_progress_model = _ProgressModel()


def predict_ticket_progress(update_text: str) -> ProgressPrediction:
    return _progress_model.predict(update_text)


def warmup_progress_model() -> ProgressPrediction:
    prediction = _progress_model.predict("Initial inspection completed and repair work started.")
    LOGGER.info(
        "Ticket progress model warmup completed. source=%s percent=%s confidence=%s",
        prediction.source,
        prediction.percent,
        prediction.confidence,
    )
    return prediction
