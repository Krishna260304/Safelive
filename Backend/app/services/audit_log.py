from __future__ import annotations

from datetime import datetime

from app.database import incident_logs
from app.roles import normalize_official_role
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
    log_doc = {
        "ticketId": (ticket_id or "").strip() or None,
        "incidentId": (incident_id or "").strip() or None,
        "action": (action or "").strip() or "unknown",
        "actorUserId": (actor or {}).get("id"),
        "actorName": (actor or {}).get("name") or (actor or {}).get("email") or (actor or {}).get("phone"),
        "actorOfficialRole": normalize_official_role((actor or {}).get("officialRole")),
        "createdAt": _now_iso(),
        "details": details or {},
    }
    incident_logs.insert_one(log_doc)


def get_ticket_logbook(ticket_id: str) -> list[dict]:
    rows = list(incident_logs.find({"ticketId": ticket_id}).sort("createdAt", -1))
    return serialize_list(rows)


def get_incident_logbook(incident_id: str) -> list[dict]:
    rows = list(incident_logs.find({"incidentId": incident_id}).sort("createdAt", -1))
    return serialize_list(rows)
