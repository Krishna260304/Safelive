from __future__ import annotations

import logging
import os
import re
import threading
from dataclasses import dataclass
from typing import Any

from app.config.settings import settings

LOGGER = logging.getLogger(__name__)

MIN_PROGRESS_PERCENT = 5
MAX_PROGRESS_PERCENT = 100
PROGRESS_STEPS = tuple(range(5, 101, 5))
MIN_ZERO_SHOT_CONFIDENCE = 0.2
PROGRESS_MODEL_FALLBACKS = (
    "facebook/bart-large-mnli",
    "valhalla/distilbart-mnli-12-3",
)
REGRESSION_MARKERS = (
    "reopen",
    "re-open",
    "worsened",
    "worse",
    "failed",
    "failed repair",
    "issue again",
    "problem again",
    "not fixed",
    "work stopped",
    "work halted",
    "blocked",
)
TICKET_TYPE_HINTS: dict[str, dict[str, tuple[str, ...]]] = {
    "pothole": {
        "mid": ("excavation", "filling", "asphalt", "compaction", "patchwork"),
        "final": ("resurfacing complete", "road restored", "patch complete"),
    },
    "road": {
        "mid": ("milling", "base layer", "paving", "marking"),
        "final": ("carriageway restored", "road restored", "marking complete"),
    },
    "drainage": {
        "mid": ("desilting", "jetting", "debris removed", "chamber cleaning"),
        "final": ("flow restored", "drain cleared", "blockage removed"),
    },
    "waterlogging": {
        "mid": ("water pumping", "drain unclog", "dewatering"),
        "final": ("water cleared", "stagnation removed"),
    },
    "electricity": {
        "mid": ("cable replaced", "jointing", "pole repair", "wiring"),
        "final": ("power restored", "line energized", "streetlight restored"),
    },
    "streetlight": {
        "mid": ("fixture replaced", "wiring repaired", "driver replaced"),
        "final": ("light restored", "illumination restored"),
    },
    "water_leakage": {
        "mid": ("pipe exposed", "valve isolation", "pipe replacement"),
        "final": ("leak stopped", "pressure restored", "supply restored"),
    },
    "garbage": {
        "mid": ("waste lifted", "segregation", "transported"),
        "final": ("area cleaned", "waste removed", "sanitized"),
    },
}
PROGRESS_LABELS = {
    step: f"{step}% completion of total field work for this ticket"
    for step in PROGRESS_STEPS
}
LABEL_TO_PROGRESS = {value.lower(): key for key, value in PROGRESS_LABELS.items()}


def _round_step(value: float) -> int:
    value = max(float(MIN_PROGRESS_PERCENT), min(float(MAX_PROGRESS_PERCENT), value))
    rounded = int(round(value / 5.0) * 5)
    return max(MIN_PROGRESS_PERCENT, min(MAX_PROGRESS_PERCENT, rounded))


def _resolve_hf_pipeline_device() -> tuple[int, str]:
    try:
        import torch  # type: ignore

        if torch.cuda.is_available():
            return 0, "cuda:0"
    except Exception as exc:
        LOGGER.debug("Torch CUDA detection failed for progress model, falling back to CPU: %s", exc)
    return -1, "cpu"


def _progress_pipeline_load_attempts(device_id: int) -> list[dict[str, Any]]:
    if device_id >= 0:
        candidates = [
            {"device": device_id},
            {"device": device_id, "model_kwargs": {"low_cpu_mem_usage": False}},
            {"device": -1, "model_kwargs": {"low_cpu_mem_usage": False}},
            {"model_kwargs": {"low_cpu_mem_usage": False}},
            {},
        ]
    else:
        candidates = [
            {"device": -1},
            {"device": -1, "model_kwargs": {"low_cpu_mem_usage": False}},
            {"model_kwargs": {"low_cpu_mem_usage": False}},
            {},
        ]
    attempts: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in candidates:
        signature = repr(sorted(item.items()))
        if signature in seen:
            continue
        seen.add(signature)
        attempts.append(item)
    return attempts


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
        return MIN_PROGRESS_PERCENT
    return _round_step(value)


def _extract_history_percents(values: list[str]) -> list[int]:
    percents: list[int] = []
    for item in values:
        if not item:
            continue
        for match in re.findall(r"\b(\d{1,3})\s*%", item):
            try:
                value = int(match)
            except Exception:
                continue
            value = max(0, min(100, value))
            if value > 0:
                percents.append(_round_step(value))
    return percents


def _normalize_context(context: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(context, dict):
        return {}

    previous_raw = context.get("previousUpdates")
    previous_updates: list[str] = []
    if isinstance(previous_raw, list):
        for row in previous_raw:
            text = str(row or "").strip()
            if text:
                previous_updates.append(text)
    elif isinstance(previous_raw, tuple):
        for row in previous_raw:
            text = str(row or "").strip()
            if text:
                previous_updates.append(text)

    current_percent = None
    current_raw = context.get("currentPercent")
    try:
        if current_raw is not None and str(current_raw).strip() != "":
            current_percent = int(float(current_raw))
            current_percent = max(0, min(100, current_percent))
    except Exception:
        current_percent = None

    normalized = {
        "ticketType": str(
            context.get("ticketType")
            or context.get("category")
            or context.get("ticket_type")
            or ""
        ).strip().lower(),
        "priority": str(context.get("priority") or "").strip().lower(),
        "status": str(context.get("status") or "").strip().lower(),
        "currentPercent": current_percent,
        "previousUpdates": previous_updates[-8:],
        "reopened": bool(context.get("reopened")),
    }
    return normalized


def _context_sequence(update_text: str, context: dict[str, Any]) -> str:
    if not context:
        return update_text

    parts: list[str] = []
    ticket_type = context.get("ticketType")
    priority = context.get("priority")
    status = context.get("status")
    current_percent = context.get("currentPercent")
    previous_updates = context.get("previousUpdates") or []
    reopened = bool(context.get("reopened"))

    if ticket_type:
        parts.append(f"ticket type: {ticket_type}")
    if priority:
        parts.append(f"priority: {priority}")
    if status:
        parts.append(f"status: {status}")
    if current_percent is not None:
        parts.append(f"current progress: {int(current_percent)}%")
    if reopened:
        parts.append("ticket reopened: yes")
    if previous_updates:
        parts.append("recent updates: " + " | ".join(str(item) for item in previous_updates))
    parts.append(f"latest update: {update_text}")
    return ". ".join(part for part in parts if part)


def _status_bounds(status: str) -> tuple[int, int]:
    value = (status or "").strip().lower()
    if value in {"open", "pending"}:
        return 0, 40
    if value == "verified":
        return 10, 60
    if value == "in_progress":
        return 10, 99
    if value == "resolved":
        return 100, 100
    return 0, 100


def _is_regression_update(text: str) -> bool:
    blob = (text or "").strip().lower()
    if not blob:
        return False
    return any(marker in blob for marker in REGRESSION_MARKERS)


def _ticket_type_adjustment(text: str, ticket_type: str) -> tuple[int | None, float]:
    clean_type = (ticket_type or "").strip().lower()
    if not clean_type:
        return None, 0.0

    hints = TICKET_TYPE_HINTS.get(clean_type)
    if not hints:
        return None, 0.0

    blob = (text or "").strip().lower()
    if not blob:
        return None, 0.0

    if any(token in blob for token in hints.get("final", ())):
        return 95, 0.72
    if any(token in blob for token in hints.get("mid", ())):
        return 60, 0.64
    return None, 0.0


def _heuristic_progress(text: str, ticket_type: str | None = None) -> tuple[int, float]:
    blob = (text or "").strip().lower()
    if not blob:
        return MIN_PROGRESS_PERCENT, 0.4

    score = float(MIN_PROGRESS_PERCENT)
    has_incomplete_marker = any(
        token in blob
        for token in ("not done", "not completed", "incomplete", "pending", "remaining")
    )
    if not has_incomplete_marker and any(
        token in blob for token in ("all done", "job done", "completed all", "everything completed")
    ):
        score = max(score, 95.0)
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

    type_percent, type_conf = _ticket_type_adjustment(blob, ticket_type or "")
    if type_percent is not None:
        score = max(score, float(type_percent))
        return _round_step(score), max(0.55, type_conf)

    return _round_step(score), 0.55


def _apply_history_policy(
    *,
    predicted_percent: int,
    predicted_confidence: float,
    predicted_source: str,
    update_text: str,
    context: dict[str, Any],
) -> ProgressPrediction:
    current_percent = context.get("currentPercent")
    current_percent = int(current_percent) if isinstance(current_percent, int) else 0

    previous_updates = context.get("previousUpdates") or []
    history_percents = _extract_history_percents(previous_updates)
    history_peak = max([current_percent, *history_percents], default=0)

    status = str(context.get("status") or "")
    min_bound, max_bound = _status_bounds(status)
    reopened = bool(context.get("reopened"))
    regression = _is_regression_update(update_text)

    adjusted = int(max(0, min(100, predicted_percent)))
    source = predicted_source
    confidence = round(max(0.0, min(1.0, predicted_confidence)), 4)

    if history_peak > 0:
        if regression:
            adjusted = min(adjusted, history_peak)
            source = f"{source}_regression"
        else:
            blended = (adjusted * 0.75) + (history_peak * 0.25)
            adjusted = _round_step(blended)
            adjusted = max(adjusted, history_peak)
            if adjusted - history_peak > 35:
                adjusted = _round_step(history_peak + 35)
            source = f"{source}_history_aware"

    if reopened:
        adjusted = max(adjusted, MIN_PROGRESS_PERCENT)

    adjusted = max(min_bound, min(max_bound, adjusted))
    return ProgressPrediction(percent=adjusted, confidence=confidence, source=source)


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
                requested_model = (settings.PROGRESS_AI_MODEL or "").strip()
                model_candidates: list[str] = []
                for candidate in [requested_model, *PROGRESS_MODEL_FALLBACKS]:
                    name = (candidate or "").strip()
                    if name and name not in model_candidates:
                        model_candidates.append(name)

                last_error: Exception | None = None
                loaded_on_gpu = False
                
                for model_name in model_candidates:
                    for load_kwargs in _progress_pipeline_load_attempts(device_id):
                        current_device = load_kwargs.get("device", device_id)
                        
                        if loaded_on_gpu and current_device < 0:
                            continue
                        
                        try:
                            self._pipeline = pipeline(
                                "zero-shot-classification",
                                model=model_name,
                                trust_remote_code=True,
                                **load_kwargs,
                            )
                            loaded_device_name = device_name if current_device == device_id else "cpu"
                            LOGGER.info(
                                "Ticket progress AI model loaded: %s (device=%s)",
                                model_name,
                                loaded_device_name,
                            )
                            if current_device >= 0:
                                loaded_on_gpu = True
                            return
                        except Exception as exc:
                            last_error = exc
                            exc_str = str(exc).lower()
                            if "meta tensor" in exc_str or "cannot be called on meta tensors" in exc_str:
                                LOGGER.debug(
                                    "Meta-tensor load issue for progress model %s with args %s: %s",
                                    model_name,
                                    load_kwargs,
                                    exc,
                                )
                            continue

                self._pipeline = None
                if last_error:
                    raise last_error
                raise RuntimeError("No usable progress model candidate could be loaded")
            except Exception as exc:
                LOGGER.warning(
                    "Failed to load ticket progress AI model (%s). Falling back to heuristic scorer. Error: %s",
                    settings.PROGRESS_AI_MODEL,
                    exc,
                )
                self._pipeline = None

    def predict(self, text: str, context: dict[str, Any] | None = None) -> ProgressPrediction:
        normalized_context = _normalize_context(context)

        explicit = _extract_explicit_percent(text)
        if explicit is not None:
            return _apply_history_policy(
                predicted_percent=explicit,
                predicted_confidence=0.98,
                predicted_source="explicit_percentage",
                update_text=text,
                context=normalized_context,
            )

        self._ensure_loaded()
        model_input = _context_sequence(text, normalized_context)
        if self._pipeline:
            try:
                result = self._pipeline(
                    sequences=model_input or "field work just started",
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
                            return _apply_history_policy(
                                predicted_percent=mapped,
                                predicted_confidence=confidence,
                                predicted_source="zero_shot_pretrained",
                                update_text=text,
                                context=normalized_context,
                            )
                        heuristic_value, heuristic_confidence = _heuristic_progress(
                            model_input,
                            ticket_type=normalized_context.get("ticketType"),
                        )
                        return _apply_history_policy(
                            predicted_percent=max(mapped, heuristic_value),
                            predicted_confidence=round(max(confidence, heuristic_confidence), 4),
                            predicted_source="hybrid_low_confidence",
                            update_text=text,
                            context=normalized_context,
                        )
            except Exception as exc:
                LOGGER.warning("Ticket progress inference failed, using heuristic fallback: %s", exc)

        value, confidence = _heuristic_progress(
            model_input,
            ticket_type=normalized_context.get("ticketType"),
        )
        return _apply_history_policy(
            predicted_percent=value,
            predicted_confidence=confidence,
            predicted_source="heuristic_fallback",
            update_text=text,
            context=normalized_context,
        )


_progress_model = _ProgressModel()


def predict_ticket_progress(update_text: str, context: dict[str, Any] | None = None) -> ProgressPrediction:
    return _progress_model.predict(update_text, context=context)


def warmup_progress_model() -> ProgressPrediction:
    prediction = _progress_model.predict("Initial inspection completed and repair work started.")
    LOGGER.info(
        "Ticket progress model warmup completed. source=%s percent=%s confidence=%s",
        prediction.source,
        prediction.percent,
        prediction.confidence,
    )
    return prediction
