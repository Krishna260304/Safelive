from __future__ import annotations

import logging
import os
import re
import threading

from app.config.settings import settings
from app.services.hf_runtime import HF_MODEL_LOAD_LOCK, is_meta_tensor_error

LOGGER = logging.getLogger(__name__)

LOGBOOK_MODEL_FALLBACKS = (
    "google/flan-t5-small",
    "t5-small",
)


def _action_label(action: str | None) -> str:
    text = (action or "").strip()
    if not text:
        return "Ticket activity"
    text = text.replace("_", " ")
    return " ".join(word.capitalize() for word in text.split())


def _details_text(details: dict | None) -> str:
    if not details:
        return ""
    items: list[str] = []
    for key, value in details.items():
        if value is None:
            continue
        normalized_key = str(key or "").strip()
        if normalized_key.lower() in {"workerid", "workerids"}:
            continue
        text_value = str(value).strip()
        if not text_value:
            continue
        label = normalized_key.replace("_", " ").strip().title()
        label = label or "Detail"
        items.append(f"{label}: {text_value}")
    return " | ".join(items)


def _worker_names_text(details: dict | None) -> str:
    raw_worker_names = (details or {}).get("workerNames")
    names: list[str] = []
    if isinstance(raw_worker_names, list):
        for item in raw_worker_names:
            value = str(item or "").strip()
            if value:
                names.append(value)
    elif raw_worker_names is not None:
        value = str(raw_worker_names).strip()
        if value:
            names.append(value)

    if not names:
        return ""

    deduped: list[str] = []
    seen: set[str] = set()
    for name in names:
        lowered = name.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        deduped.append(name)

    if len(deduped) == 1:
        return deduped[0]
    if len(deduped) == 2:
        return f"{deduped[0]} and {deduped[1]}"
    return f"{', '.join(deduped[:-1])}, and {deduped[-1]}"


def _progress_percent_text(details: dict | None) -> str:
    value = (details or {}).get("progressPercent")
    try:
        if value is None:
            return ""
        return str(int(round(float(value))))
    except Exception:
        text = str(value or "").strip()
        if text.endswith("%"):
            text = text[:-1].strip()
        return text


def _actor_label(actor: dict | None) -> str:
    if not actor:
        return ""
    role = str(actor.get("officialRole") or "").strip().lower()
    name = str(actor.get("name") or actor.get("email") or actor.get("phone") or "").strip()
    if role:
        role_title = role.replace("_", " ").title()
        if name:
            return f"{name} ({role_title})"
        return role_title
    return name


def _fallback_sentence(action: str | None, details: dict | None, actor: dict | None) -> str:
    action_key = (action or "").strip().lower()
    action_text = _action_label(action)
    from_status = str((details or {}).get("fromStatus") or "").strip()
    to_status = str((details or {}).get("toStatus") or "").strip()
    if action_key == "worker_assigned_by_supervisor":
        actor_text = _actor_label(actor) or "Supervisor"
        worker_names = _worker_names_text(details)
        if worker_names:
            return f"{actor_text} approved the ticket and assigned {worker_names}."
        return f"{actor_text} approved the ticket and assigned a worker."
    if action_key in {"field_inspector_progress_update", "field_inspector_progress_update_edited"}:
        actor_text = _actor_label(actor) or "Field Inspector"
        update_text = str((details or {}).get("updateText") or "").strip()
        progress_text = _progress_percent_text(details)
        if action_key.endswith("_edited"):
            if update_text and progress_text:
                return f"{actor_text} edited field inspection update: {update_text} ({progress_text}% progress)."
            if update_text:
                return f"{actor_text} edited field inspection update: {update_text}."
            return f"{actor_text} edited the field inspection update."
        if update_text and progress_text:
            return f"{actor_text} submitted field inspection update: {update_text} ({progress_text}% progress)."
        if update_text:
            return f"{actor_text} submitted field inspection update: {update_text}."
        return f"{actor_text} submitted a field inspection update."
    actor_role = str((actor or {}).get("officialRole") or "").strip().lower()
    role_label = actor_role.replace("_", " ").title() if actor_role else ""
    if "resolved" in action_key and role_label:
        if from_status and to_status:
            return f"{role_label} resolved the ticket, moving status from {from_status} to {to_status}."
        return f"{role_label} resolved the ticket."
    if "resolved" in action_key:
        if from_status and to_status:
            return f"Ticket resolved, moving status from {from_status} to {to_status}."
        return "Ticket resolved."
    if from_status and to_status:
        return f"Ticket status changed from {from_status} to {to_status}."
    actor_text = _actor_label(actor)
    if actor_text:
        return f"{action_text} by {actor_text}."
    return f"{action_text}."


def _sanitize_generated_sentence(text: str, actor: dict | None) -> str | None:
    cleaned = " ".join(str(text or "").strip().split())
    if not cleaned:
        return None

    details_actor_match = re.match(r"(?is)^details:\s*(.+?)\s*actor:\s*(.+?)\.?$", cleaned)
    if details_actor_match:
        details_part = details_actor_match.group(1).strip().rstrip(".")
        actor_part = details_actor_match.group(2).strip().rstrip(".")
        if details_part and actor_part:
            cleaned = f"{details_part} by {actor_part}."

    cleaned = re.sub(r"(?is)^details:\s*", "", cleaned).strip()
    cleaned = re.sub(r"(?is)\s*actor:\s*([^.;]+)", lambda m: f" by {m.group(1).strip()}", cleaned).strip()
    cleaned = re.sub(r"(?is)\bis an actor\b", "", cleaned).strip()

    if re.search(r"(?is)\bactor\b", cleaned):
        return None

    if cleaned:
        cleaned = cleaned[0].upper() + cleaned[1:] if len(cleaned) > 1 else cleaned.upper()
    if cleaned and cleaned[-1] not in {".", "!", "?"}:
        cleaned = f"{cleaned}."
    if not cleaned:
        return None
    return cleaned


def _resolve_hf_model_device() -> str:
    try:
        import torch  # type: ignore

        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        return "cpu"
    return "cpu"


class _LogbookSentenceModel:
    def __init__(self):
        self._tokenizer = None
        self._model = None
        self._device = "cpu"
        self._load_attempted = False
        self._load_lock = threading.Lock()
    def _generate_text(self, prompt: str, max_new_tokens: int) -> str:
        if not self._tokenizer or not self._model:
            return ""
        inputs = self._tokenizer(
            prompt,
            return_tensors="pt",
            truncation=True,
            max_length=512,
        )
        moved_inputs = {
            key: value.to(self._device) if hasattr(value, "to") else value
            for key, value in inputs.items()
        }
        output = self._model.generate(
            **moved_inputs,
            max_new_tokens=max_new_tokens,
            do_sample=False,
        )
        return str(self._tokenizer.decode(output[0], skip_special_tokens=True) or "").strip()
    def _smoke_test_model(self) -> None:
        text = self._generate_text(
            "Rewrite as a concise logbook sentence. Action: Ticket resolved.",
            max_new_tokens=24,
        )
        if not text:
            raise RuntimeError("Logbook sentence model returned a blank generation result")

    def _ensure_loaded(self):
        if self._load_attempted:
            return
        with self._load_lock:
            if self._load_attempted:
                return
            self._load_attempted = True
            if not settings.LOGBOOK_AI_ENABLED:
                LOGGER.info("Logbook sentence model disabled; using fallback sentences only.")
                return
            try:
                timeout = max(int(settings.LOGBOOK_AI_REQUEST_TIMEOUT_SECONDS), 1)
                os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
                os.environ.setdefault("HF_HUB_ETAG_TIMEOUT", str(timeout))
                os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", str(timeout))
                if settings.LOGBOOK_AI_OFFLINE_MODE:
                    os.environ["HF_HUB_OFFLINE"] = "1"
                else:
                    os.environ.pop("HF_HUB_OFFLINE", None)

                import torch  # type: ignore
                from transformers import AutoModelForSeq2SeqLM, AutoTokenizer  # type: ignore

                device = _resolve_hf_model_device()
                requested_model = (settings.LOGBOOK_AI_MODEL or "").strip()
                model_candidates: list[str] = []
                for candidate in [requested_model, *LOGBOOK_MODEL_FALLBACKS]:
                    name = (candidate or "").strip()
                    if name and name not in model_candidates:
                        model_candidates.append(name)

                last_error: Exception | None = None
                with HF_MODEL_LOAD_LOCK:
                    for model_name in model_candidates:
                        try:
                            tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
                            model = AutoModelForSeq2SeqLM.from_pretrained(
                                model_name,
                                trust_remote_code=True,
                                low_cpu_mem_usage=False,
                            )
                            model = model.to(device)
                            model.eval()
                            self._tokenizer = tokenizer
                            self._model = model
                            self._device = device
                            self._smoke_test_model()
                            LOGGER.info("Logbook sentence model loaded: %s (device=%s)", model_name, device)
                            return
                        except Exception as exc:
                            last_error = exc
                            self._tokenizer = None
                            self._model = None
                            self._device = "cpu"
                            if is_meta_tensor_error(exc):
                                LOGGER.debug("Meta-tensor load issue for logbook model %s: %s", model_name, exc)
                            continue
                self._tokenizer = None
                self._model = None
                self._device = "cpu"
                if last_error:
                    raise last_error
                raise RuntimeError("No usable logbook sentence model candidate could be loaded")
            except Exception as exc:
                LOGGER.warning(
                    "Failed to load logbook sentence model (%s). Using fallback sentences. Error: %s",
                    settings.LOGBOOK_AI_MODEL,
                    exc,
                )
                self._tokenizer = None
                self._model = None
                self._device = "cpu"

    def generate(self, action: str | None, details: dict | None, actor: dict | None) -> str | None:
        self._ensure_loaded()
        if not self._tokenizer or not self._model:
            return None
        action_text = _action_label(action)
        details_text = _details_text(details)
        actor_text = _actor_label(actor)
        prompt_parts = [
            "Rewrite as a concise logbook sentence.",
            f"Action: {action_text}.",
        ]
        if details_text:
            prompt_parts.append(f"Details: {details_text}.")
        if actor_text:
            prompt_parts.append(f"Performed by {actor_text}.")
        prompt = " ".join(prompt_parts)
        try:
            text = self._generate_text(prompt, max_new_tokens=40)
        except Exception as exc:
            self._tokenizer = None
            self._model = None
            self._device = "cpu"
            LOGGER.warning("Logbook sentence generation failed; disabling model and using rule-based fallback: %s", exc)
            return None
        if not text:
            return None
        return _sanitize_generated_sentence(text, actor)


_sentence_model = _LogbookSentenceModel()


def generate_logbook_sentence(action: str | None, details: dict | None, actor: dict | None) -> str:
    action_key = (action or "").strip().lower()
    if action_key in {
        "worker_assigned_by_supervisor",
        "field_inspector_progress_update",
        "field_inspector_progress_update_edited",
    }:
        return _fallback_sentence(action, details, actor)
    sentence = _sentence_model.generate(action, details, actor)
    if sentence:
        return sentence
    return _fallback_sentence(action, details, actor)


def warmup_logbook_sentence_model() -> str:
    sentence = generate_logbook_sentence(
        "ticket_resolved_by_supervisor",
        {"fromStatus": "verified", "toStatus": "resolved"},
        {"officialRole": "supervisor"},
    )
    LOGGER.info("Logbook sentence model warmup completed: %s", sentence)
    return sentence
