from datetime import datetime, timedelta, timezone
import logging
from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user, get_official_user, is_official_account
from app.database import incident_logs, incidents, tickets, users
from app.models import TicketAssign, TicketAssignSupervisor, TicketProgressUpdate, TicketUpdateStatus
from app.roles import normalize_official_role
from app.services.audit_log import append_incident_log, get_ticket_logbook
from app.services.email_service import send_ticket_update_email
from app.services.notification_service import send_sms, send_whatsapp
from app.services.progress_ai import predict_ticket_progress
from app.utils import serialize_doc, serialize_list, to_object_id

router = APIRouter(prefix="/api/tickets")
LOGGER = logging.getLogger(__name__)

ROLE_DEPARTMENT = "department"
ROLE_SUPERVISOR = "supervisor"
ROLE_FIELD_INSPECTOR = "field_inspector"
ROLE_WORKER = "worker"
TICKET_STATUSES = {"open", "pending", "in_progress", "verified", "resolved"}
FIELD_INSPECTOR_EDIT_WINDOW_MINUTES = 10
FIELD_INSPECTOR_VISIBLE_STATUSES = {"open", "pending", "verified", "in_progress", "resolved"}
FIELD_INSPECTOR_EDITABLE_STATUSES = {"open", "pending", "verified", "in_progress"}
FIELD_INSPECTOR_NOTE_PREFIXES = (
    "field inspector update",
    "field inspector progress update",
)


def _now_iso():
    return datetime.utcnow().isoformat()


def _parse_iso_datetime(value: str | None) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    normalized = raw.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _field_inspector_edit_window_active(last_update_at: str | None, now: datetime | None = None) -> bool:
    parsed = _parse_iso_datetime(last_update_at)
    if not parsed:
        return False
    reference = now or datetime.utcnow()
    elapsed = reference - parsed
    return timedelta(0) <= elapsed <= timedelta(minutes=FIELD_INSPECTOR_EDIT_WINDOW_MINUTES)


def _current_official_role(current_user: dict) -> str:
    role = normalize_official_role(current_user.get("officialRole"))
    if not role:
        raise HTTPException(status_code=403, detail="Official role is required")
    return role


def _ensure_roles(current_user: dict, *roles: str) -> str:
    role = _current_official_role(current_user)
    allowed = {normalize_official_role(value) for value in roles}
    if role not in allowed:
        raise HTTPException(status_code=403, detail="Insufficient role permissions")
    return role


def _merge_queries(base: dict | None, extra: dict | None) -> dict:
    base = base or {}
    extra = extra or {}
    if not base:
        return dict(extra)
    if not extra:
        return dict(base)
    return {"$and": [base, extra]}


def _ticket_scope_query(current_user: dict) -> dict:
    role = _current_official_role(current_user)
    user_id = str(current_user.get("id") or "").strip()
    if role == ROLE_SUPERVISOR and user_id:
        return {
            "$or": [
                {"reopenedBy": {"$exists": False}},
                {"reopenedBy": None},
                {"reopenedSupervisorId": user_id},
            ]
        }
    if role == ROLE_WORKER and user_id:
        return {
            "$or": [
                {"assigneeUserId": user_id},
                {"workerId": user_id},
                {"workerIds": user_id},
                {"assignees": {"$elemMatch": {"workerId": user_id}}},
            ]
        }
    if role == ROLE_FIELD_INSPECTOR and user_id:
        return _merge_queries(
            {
                "$or": [
                    {"fieldInspectorId": user_id},
                    {"fieldInspectorId": {"$exists": False}},
                    {"fieldInspectorId": ""},
                ]
            },
            {"status": {"$in": sorted(FIELD_INSPECTOR_VISIBLE_STATUSES)}},
        )
    return {}


def _get_ticket_doc(ticket_id: str):
    try:
        obj_id = to_object_id(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket id")
    doc = tickets.find_one({"_id": obj_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return doc


def _can_access_ticket(doc: dict, current_user: dict) -> bool:
    role = _current_official_role(current_user)
    user_id = str(current_user.get("id") or "").strip()
    if role == ROLE_DEPARTMENT:
        return True
    if role == ROLE_SUPERVISOR:
        return _supervisor_can_handle_ticket(doc, user_id)
    if role == ROLE_WORKER:
        return _is_worker_assigned(doc, user_id)
    if role == ROLE_FIELD_INSPECTOR:
        if not _is_field_inspector_ticket_visible(doc):
            return False
        field_inspector_id = str(doc.get("fieldInspectorId") or "").strip()
        if not field_inspector_id:
            return True
        return bool(user_id and field_inspector_id == user_id)
    return False


def _is_ticket_reporter(doc: dict, current_user: dict) -> bool:
    user_id = str(current_user.get("id") or "").strip()
    if not user_id:
        return False

    if str(doc.get("reporterId") or "").strip() == user_id:
        return True

    incident_id = str(doc.get("incidentId") or "").strip()
    if not incident_id:
        return False

    incident_doc = None
    try:
        incident_doc = incidents.find_one({"_id": to_object_id(incident_id)}, {"reporterId": 1})
    except Exception:
        incident_doc = incidents.find_one({"_id": incident_id}, {"reporterId": 1})

    return str((incident_doc or {}).get("reporterId") or "").strip() == user_id


def _is_field_inspector_note_text(value: str | None) -> bool:
    text = str(value or "").strip().lower()
    if not text:
        return False
    return any(text.startswith(prefix) for prefix in FIELD_INSPECTOR_NOTE_PREFIXES)


def _latest_inspector_note(notes: list[dict] | None, user_id: str | None = None) -> dict | None:
    if not isinstance(notes, list):
        return None
    candidate_user_id = str(user_id or "").strip()
    for row in range(len(notes) - 1, -1, -1):
        note = notes[row]
        if not isinstance(note, dict):
            continue
        if candidate_user_id and str(note.get("by") or "").strip() != candidate_user_id:
            continue
        if not _is_field_inspector_note_text(note.get("note")):
            continue
        return note
    return None


def _resolve_field_inspector_last_update_at(doc: dict, user_id: str | None = None) -> str | None:
    if not isinstance(doc, dict):
        return None

    for key in ("lastInspectorUpdateAt", "lastFieldInspectorUpdateAt", "fieldInspectorLastUpdateAt"):
        value = str(doc.get(key) or "").strip()
        if value and _parse_iso_datetime(value):
            return value

    latest_note = _latest_inspector_note(doc.get("notes"), user_id)
    if latest_note:
        for key in ("editedAt", "createdAt"):
            value = str(latest_note.get(key) or "").strip()
            if value and _parse_iso_datetime(value):
                return value

    # Legacy fallback: if inspector ownership is clear, use progressUpdatedAt.
    progress_updated_at = str(doc.get("progressUpdatedAt") or "").strip()
    if progress_updated_at and _parse_iso_datetime(progress_updated_at):
        current_user_id = str(user_id or "").strip()
        field_inspector_id = str(doc.get("fieldInspectorId") or "").strip()
        if not current_user_id or not field_inspector_id or field_inspector_id == current_user_id:
            return progress_updated_at

    return None


def _can_access_ticket_logbook(doc: dict, current_user: dict) -> bool:
    if is_official_account(current_user):
        role = normalize_official_role(current_user.get("officialRole"))
        if role not in {ROLE_DEPARTMENT, ROLE_SUPERVISOR, ROLE_WORKER, ROLE_FIELD_INSPECTOR}:
            return False
        if role == ROLE_DEPARTMENT:
            return True
        if role == ROLE_FIELD_INSPECTOR:
            # Field inspectors can access logbooks for ALL tickets
            return True
        return _can_access_ticket(doc, current_user)
    return _is_ticket_reporter(doc, current_user)


def _has_worker_assignment(doc: dict) -> bool:
    assignee_user_id = str(doc.get("assigneeUserId") or "").strip()
    worker_id = str(doc.get("workerId") or "").strip()
    if assignee_user_id or worker_id:
        return True

    worker_ids = doc.get("workerIds")
    if isinstance(worker_ids, list) and any(str(value).strip() for value in worker_ids):
        return True

    assignees = doc.get("assignees")
    if isinstance(assignees, list) and len(assignees) > 0:
        return True

    return False


def _is_verified_ticket(doc: dict) -> bool:
    return (doc.get("status") or "").strip().lower() == "verified"


def _reopened_supervisor_id(doc: dict) -> str:
    return str(doc.get("reopenedSupervisorId") or "").strip()


def _supervisor_can_handle_ticket(doc: dict, supervisor_user_id: str | None) -> bool:
    current_user_id = str(supervisor_user_id or "").strip()
    if not current_user_id:
        return False
    if not _is_reopened_case(doc):
        return True
    assigned_supervisor_id = _reopened_supervisor_id(doc)
    if not assigned_supervisor_id:
        return False
    return assigned_supervisor_id == current_user_id


def _is_field_inspector_ticket_visible(doc: dict) -> bool:
    status = (doc.get("status") or "").strip().lower()
    return status in FIELD_INSPECTOR_VISIBLE_STATUSES


def _is_field_inspector_ticket_eligible(doc: dict) -> bool:
    status = (doc.get("status") or "").strip().lower()
    return status in FIELD_INSPECTOR_EDITABLE_STATUSES


def _resolve_ticket_reporter_email(doc: dict) -> str | None:
    direct_email = (doc.get("reporterEmail") or "").strip()
    if direct_email and "@" in direct_email:
        return direct_email

    incident_doc = None
    incident_id = (doc.get("incidentId") or "").strip()
    if incident_id:
        try:
            incident_doc = incidents.find_one(
                {"_id": to_object_id(incident_id)},
                {"reporterEmail": 1, "reporterId": 1, "reporterPhone": 1},
            )
        except Exception:
            incident_doc = None

    incident_email = ((incident_doc or {}).get("reporterEmail") or "").strip()
    if incident_email and "@" in incident_email:
        return incident_email

    reporter_id = (doc.get("reporterId") or (incident_doc or {}).get("reporterId") or "").strip()
    if reporter_id:
        user_doc = None
        try:
            user_doc = users.find_one({"_id": to_object_id(reporter_id)}, {"email": 1})
        except Exception:
            user_doc = users.find_one({"_id": reporter_id}, {"email": 1})
        user_email = ((user_doc or {}).get("email") or "").strip()
        if user_email and "@" in user_email:
            return user_email

    reporter_phone = (doc.get("reporterPhone") or (incident_doc or {}).get("reporterPhone") or "").strip()
    if reporter_phone:
        user_doc = users.find_one({"phone": reporter_phone}, {"email": 1})
        user_email = ((user_doc or {}).get("email") or "").strip()
        if user_email and "@" in user_email:
            return user_email

    return None


def _notify_ticket_update(doc: dict):
    message = f"SafeLive ticket update: {doc.get('title', 'Ticket')} is now {doc.get('status', 'updated')}."
    if doc.get("reporterPhone"):
        sms_ok, sms_error = send_sms(doc.get("reporterPhone"), message)
        if not sms_ok:
            LOGGER.warning("SMS notification failed for ticket %s: %s", doc.get("_id"), sms_error)
        wa_ok, wa_error = send_whatsapp(doc.get("reporterPhone"), message)
        if not wa_ok:
            LOGGER.warning("WhatsApp notification failed for ticket %s: %s", doc.get("_id"), wa_error)
    status_value = (doc.get("status") or "").strip().lower()
    reporter_email = _resolve_ticket_reporter_email(doc)
    if reporter_email and not doc.get("reporterEmail") and doc.get("_id"):
        try:
            tickets.update_one({"_id": doc.get("_id")}, {"$set": {"reporterEmail": reporter_email}})
        except Exception:
            pass
    if reporter_email and status_value == "resolved":
        try:
            send_ticket_update_email(
                reporter_email,
                doc.get("title", "Ticket"),
                doc.get("status", "updated"),
            )
        except Exception as exc:
            LOGGER.warning("Email notification failed for ticket %s: %s", doc.get("_id"), exc)
    elif status_value == "resolved":
        LOGGER.warning("Resolved email skipped: reporter email unavailable for ticket %s", doc.get("_id"))


def _normalize_ticket_status(value: str) -> str:
    status = (value or "").strip().lower()
    if status in {"pending_review", "under_review"}:
        return "pending"
    return status


def _is_reopened_case(doc: dict) -> bool:
    reopened_by = doc.get("reopenedBy")
    if isinstance(reopened_by, dict):
        for key in ("id", "name", "timestamp"):
            if str(reopened_by.get(key) or "").strip():
                return True
    elif reopened_by:
        return True

    reopen_warning = doc.get("reopenWarning")
    if isinstance(reopen_warning, dict) and any(str(value or "").strip() for value in reopen_warning.values()):
        return True
    return False


def _incident_selector_from_ticket(doc: dict) -> dict | None:
    incident_id = (doc.get("incidentId") or "").strip()
    if not incident_id:
        return None
    try:
        return {"_id": to_object_id(incident_id)}
    except Exception:
        return {"_id": incident_id}


def _sync_incident_from_ticket(doc: dict, updates: dict):
    selector = _incident_selector_from_ticket(doc)
    if not selector or not updates:
        return
    next_updates = dict(updates)
    # Any ticket-side mutation is an official workflow action for this incident.
    next_updates["officialActionTaken"] = True
    incidents.update_one(selector, {"$set": next_updates})


def _record_ticket_log(action: str, ticket_doc: dict, actor: dict, details: dict | None = None):
    append_incident_log(
        ticket_id=str(ticket_doc.get("_id") or ""),
        incident_id=(ticket_doc.get("incidentId") or ""),
        action=action,
        actor=actor,
        details=details or {},
    )


def _build_note_payload(note_text: str, current_user: dict):
    return {
        "note": note_text,
        "createdAt": _now_iso(),
        "by": current_user.get("id"),
    }


def _update_latest_inspector_note(
    notes: list[dict] | None,
    user_id: str,
    note_text: str,
    edited_at: str,
):
    if not isinstance(notes, list) or not user_id:
        return None
    updated = list(notes)
    for index in range(len(updated) - 1, -1, -1):
        note = updated[index]
        if not isinstance(note, dict):
            continue
        if str(note.get("by") or "").strip() != user_id:
            continue
        if not _is_field_inspector_note_text(note.get("note")):
            continue
        next_note = dict(note)
        next_note["note"] = note_text
        next_note["editedAt"] = edited_at
        updated[index] = next_note
        return updated
    return None


def _is_deletable_field_inspector_log(entry: dict, user_id: str) -> bool:
    if not isinstance(entry, dict) or not user_id:
        return False
    action = str(entry.get("action") or "").strip().lower()
    if action not in {"field_inspector_progress_update", "field_inspector_progress_update_edited"}:
        return False
    actor_role = normalize_official_role(entry.get("actorOfficialRole"))
    if actor_role != ROLE_FIELD_INSPECTOR:
        return False
    actor_user_id = str(entry.get("actorUserId") or "").strip()
    return actor_user_id == user_id


def _ticket_id_selectors(ticket_id: str) -> list[object]:
    selectors: list[object] = [ticket_id]
    try:
        selectors.append(to_object_id(ticket_id))
    except Exception:
        pass
    return selectors


def _latest_ticket_log_entry(ticket_id: str) -> dict | None:
    selectors = _ticket_id_selectors(ticket_id)
    return incident_logs.find_one({"ticketId": {"$in": selectors}}, sort=[("createdAt", -1)])


def _latest_editable_field_inspector_log(ticket_id: str, user_id: str) -> dict | None:
    latest_entry = _latest_ticket_log_entry(ticket_id)
    if not latest_entry:
        return None
    if not _is_deletable_field_inspector_log(latest_entry, user_id):
        return None
    return latest_entry


def _extract_worker_ids_from_ticket(doc: dict) -> list[str]:
    ordered: list[str] = []
    seen: set[str] = set()

    def _append(value: str | None):
        worker_id = str(value or "").strip()
        if not worker_id or worker_id in seen:
            return
        seen.add(worker_id)
        ordered.append(worker_id)

    _append(doc.get("assigneeUserId"))
    _append(doc.get("workerId"))

    worker_ids = doc.get("workerIds")
    if isinstance(worker_ids, list):
        for row in worker_ids:
            _append(row)

    assignees = doc.get("assignees")
    if isinstance(assignees, list):
        for row in assignees:
            if isinstance(row, dict):
                _append(row.get("workerId"))

    return ordered


def _is_worker_assigned(doc: dict, worker_user_id: str) -> bool:
    candidate = str(worker_user_id or "").strip()
    if not candidate:
        return False
    return candidate in set(_extract_worker_ids_from_ticket(doc))


def _normalize_assignment_worker_ids(payload: TicketAssign) -> list[str]:
    ordered: list[str] = []
    seen: set[str] = set()

    def _append(value: str | None):
        worker_id = str(value or "").strip()
        if not worker_id or worker_id in seen:
            return
        seen.add(worker_id)
        ordered.append(worker_id)

    _append(payload.workerId)
    if isinstance(payload.workerIds, list):
        for row in payload.workerIds:
            _append(str(row or ""))

    return ordered


def _find_worker_doc(worker_id: str | None):
    candidate = (worker_id or "").strip()
    if not candidate:
        return None
    doc = None
    try:
        doc = users.find_one({"_id": to_object_id(candidate)})
    except Exception:
        doc = users.find_one({"_id": candidate})
    if not doc:
        return None
    if doc.get("userType") != "official":
        return None
    if normalize_official_role(doc.get("officialRole")) != ROLE_WORKER:
        return None
    return doc


def _find_supervisor_doc(supervisor_id: str | None):
    candidate = (supervisor_id or "").strip()
    if not candidate:
        return None
    doc = None
    try:
        doc = users.find_one({"_id": to_object_id(candidate)})
    except Exception:
        doc = users.find_one({"_id": candidate})
    if not doc:
        return None
    if doc.get("userType") != "official":
        return None
    if normalize_official_role(doc.get("officialRole")) != ROLE_SUPERVISOR:
        return None
    return doc


def _notify_ticket_reopened(
    doc: dict,
    reopened_by: dict,
    previous_resolver: dict[str, str] | None = None,
):
    department_name = reopened_by.get("name") or reopened_by.get("email") or "Department Officer"
    ticket_title = doc.get("title", "Ticket")
    previous_resolver = previous_resolver or {}
    previous_resolver_name = str(previous_resolver.get("name") or "").strip()
    previous_resolver_role = normalize_official_role(previous_resolver.get("role"))

    message = f"SafeLive notice: Ticket '{ticket_title}' has been reopened by {department_name}."
    if previous_resolver_name and previous_resolver_role == ROLE_SUPERVISOR:
        message = f"{message} Previous resolving supervisor: {previous_resolver_name}."

    assignee_phones: set[str] = set()
    assignee_emails: set[str] = set()
    assignees = doc.get("assignees")
    if isinstance(assignees, list):
        for row in assignees:
            if not isinstance(row, dict):
                continue
            phone = (row.get("phone") or "").strip()
            email = (row.get("email") or "").strip()
            if phone:
                assignee_phones.add(phone)
            if email:
                assignee_emails.add(email)

    primary_phone = (doc.get("assigneePhone") or "").strip()
    primary_email = (doc.get("assigneeEmail") or "").strip()
    if primary_phone:
        assignee_phones.add(primary_phone)
    if primary_email:
        assignee_emails.add(primary_email)

    for worker_id in _extract_worker_ids_from_ticket(doc):
        try:
            worker_doc = users.find_one({"_id": to_object_id(worker_id)})
        except Exception:
            worker_doc = users.find_one({"_id": worker_id})
        if not worker_doc:
            continue
        worker_phone = str(worker_doc.get("phone") or "").strip()
        worker_email = str(worker_doc.get("email") or "").strip()
        if worker_phone:
            assignee_phones.add(worker_phone)
        if worker_email:
            assignee_emails.add(worker_email)

    for phone in sorted(assignee_phones):
        sms_ok, sms_err = send_sms(phone, message)
        if not sms_ok and sms_err:
            LOGGER.warning("Ticket %s reopen SMS failed for %s: %s", doc.get("_id"), phone, sms_err)
        wa_ok, wa_err = send_whatsapp(phone, message)
        if not wa_ok and wa_err:
            LOGGER.warning("Ticket %s reopen WhatsApp failed for %s: %s", doc.get("_id"), phone, wa_err)

    for email in sorted(assignee_emails):
        try:
            send_ticket_update_email(email, ticket_title, "Reopened by Department")
        except Exception as exc:
            LOGGER.warning("Ticket %s reopen email failed for %s: %s", doc.get("_id"), email, exc)

    warning_payload = {
        "message": message,
        "issuedAt": _now_iso(),
        "departmentName": department_name,
        "supervisorName": previous_resolver_name if previous_resolver_role == ROLE_SUPERVISOR else "",
    }
    try:
        tickets.update_one(
            {"_id": doc.get("_id")},
            {
                "$set": {
                    "reopenWarning": warning_payload,
                }
            },
        )
        doc["reopenWarning"] = warning_payload
    except Exception as exc:
        LOGGER.warning("Ticket %s warning persistence failed: %s", doc.get("_id"), exc)


@router.get("/stats")
def get_stats(current_user: dict = Depends(get_official_user)):
    scope = _ticket_scope_query(current_user)
    total = tickets.count_documents(scope)
    open_t = tickets.count_documents(_merge_queries(scope, {"status": "open"}))
    pending_t = tickets.count_documents(_merge_queries(scope, {"status": "pending"}))
    in_prog = tickets.count_documents(_merge_queries(scope, {"status": {"$in": ["in_progress", "verified"]}}))
    resolved = tickets.count_documents(_merge_queries(scope, {"status": "resolved"}))
    since = (datetime.utcnow() - timedelta(days=1)).isoformat()
    resolved_today = tickets.count_documents(
        _merge_queries(scope, {"status": "resolved", "updatedAt": {"$gte": since}})
    )
    resolution_rate = round((resolved / total) * 100, 2) if total > 0 else 0
    avg_response = "N/A"
    return {
        "success": True,
        "data": {
            "totalTickets": total,
            "openTickets": open_t,
            "pendingTickets": pending_t,
            "inProgress": in_prog,
            "resolvedToday": resolved_today,
            "avgResponseTime": avg_response,
            "resolutionRate": resolution_rate,
        },
    }


@router.get("")
def get_tickets(
    status: str | None = None,
    priority: str | None = None,
    category: str | None = None,
    current_user: dict = Depends(get_official_user),
):
    query = _ticket_scope_query(current_user)
    if status:
        query = _merge_queries(query, {"status": status})
    if priority:
        query = _merge_queries(query, {"priority": priority})
    if category:
        query = _merge_queries(query, {"category": category})
    data = list(tickets.find(query).sort("createdAt", -1))
    return {"success": True, "data": serialize_list(data)}


@router.get("/{ticket_id}")
def get_ticket(ticket_id: str, current_user: dict = Depends(get_official_user)):
    doc = _get_ticket_doc(ticket_id)
    if not _can_access_ticket(doc, current_user):
        raise HTTPException(status_code=403, detail="Access denied")
    return {"success": True, "data": serialize_doc(doc)}


@router.patch("/{ticket_id}/status")
def update_status(ticket_id: str, payload: TicketUpdateStatus, current_user: dict = Depends(get_official_user)):
    existing = _get_ticket_doc(ticket_id)
    if not _can_access_ticket(existing, current_user):
        raise HTTPException(status_code=403, detail="Access denied")

    role = _current_official_role(current_user)
    normalized_status = _normalize_ticket_status(payload.status)
    if normalized_status not in TICKET_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")

    existing_status = (existing.get("status") or "").strip().lower()
    is_reopened_case = _is_reopened_case(existing)
    was_resolved = existing_status == "resolved"
    reopening = normalized_status == "open" and was_resolved

    if (
        is_reopened_case
        and role == ROLE_DEPARTMENT
        and normalized_status in {"verified", "resolved"}
        and not _reopened_supervisor_id(existing)
    ):
        raise HTTPException(
            status_code=400,
            detail="Assign a supervisor first for reopened tickets before verification or resolution",
        )

    if normalized_status == "resolved":
        if role not in {ROLE_DEPARTMENT, ROLE_SUPERVISOR}:
            raise HTTPException(status_code=403, detail="Only department or supervisor can mark tickets resolved")
        if not _has_worker_assignment(existing):
            raise HTTPException(status_code=400, detail="Assign workers before resolving the ticket")
    if reopening and role != ROLE_DEPARTMENT:
        raise HTTPException(status_code=403, detail="Only department can reopen resolved tickets")
    if normalized_status == "verified":
        if role not in {ROLE_DEPARTMENT, ROLE_SUPERVISOR}:
            raise HTTPException(
                status_code=403,
                detail="Only department or supervisor can verify tickets",
            )
        if existing_status == "resolved":
            raise HTTPException(status_code=400, detail="Reopen the ticket before verifying it")
    if normalized_status in {"open", "pending", "in_progress"} and role not in {ROLE_DEPARTMENT, ROLE_SUPERVISOR}:
        raise HTTPException(status_code=403, detail="Only department or supervisor can set this status")

    now = _now_iso()
    update = {"status": normalized_status, "updatedAt": now}
    if reopening:
        update["reopenedBy"] = {
            "id": current_user.get("id"),
            "name": current_user.get("name") or current_user.get("email"),
            "timestamp": now,
        }
        # Restart progress lifecycle when a resolved case is reopened.
        update["progressSummary"] = ""
        update["progressPercent"] = 0
        update["progressSource"] = "reopened_reset"
        update["progressConfidence"] = 1.0
        update["progressUpdatedAt"] = now
        update["lastInspectorUpdateAt"] = ""
        update["lastWorkerUpdateAt"] = ""
        update["inspectorReminderSentForDate"] = ""
        # Clear current worker assignments - supervisor must reassign after reopening
        update["workerId"] = ""
        update["workerCode"] = ""
        update["workerIds"] = []
        update["workerCodes"] = []
        update["assignees"] = []
        update["assignedTo"] = ""
        update["assigneeName"] = ""
        update["assigneePhone"] = ""
        update["assigneeEmail"] = ""
        update["assigneeUserId"] = ""
        update["workerSpecialization"] = ""
        update["workerSpecializations"] = []
        update["assignedBySupervisorId"] = ""
        update["assignedBySupervisorName"] = ""
        update["assignedAt"] = ""
        update["reopenedSupervisorId"] = ""
        update["reopenedSupervisorName"] = ""
        update["reopenedSupervisorEmail"] = ""
        update["reopenedSupervisorAssignedAt"] = ""
        # Preserve historical resolver information for audit trail
        update["reopenedFromResolverId"] = str(existing.get("resolvedById") or "").strip()
        update["reopenedFromResolverName"] = str(existing.get("resolvedByName") or "").strip()
        update["reopenedFromResolverRole"] = str(existing.get("resolvedByRole") or "").strip()
    if normalized_status == "resolved":
        update["resolvedById"] = str(current_user.get("id") or "").strip()
        update["resolvedByName"] = str(current_user.get("name") or current_user.get("email") or "").strip()
        update["resolvedByRole"] = role
        update["resolvedAt"] = now
    clear_warning = not reopening and bool(existing.get("reopenWarning"))

    op = {"$set": update}
    if payload.notes:
        op["$push"] = {"notes": _build_note_payload(payload.notes, current_user)}
    if clear_warning:
        op.setdefault("$unset", {})["reopenWarning"] = ""

    obj_id = to_object_id(ticket_id)
    tickets.update_one({"_id": obj_id}, op)
    doc = tickets.find_one({"_id": obj_id})

    if doc:
        incident_status = "in_progress" if doc.get("status") == "verified" else doc.get("status")
        incident_updates = {
            "status": incident_status,
            "updatedAt": doc.get("updatedAt"),
        }
        if reopening:
            incident_updates.update(
                {
                    "progressPercent": doc.get("progressPercent"),
                    "progressSource": doc.get("progressSource"),
                    "progressConfidence": doc.get("progressConfidence"),
                    "progressUpdatedAt": doc.get("progressUpdatedAt"),
                    "assignedTo": "",
                    "assigneeName": "",
                    "assigneePhone": "",
                    "assigneeEmail": "",
                    "assigneeUserId": "",
                    "workerId": "",
                    "workerCode": "",
                    "workerIds": [],
                    "workerCodes": [],
                    "assignees": [],
                    "workerSpecialization": "",
                    "workerSpecializations": [],
                }
            )
        _sync_incident_from_ticket(
            doc,
            incident_updates,
        )
        _notify_ticket_update(doc)

        if reopening:
            _notify_ticket_reopened(
                doc,
                current_user,
                previous_resolver={
                    "id": str(existing.get("resolvedById") or "").strip(),
                    "name": str(existing.get("resolvedByName") or "").strip(),
                    "role": str(existing.get("resolvedByRole") or "").strip(),
                },
            )
            _record_ticket_log(
                "ticket_reopened_by_department",
                doc,
                current_user,
                details={"fromStatus": existing.get("status"), "toStatus": doc.get("status")},
            )
        elif normalized_status == "resolved":
            _record_ticket_log(
                "ticket_resolved_by_department" if role == ROLE_DEPARTMENT else "ticket_resolved_by_supervisor",
                doc,
                current_user,
                details={"fromStatus": existing.get("status"), "toStatus": doc.get("status")},
            )
        elif normalized_status == "verified":
            _record_ticket_log(
                "ticket_verified_by_supervisor" if role == ROLE_SUPERVISOR else "ticket_verified_by_department",
                doc,
                current_user,
                details={"fromStatus": existing.get("status"), "toStatus": doc.get("status")},
            )
        else:
            _record_ticket_log(
                "ticket_status_updated",
                doc,
                current_user,
                details={"fromStatus": existing.get("status"), "toStatus": doc.get("status")},
            )

    return {"success": True, "data": serialize_doc(doc)}


@router.post("/{ticket_id}/assign-supervisor")
def assign_reopened_supervisor(
    ticket_id: str,
    payload: TicketAssignSupervisor,
    current_user: dict = Depends(get_official_user),
):
    _ensure_roles(current_user, ROLE_DEPARTMENT)
    existing = _get_ticket_doc(ticket_id)
    if not _can_access_ticket(existing, current_user):
        raise HTTPException(status_code=403, detail="Access denied")

    if not _is_reopened_case(existing):
        raise HTTPException(status_code=400, detail="Supervisor assignment is available only for reopened tickets")
    if (existing.get("status") or "").strip().lower() == "resolved":
        raise HTTPException(status_code=400, detail="Reopen the ticket before assigning a supervisor")

    supervisor_doc = _find_supervisor_doc(payload.supervisorId)
    if not supervisor_doc:
        raise HTTPException(status_code=400, detail="Selected supervisor account not found")

    supervisor_payload = serialize_doc(supervisor_doc) or {}
    supervisor_id = str(supervisor_payload.get("id") or "").strip()
    if not supervisor_id:
        raise HTTPException(status_code=400, detail="Selected supervisor id is invalid")

    current_department = str(current_user.get("department") or "").strip().lower()
    supervisor_department = str(supervisor_payload.get("department") or "").strip().lower()
    current_department_user_id = str(current_user.get("id") or "").strip()
    supervisor_created_by_department_id = str(supervisor_payload.get("createdByDepartmentId") or "").strip()
    creator_matches_department = bool(
        current_department_user_id
        and supervisor_created_by_department_id
        and current_department_user_id == supervisor_created_by_department_id
    )
    if current_department and supervisor_department and current_department != supervisor_department and not creator_matches_department:
        raise HTTPException(status_code=400, detail="Selected supervisor does not belong to your department")

    supervisor_name = (
        str(supervisor_payload.get("name") or "").strip()
        or str(supervisor_payload.get("email") or "").strip()
        or "Supervisor"
    )
    supervisor_email = str(supervisor_payload.get("email") or "").strip()
    now = _now_iso()

    op: dict = {
        "$set": {
            "reopenedSupervisorId": supervisor_id,
            "reopenedSupervisorName": supervisor_name,
            "reopenedSupervisorEmail": supervisor_email,
            "reopenedSupervisorAssignedAt": now,
            "updatedAt": now,
        }
    }
    if payload.notes:
        op["$push"] = {"notes": _build_note_payload(payload.notes, current_user)}

    obj_id = to_object_id(ticket_id)
    tickets.update_one({"_id": obj_id}, op)
    doc = tickets.find_one({"_id": obj_id})
    if doc:
        _record_ticket_log(
            "reopened_ticket_supervisor_assigned_by_department",
            doc,
            current_user,
            details={"supervisorId": supervisor_id, "supervisorName": supervisor_name},
        )
        _sync_incident_from_ticket(doc, {"updatedAt": doc.get("updatedAt")})

    return {"success": True, "data": serialize_doc(doc)}


@router.post("/{ticket_id}/assign")
def assign_ticket(ticket_id: str, payload: TicketAssign, current_user: dict = Depends(get_official_user)):
    existing = _get_ticket_doc(ticket_id)
    if not _can_access_ticket(existing, current_user):
        raise HTTPException(status_code=403, detail="Access denied")

    role = _current_official_role(current_user)
    if role not in {ROLE_SUPERVISOR, ROLE_DEPARTMENT}:
        raise HTTPException(
            status_code=403,
            detail="Only department or supervisor can assign workers",
        )

    if (existing.get("status") or "").strip().lower() != "verified":
        raise HTTPException(status_code=400, detail="Worker assignment is available only after ticket verification")

    if _has_worker_assignment(existing):
        raise HTTPException(status_code=400, detail="Workers are already assigned for this ticket")

    is_reopened_case = _is_reopened_case(existing)
    if is_reopened_case and role == ROLE_DEPARTMENT and not _reopened_supervisor_id(existing):
        raise HTTPException(
            status_code=400,
            detail="Assign a supervisor first for reopened tickets before worker assignment",
        )

    assignment_worker_ids = _normalize_assignment_worker_ids(payload)
    if not assignment_worker_ids:
        raise HTTPException(status_code=400, detail="At least one workerId is required for assignment")

    assignees: list[dict] = []
    for worker_id in assignment_worker_ids:
        worker_doc = _find_worker_doc(worker_id)
        if not worker_doc:
            raise HTTPException(status_code=400, detail=f"Selected worker account not found: {worker_id}")
        worker_payload = serialize_doc(worker_doc) or {}
        worker_name = (
            (worker_payload.get("name") or "").strip()
            or (worker_payload.get("email") or "").strip()
            or (worker_payload.get("phone") or "").strip()
            or "Worker"
        )
        assignees.append(
            {
                "workerId": str(worker_payload.get("id") or "").strip(),
                "workerCode": str(worker_payload.get("workerCode") or "").strip(),
                "name": worker_name,
                "phone": (worker_payload.get("phone") or "").strip(),
                "email": (worker_payload.get("email") or "").strip(),
                "workerSpecialization": (worker_payload.get("workerSpecialization") or "Other").strip(),
            }
        )

    if not assignees:
        raise HTTPException(status_code=400, detail="No valid worker accounts selected")

    primary_assignee = assignees[0]
    assigned_to_text = primary_assignee["name"]
    if len(assignees) > 1:
        assigned_to_text = f"{primary_assignee['name']} +{len(assignees) - 1} more"

    worker_specializations = sorted({row.get("workerSpecialization") or "Other" for row in assignees})
    now = _now_iso()

    update = {
        "workerId": primary_assignee.get("workerId"),
        "workerCode": primary_assignee.get("workerCode"),
        "workerIds": [row.get("workerId") for row in assignees if row.get("workerId")],
        "workerCodes": [row.get("workerCode") for row in assignees if row.get("workerCode")],
        "assignees": [
            {
                **row,
                "assignedAt": now,
            }
            for row in assignees
        ],
        "assignedTo": assigned_to_text,
        "assigneeName": primary_assignee.get("name"),
        "assigneePhone": primary_assignee.get("phone"),
        "assigneeEmail": primary_assignee.get("email"),
        "assigneeUserId": primary_assignee.get("workerId"),
        "workerSpecialization": primary_assignee.get("workerSpecialization") or "Other",
        "workerSpecializations": worker_specializations,
        "assignedBySupervisorId": current_user.get("id"),
        "assignedBySupervisorName": current_user.get("name") or current_user.get("email"),
        "assignedAt": now,
        "updatedAt": now,
    }

    op = {"$set": update}
    if payload.notes:
        op["$push"] = {"notes": _build_note_payload(payload.notes, current_user)}

    obj_id = to_object_id(ticket_id)
    tickets.update_one({"_id": obj_id}, op)
    doc = tickets.find_one({"_id": obj_id})
    if doc:
        _sync_incident_from_ticket(
            doc,
            {
                "assignedTo": doc.get("assignedTo"),
                "assigneeName": doc.get("assigneeName"),
                "assigneePhone": doc.get("assigneePhone"),
                "assigneeEmail": doc.get("assigneeEmail"),
                "assigneeUserId": doc.get("assigneeUserId"),
                "workerId": doc.get("workerId"),
                "workerCode": doc.get("workerCode"),
                "workerIds": doc.get("workerIds"),
                "workerCodes": doc.get("workerCodes"),
                "assignees": doc.get("assignees"),
                "workerSpecialization": doc.get("workerSpecialization"),
                "workerSpecializations": doc.get("workerSpecializations"),
                "updatedAt": doc.get("updatedAt"),
            },
        )
        _record_ticket_log(
            "worker_assigned_by_supervisor" if role == ROLE_SUPERVISOR else "worker_assigned_by_department",
            doc,
            current_user,
            details={
                "workerCodes": [row.get("workerCode") for row in assignees if row.get("workerCode")],
                "workerNames": [row.get("name") for row in assignees],
                "workerCount": len(assignees),
            },
        )
        _notify_ticket_update(doc)
    return {"success": True, "data": serialize_doc(doc)}


@router.post("/{ticket_id}/progress-update")
def update_ticket_progress(
    ticket_id: str,
    payload: TicketProgressUpdate,
    current_user: dict = Depends(get_official_user),
):
    role = _ensure_roles(current_user, ROLE_FIELD_INSPECTOR, ROLE_WORKER)
    existing = _get_ticket_doc(ticket_id)
    if not _can_access_ticket(existing, current_user):
        raise HTTPException(status_code=403, detail="Access denied")
    if (existing.get("status") or "").strip().lower() == "resolved":
        raise HTTPException(status_code=400, detail="Resolved tickets cannot receive progress updates")
    if role == ROLE_FIELD_INSPECTOR and not _is_field_inspector_ticket_eligible(existing):
        raise HTTPException(
            status_code=400,
            detail="Field inspector updates are only available for active tickets (not resolved)",
        )

    update_text = (payload.updateText or "").strip()
    if len(update_text) < 5:
        raise HTTPException(status_code=400, detail="updateText must be at least 5 characters")
    edit_requested = bool(payload.editLastUpdate and role == ROLE_FIELD_INSPECTOR)
    current_user_id = str(current_user.get("id") or "").strip()
    editable_reference = None
    editable_log_entry = None

    if edit_requested:
        latest_inspector_id = str(existing.get("fieldInspectorId") or "").strip()
        if latest_inspector_id and latest_inspector_id != current_user_id:
            raise HTTPException(
                status_code=403,
                detail="Only the original field inspector can edit this update",
            )
        if not latest_inspector_id and _latest_inspector_note(existing.get("notes"), current_user_id) is None:
            raise HTTPException(
                status_code=403,
                detail="Only the original field inspector can edit this update",
            )
        editable_reference = _resolve_field_inspector_last_update_at(existing, current_user_id)
        # No time limit - field inspectors can edit their updates anytime
        editable_log_entry = _latest_editable_field_inspector_log(ticket_id, current_user_id)
        if editable_log_entry is None:
            raise HTTPException(
                status_code=403,
                detail="Only your latest field inspector log can be edited",
            )

    prediction = predict_ticket_progress(update_text)
    now = _now_iso()
    progress_percent = int(max(0, min(100, prediction.percent)))
    confidence = round(max(0.0, min(1.0, float(prediction.confidence))), 4)

    set_payload = {
        "progressSummary": update_text,
        "progressPercent": progress_percent,
        "progressSource": prediction.source,
        "progressConfidence": confidence,
        "progressUpdatedAt": now,
        "updatedAt": now,
    }
    previous_status = (existing.get("status") or "").strip().lower()
    if previous_status in {"open", "pending", "verified"}:
        set_payload["status"] = "in_progress"
    if role == ROLE_FIELD_INSPECTOR:
        if edit_requested and editable_reference:
            set_payload["lastInspectorUpdateAt"] = editable_reference
        else:
            set_payload["lastInspectorUpdateAt"] = now
        set_payload["fieldInspectorId"] = current_user.get("id")
        set_payload["fieldInspectorName"] = current_user.get("name") or current_user.get("email")
        set_payload["inspectorReminderSentForDate"] = ""
    if role == ROLE_WORKER:
        set_payload["lastWorkerUpdateAt"] = now

    note_label = "Field Inspector update" if role == ROLE_FIELD_INSPECTOR else "Worker update"
    note_text = f"{note_label}: {update_text} ({progress_percent}%)"
    updated_notes = None
    if edit_requested:
        edited_label = f"{note_label} (edited)"
        note_text = f"{edited_label}: {update_text} ({progress_percent}%)"
        updated_notes = _update_latest_inspector_note(
            existing.get("notes"),
            current_user_id,
            note_text,
            now,
        )
        if updated_notes is None:
            raise HTTPException(status_code=400, detail="No editable field inspector update found")

    obj_id = to_object_id(ticket_id)
    update_ops = {"$set": set_payload}
    if edit_requested and updated_notes is not None:
        update_ops["$set"]["notes"] = updated_notes
    else:
        update_ops["$push"] = {"notes": _build_note_payload(note_text, current_user)}

    tickets.update_one({"_id": obj_id}, update_ops)
    doc = tickets.find_one({"_id": obj_id})
    if doc:
        incident_updates = {
            "progressPercent": doc.get("progressPercent"),
            "progressSource": doc.get("progressSource"),
            "progressConfidence": doc.get("progressConfidence"),
            "progressUpdatedAt": doc.get("progressUpdatedAt"),
            "updatedAt": doc.get("updatedAt"),
        }
        if set_payload.get("status") == "in_progress":
            incident_updates["status"] = "in_progress"
        _sync_incident_from_ticket(
            doc,
            incident_updates,
        )
        if role == ROLE_FIELD_INSPECTOR and edit_requested and editable_log_entry is not None:
            incident_logs.update_one(
                {"_id": editable_log_entry.get("_id")},
                {
                    "$set": {
                        "action": "field_inspector_progress_update_edited",
                        "createdAt": now,
                        "summary": f"Field inspector edited update: {update_text} ({progress_percent}% progress)",
                        "details": {
                            "progressPercent": doc.get("progressPercent"),
                            "progressConfidence": doc.get("progressConfidence"),
                            "progressSource": doc.get("progressSource"),
                            "updateText": update_text,
                            "edited": True,
                        },
                    }
                },
            )
        elif role == ROLE_FIELD_INSPECTOR:
            _record_ticket_log(
                "field_inspector_progress_update",
                doc,
                current_user,
                details={
                    "progressPercent": doc.get("progressPercent"),
                    "progressConfidence": doc.get("progressConfidence"),
                    "progressSource": doc.get("progressSource"),
                    "updateText": update_text,
                    "edited": False,
                },
            )
        else:
            action = "worker_progress_update"
            _record_ticket_log(
                action,
                doc,
                current_user,
                details={
                    "progressPercent": doc.get("progressPercent"),
                    "progressConfidence": doc.get("progressConfidence"),
                    "progressSource": doc.get("progressSource"),
                    "updateText": update_text,
                    "edited": False,
                },
            )
    return {"success": True, "data": serialize_doc(doc)}


@router.delete("/{ticket_id}/logbook/{entry_id}")
def delete_ticket_logbook_entry(
    ticket_id: str,
    entry_id: str,
    current_user: dict = Depends(get_official_user),
):
    role = _current_official_role(current_user)
    if role != ROLE_FIELD_INSPECTOR:
        raise HTTPException(status_code=403, detail="Only field inspectors can delete logbook entries")

    ticket_doc = _get_ticket_doc(ticket_id)
    if not _can_access_ticket_logbook(ticket_doc, current_user):
        raise HTTPException(status_code=403, detail="Access denied")

    try:
        entry_obj_id = to_object_id(entry_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid logbook entry id")

    ticket_selectors = _ticket_id_selectors(ticket_id)

    entry = incident_logs.find_one({"_id": entry_obj_id, "ticketId": {"$in": ticket_selectors}})
    if not entry:
        raise HTTPException(status_code=404, detail="Logbook entry not found")

    current_user_id = str(current_user.get("id") or "").strip()
    if not _is_deletable_field_inspector_log(entry, current_user_id):
        raise HTTPException(status_code=403, detail="You can only delete your own field inspector updates")

    latest_entry = _latest_ticket_log_entry(ticket_id)
    latest_entry_id = str((latest_entry or {}).get("_id") or "")
    if latest_entry_id != str(entry_obj_id):
        raise HTTPException(status_code=403, detail="Only the latest logbook entry can be deleted")

    incident_logs.delete_one({"_id": entry_obj_id})
    return {"success": True, "message": "Logbook entry deleted"}


@router.get("/{ticket_id}/logbook")
def get_ticket_logbook_entries(ticket_id: str, current_user: dict = Depends(get_current_user)):
    doc = _get_ticket_doc(ticket_id)
    # Any authenticated official account can read official ticket activity logs.
    # Reporters (citizen accounts) are still limited to their own tickets.
    if not is_official_account(current_user) and not _is_ticket_reporter(doc, current_user):
        raise HTTPException(status_code=403, detail="Access denied")
    data = get_ticket_logbook(ticket_id)
    return {"success": True, "data": data}
