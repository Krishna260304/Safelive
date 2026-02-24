from __future__ import annotations

import logging
import threading
import time
from datetime import datetime

from app.config.settings import settings
from app.database import incidents, tickets
from app.services.progress_ai import predict_ticket_progress
from app.utils import to_object_id

LOGGER = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def _normalize_status(value: str | None) -> str:
    status = (value or "").strip().lower()
    if status == "verified":
        return "in_progress"
    if status in {"pending", "pending_review", "under_review"}:
        return "open"
    return status


def _has_assigned_workers(doc: dict) -> bool:
    worker_id = str(doc.get("workerId") or "").strip()
    if worker_id:
        return True

    worker_ids = doc.get("workerIds")
    if isinstance(worker_ids, list) and any(str(item or "").strip() for item in worker_ids):
        return True

    assignees = doc.get("assignees")
    if isinstance(assignees, list):
        for row in assignees:
            if not isinstance(row, dict):
                continue
            if str(row.get("workerId") or "").strip():
                return True
    return False


def _latest_note_text(doc: dict) -> str:
    summary = str(doc.get("progressSummary") or "").strip()
    if summary:
        return summary

    notes = doc.get("notes")
    if not isinstance(notes, list):
        return ""
    for row in reversed(notes):
        if isinstance(row, dict):
            note = str(row.get("note") or "").strip()
            if note:
                return note
        else:
            note = str(row or "").strip()
            if note:
                return note
    return ""


def _build_progress_context(doc: dict) -> str:
    status = _normalize_status(doc.get("status"))
    has_team = _has_assigned_workers(doc)
    latest_note = _latest_note_text(doc)

    context_parts = [
        f"title: {doc.get('title') or ''}",
        f"category: {doc.get('category') or ''}",
        f"priority: {doc.get('priority') or ''}",
        f"status: {status or 'open'}",
        "workers assigned" if has_team else "workers not assigned",
    ]
    if latest_note:
        context_parts.append(f"latest update: {latest_note}")

    return ". ".join(part for part in context_parts if part)


def _estimate_ticket_progress(doc: dict) -> tuple[int, float, str]:
    status = _normalize_status(doc.get("status"))
    has_team = _has_assigned_workers(doc)

    if status == "resolved":
        return 100, 1.0, "status_resolved"

    # Avoid fake non-zero completion before team assignment.
    if status == "open" and not has_team:
        return 0, 1.0, "awaiting_assignment"

    prediction = predict_ticket_progress(_build_progress_context(doc))
    percent = int(max(0, min(100, prediction.percent)))

    # Keep open tickets in early-progress range.
    if status == "open":
        percent = min(percent, 40)
    if has_team and status == "in_progress":
        percent = max(percent, 10)

    return percent, float(prediction.confidence), prediction.source


def _sync_incident_progress(ticket_doc: dict, percent: int, source: str, confidence: float, updated_at: str) -> None:
    incident_id = str(ticket_doc.get("incidentId") or "").strip()
    if not incident_id:
        return
    try:
        selector = {"_id": to_object_id(incident_id)}
    except Exception:
        selector = {"_id": incident_id}
    incidents.update_one(
        selector,
        {
            "$set": {
                "progressPercent": percent,
                "progressSource": source,
                "progressConfidence": confidence,
                "progressUpdatedAt": updated_at,
            }
        },
    )


def run_auto_progress_pass() -> None:
    query = {"status": {"$in": ["open", "pending", "in_progress", "resolved", "verified"]}}
    cursor = tickets.find(query)
    for doc in cursor:
        percent, confidence, source = _estimate_ticket_progress(doc)
        confidence = round(max(0.0, min(1.0, confidence)), 4)

        current_percent = int(doc.get("progressPercent") or 0)
        status = _normalize_status(doc.get("status"))
        if status in {"open", "in_progress"} and current_percent > 0:
            # Keep completion monotonic while the ticket remains active.
            percent = max(percent, current_percent)
        current_source = str(doc.get("progressSource") or "")
        current_confidence = float(doc.get("progressConfidence") or 0.0)

        if (
            current_percent == percent
            and current_source == source
            and round(current_confidence, 4) == confidence
        ):
            continue

        now = _now_iso()
        tickets.update_one(
            {"_id": doc.get("_id")},
            {
                "$set": {
                    "progressPercent": percent,
                    "progressSource": source,
                    "progressConfidence": confidence,
                    "progressUpdatedAt": now,
                }
            },
        )
        _sync_incident_progress(doc, percent, source, confidence, now)


def _worker_loop() -> None:
    interval = max(int(settings.PROGRESS_TRACKER_INTERVAL_SECONDS), 15)
    while True:
        try:
            if settings.PROGRESS_TRACKER_ENABLED:
                run_auto_progress_pass()
        except Exception as exc:
            LOGGER.warning("Auto progress tracker loop failed: %s", exc)
        time.sleep(interval)


def start_auto_progress_tracker_worker() -> None:
    if not settings.PROGRESS_TRACKER_ENABLED:
        LOGGER.info("Auto progress tracker worker disabled by configuration.")
        return
    thread = threading.Thread(target=_worker_loop, daemon=True)
    thread.start()
