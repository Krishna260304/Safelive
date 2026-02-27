from __future__ import annotations

from datetime import datetime

from app.database import incident_logs
from app.roles import normalize_official_role
from app.services.logbook_sentence_ai import generate_logbook_sentence
from app.utils import to_object_id
from app.utils import serialize_list


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def append_incident_log(
    *,
    ticket_id: str | None,
    incident_id: str | None,
    action: str,
    actor: dict | None,
    details: dict | None = None,
) -> None:
    summary = generate_logbook_sentence(action, details, actor)
    log_doc = {
        "ticketId": (ticket_id or "").strip() or None,
        "incidentId": (incident_id or "").strip() or None,
        "action": (action or "").strip() or "unknown",
        "actorUserId": (actor or {}).get("id"),
        "actorName": (actor or {}).get("name") or (actor or {}).get("email") or (actor or {}).get("phone"),
        "actorOfficialRole": normalize_official_role((actor or {}).get("officialRole")),
        "createdAt": _now_iso(),
        "summary": summary,
        "details": details or {},
    }
    incident_logs.insert_one(log_doc)


def get_ticket_logbook(ticket_id: str) -> list[dict]:
    selectors = [{"ticketId": ticket_id}]
    try:
        selectors.append({"ticketId": to_object_id(ticket_id)})
    except Exception:
        pass
    rows = list(incident_logs.find({"$or": selectors}).sort("createdAt", -1))
    return serialize_list(rows)


def get_incident_logbook(incident_id: str) -> list[dict]:
    selectors = [{"incidentId": incident_id}]
    try:
        selectors.append({"incidentId": to_object_id(incident_id)})
    except Exception:
        pass
    rows = list(incident_logs.find({"$or": selectors}).sort("createdAt", -1))
    return serialize_list(rows)
