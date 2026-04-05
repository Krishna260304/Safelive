from __future__ import annotations
import base64
import csv
import json
import logging
import os
import re
import threading
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from app.config.settings import settings
from app.database import incidents
from app.services.hf_runtime import (
    HF_MODEL_LOAD_LOCK,
    discard_cached_pipeline,
    get_cached_pipeline,
    get_or_create_cached_pipeline,
    is_meta_tensor_error,
)
LOGGER = logging.getLogger(__name__)
PRIORITY_LEVELS = ("low", "medium", "high")
DEFAULT_VISION_MODEL_ID = "Qwen/Qwen2.5-VL-3B-Instruct"
DEFAULT_TEXT_MODEL_ID = "facebook/bart-large-mnli"
PRIORITY_LABELS = {
    "low": "low priority civic issue with no immediate safety risk",
    "medium": "medium priority municipal issue with service disruption and timely response needed",
    "high": "high priority civic hazard with active public safety or severe blockage risk",
}
RISK_ALIASES = {
    "low": {"low", "minor", "routine"},
    "medium": {"medium", "moderate", "normal", "average"},
    "high": {"high", "major", "urgent", "emergency", "critical", "extreme"},
}
HIGH_PRIORITY_CATEGORIES = {"electricity", "safety", "drainage", "waterlogging"}
MEDIUM_PRIORITY_CATEGORIES = {"pothole", "streetlight", "water_leakage", "garbage"}
LOW_PRIORITY_CATEGORIES = {"other"}
HIGH_PRIORITY_KEYWORDS = {
    "live wire",
    "electrocution",
    "shock",
    "spark",
    "fire",
    "smoke",
    "sewage overflow",
    "open manhole",
    "collapsed",
    "blocked road",
    "accident",
    "injury",
    "flood",
    "overflow",
    "urgent",
    "critical",
    "hazard",
    "danger",
    "emergency",
}
MEDIUM_PRIORITY_KEYWORDS = {
    "pothole",
    "water leakage",
    "leakage",
    "garbage pile",
    "streetlight not working",
    "street light not working",
    "drain clogged",
    "service disruption",
    "needs repair",
}
LOW_PRIORITY_KEYWORDS = {
    "minor",
    "small",
    "routine",
    "cleaning needed",
    "non urgent",
    "non-urgent",
    "later",
}


def _severity_to_priority(value: str | None) -> str | None:
    normalized = _clean(value)
    if not normalized:
        return None
    if normalized in {"critical", "severe", "major", "high", "urgent", "emergency"}:
        return "high"
    if normalized in {"moderate", "medium", "normal"}:
        return "medium"
    if normalized in {"low", "minor", "routine"}:
        return "low"
    return None


def _text_blob(*parts: str | None) -> str:
    merged = " ".join(str(part or "").strip().lower() for part in parts if str(part or "").strip())
    return re.sub(r"\s+", " ", merged).strip()


def _keyword_hits(text: str, keywords: set[str]) -> int:
    if not text:
        return 0
    hits = 0
    for keyword in keywords:
        if keyword and keyword in text:
            hits += 1
    return hits


def _heuristic_priority_scores(
    *,
    title: str | None,
    description: str | None,
    category: str | None,
    severity: str | None,
) -> dict[str, float]:
    scores = {"low": 0.3, "medium": 0.4, "high": 0.3}
    category_label = _clean(category)
    severity_label = _severity_to_priority(severity)
    text = _text_blob(title, description)

    if category_label in HIGH_PRIORITY_CATEGORIES:
        scores["high"] += 0.35
        scores["medium"] += 0.1
    elif category_label in MEDIUM_PRIORITY_CATEGORIES:
        scores["medium"] += 0.25
    elif category_label in LOW_PRIORITY_CATEGORIES:
        scores["low"] += 0.2

    if severity_label == "high":
        scores["high"] += 0.45
        scores["medium"] += 0.1
    elif severity_label == "medium":
        scores["medium"] += 0.35
        scores["high"] += 0.05
    elif severity_label == "low":
        scores["low"] += 0.35
        scores["medium"] += 0.05

    high_hits = _keyword_hits(text, HIGH_PRIORITY_KEYWORDS)
    medium_hits = _keyword_hits(text, MEDIUM_PRIORITY_KEYWORDS)
    low_hits = _keyword_hits(text, LOW_PRIORITY_KEYWORDS)

    if high_hits > 0:
        scores["high"] += min(0.9, 0.25 * high_hits)
    if medium_hits > 0:
        scores["medium"] += min(0.45, 0.12 * medium_hits)
    if low_hits > 0 and high_hits == 0:
        scores["low"] += min(0.4, 0.12 * low_hits)

    # Do not down-rank obvious hazards even when text model is uncertain.
    if high_hits > 0 and scores["high"] < scores["medium"]:
        scores["high"] = scores["medium"] + 0.05

    normalized = _normalize_distribution(scores)
    if normalized:
        return normalized
    return {"low": 0.2, "medium": 0.6, "high": 0.2}


def _blend_distributions(
    primary: dict[str, float] | None,
    secondary: dict[str, float] | None,
    *,
    primary_weight: float,
) -> dict[str, float]:
    normalized_primary = _normalize_distribution(primary)
    normalized_secondary = _normalize_distribution(secondary)
    if not normalized_primary and not normalized_secondary:
        return {"low": 0.2, "medium": 0.6, "high": 0.2}
    if not normalized_primary:
        return normalized_secondary or {"low": 0.2, "medium": 0.6, "high": 0.2}
    if not normalized_secondary:
        return normalized_primary

    clamped_weight = max(0.0, min(1.0, float(primary_weight)))
    complement = 1.0 - clamped_weight
    merged = {
        priority: (normalized_primary[priority] * clamped_weight) + (normalized_secondary[priority] * complement)
        for priority in PRIORITY_LEVELS
    }
    return _normalize_distribution(merged) or normalized_primary
def _clean(value: str | None) -> str:
    return (value or "").strip().lower()
def _normalize_distribution(raw: dict[str, float] | None) -> dict[str, float] | None:
    if not raw:
        return None
    scores = {priority: max(float(raw.get(priority, 0.0)), 0.0) for priority in PRIORITY_LEVELS}
    total = sum(scores.values())
    if total <= 0:
        return None
    return {priority: scores[priority] / total for priority in PRIORITY_LEVELS}
def _normalize_confidence(value: object) -> float | None:
    try:
        if value is None:
            return None
        parsed = float(value)
    except Exception:
        return None
    if parsed > 1:
        parsed = parsed / 100.0
    return max(0.0, min(1.0, parsed))
def _normalize_risk(value: str | None) -> str | None:
    label = _clean(value)
    if not label:
        return None
    for priority, aliases in RISK_ALIASES.items():
        if label == priority or label in aliases:
            return priority
    for priority, aliases in RISK_ALIASES.items():
        if priority in label or any(alias in label for alias in aliases):
            return priority
    return None
def _build_priority_prompt(*, narrative: str, category: str | None) -> str:
    selected_category = _clean(category) or "unspecified"
    allowed_categories = ",".join(
        (
            "pothole",
            "waterlogging",
            "garbage",
            "streetlight",
            "water_leakage",
            "electricity",
            "drainage",
            "safety",
            "other",
        )
    )
    return f"""
You are an AI assistant for Indian smart-city civic incident triage.
Infer priority from both image and text.
Reported category: {selected_category}
Allowed categories: {allowed_categories}
Incident details: {narrative}
Priority policy:
low = minor issue, no immediate public safety risk
medium = municipal service disruption needing timely response
high = active hazard, sewage overflow, severe obstruction, electrical danger, or urgent safety risk
Return only JSON with this schema:
{{"risk":"low|medium|high","hazard":"string","reason":"string","confidence":0.0}}
""".strip()
def _resolve_hf_pipeline_device() -> tuple[int, str]:
    """Resolve the device for HuggingFace pipeline."""
    try:
        import torch
        if torch.cuda.is_available():
            return 0, "cuda:0"
    except Exception as exc:
        LOGGER.debug("Torch CUDA detection failed, falling back to CPU: %s", exc)
    return -1, "cpu"
def _set_hf_env() -> None:
    """Set HuggingFace hub environment variables."""
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    timeout = max(int(settings.PRIORITY_AI_REQUEST_TIMEOUT_SECONDS or 30), 1)
    os.environ.setdefault("HF_HUB_ETAG_TIMEOUT", str(timeout))
    os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", str(timeout))
    if settings.PRIORITY_AI_OFFLINE_MODE:
        os.environ["HF_HUB_OFFLINE"] = "1"
    else:
        os.environ.pop("HF_HUB_OFFLINE", None)
def _extract_json_payload(text: str) -> dict[str, object] | None:
    response = (text or "").strip()
    if not response:
        return None
    start = response.find("{")
    end = response.rfind("}")
    if start < 0 or end < 0 or end < start:
        return None
    snippet = response[start : end + 1]
    try:
        payload = json.loads(snippet)
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None
def _decode_base64_image(image_payload: str | None):
    payload = (image_payload or "").strip()
    if not payload:
        return None
    payload = re.sub(r"^data:image/[^;]+;base64,", "", payload, flags=re.IGNORECASE)
    try:
        raw = base64.b64decode(payload, validate=True)
    except Exception:
        return None
    try:
        from PIL import Image
        return Image.open(BytesIO(raw)).convert("RGB")
    except Exception as exc:
        LOGGER.warning("Unable to decode incident image payload: %s", exc)
        return None


def _resolve_first_image_payload(
    image_payload: str | None = None,
    image_payloads: list[str] | None = None,
) -> str | None:
    if image_payload and str(image_payload).strip():
        return str(image_payload).strip()
    for candidate in image_payloads or []:
        value = str(candidate or "").strip()
        if value:
            return value
    return None
def _resolve_hf_device() -> int:
    try:
        import torch
        if torch.cuda.is_available():
            return 0
    except Exception:
        pass
    return -1
@dataclass(frozen=True)
class PriorityPrediction:
    priority: str
    confidence: float
    source: str
class VisionPriorityModel:
    def __init__(self):
        self._processor = None
        self._model = None
        self._pipeline = None
        self._load_attempted = False
        self._lock = threading.Lock()
    def _ensure_loaded(self) -> None:
        if self._load_attempted:
            return
        with self._lock:
            if self._load_attempted:
                return
            self._load_attempted = True
            if not settings.PRIORITY_AI_ENABLED:
                return
            if not settings.PRIORITY_AI_ENABLE_VISION:
                LOGGER.info("Priority vision model disabled; using text and heuristic scoring only.")
                return
            _set_hf_env()
            model_id = (settings.PRIORITY_AI_MODEL or DEFAULT_VISION_MODEL_ID).strip() or DEFAULT_VISION_MODEL_ID
            try:
                with HF_MODEL_LOAD_LOCK:
                    import torch
                    try:
                        from transformers import AutoModel
                        from PIL import Image
                        self._model = AutoModel.from_pretrained(model_id, trust_remote_code=True)
                        LOGGER.info("Loaded priority model: %s", model_id)
                    except ImportError as e1:
                        LOGGER.debug("AutoModel import failed: %s, trying pipeline...", e1)
                        try:
                            from transformers import pipeline
                            _, device_name = _resolve_hf_pipeline_device()
                            self._pipeline = pipeline(
                                "zero-shot-classification",
                                model=DEFAULT_TEXT_MODEL_ID,
                            )
                            LOGGER.info("Loaded text classification model: %s (device=%s)", DEFAULT_TEXT_MODEL_ID, device_name)
                            return
                        except Exception as e2:
                            LOGGER.debug("Pipeline fallback failed: %s", e2)
                            raise
                    dtype = torch.float16 if torch.cuda.is_available() else torch.float32
                    try:
                        self._model = self._model.to(dtype)
                        if torch.cuda.is_available():
                            self._model = self._model.to("cuda")
                    except Exception as device_err:
                        LOGGER.debug("Device placement issue: %s", device_err)
                    self._model.eval()
                    LOGGER.info("Priority vision model ready: %s", model_id)
            except Exception as exc:
                self._processor = None
                self._model = None
                self._pipeline = None
                LOGGER.warning("Priority vision model unavailable: %s. Using heuristic fallback.", exc)
    def _move_inputs(self, inputs: dict):
        if not self._model:
            return inputs
        try:
            model_device = getattr(self._model, "device", None)
            if model_device is None:
                model_device = next(self._model.parameters()).device
        except Exception:
            return inputs
        moved: dict = {}
        for key, value in inputs.items():
            if hasattr(value, "to"):
                moved[key] = value.to(model_device)
            else:
                moved[key] = value
        return moved
    def analyze(
        self,
        *,
        title: str | None,
        description: str | None,
        category: str | None,
        image_path: str | None = None,
        image_payload: str | None = None,
        image_payloads: list[str] | None = None,
        location: str | None = None,
        severity: str | None = None,
        scope: str | None = None,
        source: str | None = None,
    ) -> dict[str, object] | None:
        if not settings.PRIORITY_AI_ENABLE_VISION:
            return None
        self._ensure_loaded()
        if not self._model or not self._processor:
            return None
        text = " ".join(
            part
            for part in [
                (title or "").strip(),
                (description or "").strip(),
                f"Location {location}" if location else "",
                f"Severity {severity}" if severity else "",
                f"Scope {scope}" if scope else "",
                f"Source {source}" if source else "",
            ]
            if part
        ).strip()
        prompt = _build_priority_prompt(narrative=text, category=category)
        image = None
        resolved_image_payload = _resolve_first_image_payload(image_payload=image_payload, image_payloads=image_payloads)
        try:
            if image_path:
                from PIL import Image
                image = Image.open(image_path).convert("RGB")
            elif resolved_image_payload:
                image = _decode_base64_image(resolved_image_payload)
            inputs = self._processor(text=prompt, images=image, return_tensors="pt")
            inputs = self._move_inputs(inputs)
            output = self._model.generate(**inputs, max_new_tokens=180)
            response = self._processor.decode(output[0], skip_special_tokens=True)
            return _extract_json_payload(response)
        except Exception as exc:
            LOGGER.warning("Vision priority inference failed: %s", exc)
            return None
class TextPriorityModel:
    def __init__(self):
        self._pipeline = None
        self._pipeline_cache_key: tuple[str, str, int] | None = None
        self._load_attempted = False
        self._lock = threading.Lock()
        self._label_to_priority = {label.lower(): priority for priority, label in PRIORITY_LABELS.items()}
    def _smoke_test_pipeline(self, candidate_pipeline) -> None:
        result = candidate_pipeline(
            sequences="Open manhole is causing a dangerous blockage on the road.",
            candidate_labels=list(PRIORITY_LABELS.values()),
            hypothesis_template="This incident is {}.",
            multi_label=False,
        )
        labels = result.get("labels") if isinstance(result, dict) else None
        scores = result.get("scores") if isinstance(result, dict) else None
        if not labels or not scores:
            raise RuntimeError("Priority text model returned an empty classification result")
    def _ensure_loaded(self) -> None:
        if self._load_attempted:
            return
        with self._lock:
            if self._load_attempted:
                return
            self._load_attempted = True
            if not settings.PRIORITY_AI_ENABLED:
                return
            _set_hf_env()
            model_id = (settings.PRIORITY_AI_TEXT_MODEL or DEFAULT_TEXT_MODEL_ID).strip() or DEFAULT_TEXT_MODEL_ID
            try:
                from transformers import pipeline
                device_id = _resolve_hf_device()
                if device_id >= 0:
                    load_attempts = [
                        {"device": device_id},
                        {"device": device_id, "model_kwargs": {"low_cpu_mem_usage": False}},
                        {"device": -1, "model_kwargs": {"low_cpu_mem_usage": False}},
                        {},
                    ]
                else:
                    load_attempts = [
                        {"device": -1},
                        {"device": -1, "model_kwargs": {"low_cpu_mem_usage": False}},
                        {},
                    ]
                last_error = None
                for load_kwargs in load_attempts:
                    current_device = load_kwargs.get("device", device_id)
                    cache_key = ("zero-shot-classification", model_id, int(current_device))
                    cached_pipeline = get_cached_pipeline(*cache_key)
                    if cached_pipeline is not None:
                        self._pipeline = cached_pipeline
                        self._pipeline_cache_key = cache_key
                        LOGGER.info(
                            "Reused shared priority text model: %s (device=%s)",
                            model_id,
                            "cuda" if current_device >= 0 else "cpu",
                        )
                        return
                    try:
                        def _loader():
                            candidate_pipeline = pipeline(
                                "zero-shot-classification",
                                model=model_id,
                                trust_remote_code=True,
                                **load_kwargs,
                            )
                            self._smoke_test_pipeline(candidate_pipeline)
                            return candidate_pipeline

                        candidate_pipeline = get_or_create_cached_pipeline(
                            "zero-shot-classification",
                            model_id,
                            current_device,
                            _loader,
                        )
                        self._pipeline = candidate_pipeline
                        self._pipeline_cache_key = cache_key
                        LOGGER.info(
                            "Loaded priority text model: %s (device=%s)",
                            model_id,
                            "cuda" if current_device >= 0 else "cpu",
                        )
                        return
                    except Exception as exc:
                        last_error = exc
                        self._pipeline = None
                        self._pipeline_cache_key = None
                        if is_meta_tensor_error(exc):
                            LOGGER.debug("Meta-tensor load issue with args %s: %s", load_kwargs, exc)
                        continue
                self._pipeline = None
                self._pipeline_cache_key = None
                if last_error:
                    raise last_error
            except Exception as exc:
                self._pipeline = None
                self._pipeline_cache_key = None
                LOGGER.warning("Priority text model unavailable: %s", exc)
    def predict_scores(self, text: str) -> dict[str, float] | None:
        self._ensure_loaded()
        if not self._pipeline:
            return None
        try:
            result = self._pipeline(
                sequences=text or "municipal incident",
                candidate_labels=list(PRIORITY_LABELS.values()),
                hypothesis_template="This incident is {}.",
                multi_label=False,
            )
        except Exception as exc:
            if self._pipeline_cache_key:
                discard_cached_pipeline(*self._pipeline_cache_key)
                self._pipeline_cache_key = None
            self._pipeline = None
            LOGGER.warning("Text priority inference failed; disabling text model and using heuristic fallback: %s", exc)
            return None
        labels = result.get("labels") or []
        scores = result.get("scores") or []
        raw: dict[str, float] = {}
        for label, score in zip(labels, scores):
            mapped = self._label_to_priority.get(_clean(str(label)))
            if mapped in PRIORITY_LEVELS:
                raw[mapped] = float(score)
        return _normalize_distribution(raw)
class DatasetPriorityModel:
    def __init__(self):
        self._vectorizer = None
        self._classifier = None
        self._load_attempted = False
        self._lock = threading.Lock()
    def _build_text(self, row: dict[str, object]) -> str:
        return " ".join(
            part
            for part in [
                str(row.get("title") or "").strip(),
                str(row.get("description") or "").strip(),
                f"Category {row.get('category')}" if row.get("category") else "",
                f"Location {row.get('location')}" if row.get("location") else "",
                f"Severity {row.get('severity')}" if row.get("severity") else "",
                f"Scope {row.get('scope')}" if row.get("scope") else "",
            ]
            if part
        ).strip()
    def _collect_mongo_rows(self) -> tuple[list[str], list[str]]:
        texts: list[str] = []
        labels: list[str] = []
        limit = max(int(settings.PRIORITY_AI_MAX_TRAIN_ROWS), 200)
        cursor = incidents.find(
            {"priority": {"$in": list(PRIORITY_LEVELS)}},
            {"title": 1, "description": 1, "category": 1, "location": 1, "severity": 1, "scope": 1, "priority": 1},
        ).sort("updatedAt", -1)
        for row in cursor.limit(limit):
            label = _clean(str(row.get("priority") or ""))
            if label not in PRIORITY_LEVELS:
                continue
            text = self._build_text(row)
            if not text:
                continue
            texts.append(text)
            labels.append(label)
        return texts, labels
    def _collect_external_rows(self) -> tuple[list[str], list[str]]:
        dataset_path = (settings.PRIORITY_AI_EXTERNAL_DATASET or "").strip()
        if not dataset_path:
            return [], []
        file_path = Path(dataset_path)
        if not file_path.exists():
            LOGGER.warning("External priority dataset not found: %s", dataset_path)
            return [], []
        texts: list[str] = []
        labels: list[str] = []
        try:
            if file_path.suffix.lower() == ".jsonl":
                with file_path.open("r", encoding="utf-8") as handle:
                    for line in handle:
                        try:
                            row = json.loads(line)
                        except Exception:
                            continue
                        if not isinstance(row, dict):
                            continue
                        label = _clean(str(row.get("priority") or row.get("label") or ""))
                        if label not in PRIORITY_LEVELS:
                            continue
                        text = self._build_text(row) or str(row.get("text") or "").strip()
                        if not text:
                            continue
                        texts.append(text)
                        labels.append(label)
            elif file_path.suffix.lower() == ".csv":
                with file_path.open("r", encoding="utf-8", newline="") as handle:
                    reader = csv.DictReader(handle)
                    for row in reader:
                        label = _clean(str(row.get("priority") or row.get("label") or ""))
                        if label not in PRIORITY_LEVELS:
                            continue
                        text = self._build_text(row) or str(row.get("text") or "").strip()
                        if not text:
                            continue
                        texts.append(text)
                        labels.append(label)
        except Exception as exc:
            LOGGER.warning("Failed to load external priority dataset: %s", exc)
        return texts, labels
    def _ensure_loaded(self) -> None:
        if self._load_attempted:
            return
        with self._lock:
            if self._load_attempted:
                return
            self._load_attempted = True
            if not settings.PRIORITY_AI_ENABLE_DATASET_MODEL:
                return
            try:
                from sklearn.feature_extraction.text import TfidfVectorizer
                from sklearn.linear_model import LogisticRegression
            except Exception as exc:
                LOGGER.warning("scikit-learn unavailable for dataset priority model: %s", exc)
                return
            mongo_texts, mongo_labels = self._collect_mongo_rows()
            ext_texts, ext_labels = self._collect_external_rows()
            texts = mongo_texts + ext_texts
            labels = mongo_labels + ext_labels
            min_samples = max(int(settings.PRIORITY_AI_MIN_TRAIN_SAMPLES), 30)
            if len(texts) < min_samples:
                LOGGER.info("Dataset priority model skipped. samples=%s required=%s", len(texts), min_samples)
                return
            try:
                vectorizer = TfidfVectorizer(ngram_range=(1, 2), min_df=2, max_features=60000)
                matrix = vectorizer.fit_transform(texts)
                classifier = LogisticRegression(max_iter=1600, class_weight="balanced")
                classifier.fit(matrix, labels)
                self._vectorizer = vectorizer
                self._classifier = classifier
                LOGGER.info("Dataset priority model trained. samples=%s", len(texts))
            except Exception as exc:
                self._vectorizer = None
                self._classifier = None
                LOGGER.warning("Dataset priority model training failed: %s", exc)
    def predict_scores(self, text: str) -> dict[str, float] | None:
        self._ensure_loaded()
        if not self._vectorizer or not self._classifier:
            return None
        try:
            matrix = self._vectorizer.transform([text or "municipal incident"])
            probabilities = self._classifier.predict_proba(matrix)[0]
            classes = list(self._classifier.classes_)
            raw = {priority: 0.0 for priority in PRIORITY_LEVELS}
            for label, value in zip(classes, probabilities):
                key = _clean(str(label))
                if key in raw:
                    raw[key] = float(value)
            return _normalize_distribution(raw)
        except Exception as exc:
            LOGGER.warning("Dataset priority inference failed: %s", exc)
            return None
class PriorityClassifier:
    def __init__(self):
        self._vision_model = VisionPriorityModel()
        self._text_model = TextPriorityModel()
        self._dataset_model = DatasetPriorityModel()
    def _build_text(
        self,
        *,
        title: str | None,
        description: str | None,
        category: str | None,
        severity: str | None,
        scope: str | None,
        source: str | None,
        location: str | None,
    ) -> str:
        return " ".join(
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
    def _combine_scores(
        self,
        *,
        vision_scores: dict[str, float] | None,
        text_scores: dict[str, float] | None,
        dataset_scores: dict[str, float] | None,
    ) -> tuple[dict[str, float], str]:
        weighted = {priority: 0.0 for priority in PRIORITY_LEVELS}
        parts: list[tuple[str, float, dict[str, float] | None]] = [
            ("vision", float(settings.PRIORITY_AI_VISION_WEIGHT), vision_scores),
            ("text", float(settings.PRIORITY_AI_TEXT_WEIGHT), text_scores),
            ("dataset", float(settings.PRIORITY_AI_DATASET_WEIGHT), dataset_scores),
        ]
        used_sources: list[str] = []
        weight_sum = 0.0
        for name, weight, scores in parts:
            normalized = _normalize_distribution(scores)
            if not normalized or weight <= 0:
                continue
            for priority in PRIORITY_LEVELS:
                weighted[priority] += normalized[priority] * weight
            weight_sum += weight
            used_sources.append(name)
        if weight_sum <= 0:
            return {priority: 1.0 / len(PRIORITY_LEVELS) for priority in PRIORITY_LEVELS}, "default"
        combined = {priority: weighted[priority] / weight_sum for priority in PRIORITY_LEVELS}
        return combined, "+".join(used_sources)
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
        image_path: str | None = None,
        image_payload: str | None = None,
        image_payloads: list[str] | None = None,
    ) -> PriorityPrediction:
        resolved_image_payload = _resolve_first_image_payload(
            image_payload=image_payload,
            image_payloads=image_payloads,
        )
        has_image_context = settings.PRIORITY_AI_ENABLE_VISION and bool((image_path or "").strip() or resolved_image_payload)
        text = self._build_text(
            title=title,
            description=description,
            category=category,
            severity=severity,
            scope=scope,
            source=source,
            location=location,
        )
        vision_payload = None
        if has_image_context:
            vision_payload = self._vision_model.analyze(
                title=title,
                description=description,
                category=category,
                image_path=image_path,
                image_payload=resolved_image_payload,
                image_payloads=image_payloads,
                location=location,
                severity=severity,
                scope=scope,
                source=source,
            )
        vision_scores = None
        if vision_payload:
            risk = _normalize_risk(str(vision_payload.get("risk") or vision_payload.get("priority") or ""))
            confidence = _normalize_confidence(vision_payload.get("confidence"))
            if risk:
                c = confidence if confidence is not None else 0.85
                c = max(0.34, min(0.99, c))
                spill = (1.0 - c) / max(len(PRIORITY_LEVELS) - 1, 1)
                vision_scores = {priority: spill for priority in PRIORITY_LEVELS}
                vision_scores[risk] = c
            elif isinstance(vision_payload.get("scores"), dict):
                parsed_scores: dict[str, float] = {}
                for key, value in vision_payload.get("scores", {}).items():
                    mapped = _normalize_risk(str(key))
                    if mapped:
                        try:
                            parsed_scores[mapped] = parsed_scores.get(mapped, 0.0) + float(value)
                        except Exception:
                            continue
                vision_scores = _normalize_distribution(parsed_scores)
        text_scores = self._text_model.predict_scores(text)
        dataset_scores = self._dataset_model.predict_scores(text)
        heuristic_scores = _heuristic_priority_scores(
            title=title,
            description=description,
            category=category,
            severity=severity,
        )
        combined, source_name = self._combine_scores(
            vision_scores=vision_scores,
            text_scores=text_scores,
            dataset_scores=dataset_scores,
        )
        if source_name == "default":
            combined = heuristic_scores
            source_name = "heuristic"
        else:
            # Blend model output with rule-guarded heuristics to reduce obvious misclassifications.
            combined = _blend_distributions(combined, heuristic_scores, primary_weight=0.72)
            source_name = f"{source_name}+heuristic_guard"

        chosen = max(PRIORITY_LEVELS, key=lambda priority: combined.get(priority, 0.0))
        confidence = round(max(0.0, min(1.0, combined.get(chosen, 0.0))), 4)
        return PriorityPrediction(priority=chosen, confidence=confidence, source=source_name)
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
    image_path: str | None = None,
    image_payload: str | None = None,
    image_payloads: list[str] | None = None,
) -> PriorityPrediction:
    return _classifier.predict(
        title=title,
        description=description,
        category=category,
        severity=severity,
        scope=scope,
        source=source,
        location=location,
        image_path=image_path,
        image_payload=image_payload,
        image_payloads=image_payloads,
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
