from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, time as time_value, timedelta, timezone

from app.config.settings import settings
from app.database import tickets, users
from app.roles import normalize_official_role
from app.services.email_service import send_field_inspector_reminder_email
from app.utils import to_object_id

LOGGER = logging.getLogger(__name__)
IST = timezone(timedelta(hours=5, minutes=30))


def _parse_dt(value):
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _resolve_field_inspector_user(field_inspector_id: str | None):
    if not field_inspector_id:
        return None
    doc = None
    try:
        doc = users.find_one({"_id": to_object_id(field_inspector_id)})
    except Exception:
        doc = users.find_one({"_id": field_inspector_id})
    if not doc:
        return None
    if doc.get("userType") != "official":
        return None
    if normalize_official_role(doc.get("officialRole")) != "field_inspector":
        return None
    return doc


def _collect_recipient_inspectors(ticket_doc: dict) -> list[dict]:
    assigned = _resolve_field_inspector_user(ticket_doc.get("fieldInspectorId"))
    if assigned and assigned.get("email"):
        return [assigned]

    return list(
        users.find(
            {
                "userType": "official",
                "officialRole": "field_inspector",
                "email": {"$exists": True, "$ne": ""},
            },
            {"name": 1, "email": 1},
        )
    )


def run_inspector_reminder_pass():
    now_utc = datetime.now(timezone.utc)
    now_ist = now_utc.astimezone(IST)
    if now_ist.time() < time_value(hour=18, minute=0):
        return

    today_ist = now_ist.date()
    today_key = today_ist.isoformat()

    cursor = tickets.find({"status": "in_progress"})
    for ticket_doc in cursor:
        last_update = _parse_dt(ticket_doc.get("lastInspectorUpdateAt"))
        updated_today = bool(last_update and last_update.astimezone(IST).date() == today_ist)
        if updated_today:
            continue

        if (ticket_doc.get("inspectorReminderSentForDate") or "").strip() == today_key:
            continue

        recipients = _collect_recipient_inspectors(ticket_doc)
        if not recipients:
            continue

        ticket_id = str(ticket_doc.get("_id"))
        ticket_title = ticket_doc.get("title") or "Untitled ticket"
        sent_any = False
        for inspector in recipients:
            to_email = (inspector.get("email") or "").strip()
            if not to_email:
                continue
            inspector_name = inspector.get("name") or "Field Inspector"
            try:
                send_field_inspector_reminder_email(
                    to_email=to_email,
                    inspector_name=inspector_name,
                    ticket_id=ticket_id,
                    ticket_title=ticket_title,
                    due_date=today_key,
                )
                sent_any = True
            except Exception as exc:
                LOGGER.warning("Inspector reminder email failed for %s ticket=%s: %s", to_email, ticket_id, exc)
        if sent_any:
            tickets.update_one(
                {"_id": ticket_doc.get("_id")},
                {"$set": {"inspectorReminderSentForDate": today_key}},
            )


def _worker_loop():
    interval = max(int(settings.INSPECTOR_REMINDER_INTERVAL_SECONDS), 60)
    while True:
        try:
            if settings.INSPECTOR_REMINDER_ENABLED:
                run_inspector_reminder_pass()
        except Exception as exc:
            LOGGER.warning("Field inspector reminder loop failed: %s", exc)
        time.sleep(interval)


def start_inspector_reminder_worker():
    if not settings.INSPECTOR_REMINDER_ENABLED:
        LOGGER.info("Field inspector reminder worker disabled by configuration.")
        return
    thread = threading.Thread(target=_worker_loop, daemon=True)
    thread.start()
