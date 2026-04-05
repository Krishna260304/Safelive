import os
import logging
import hashlib
import difflib
import math
import re
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request
from fastapi.responses import HTMLResponse
from pymongo import ReturnDocument
from app.database import counters, incident_logs, incidents, messages, tickets, users
from app.models import IncidentCreate, IncidentUpdate, MessageCreate
from app.services.ws_manager import manager
from app.services.image_service import save_image
from app.services.email_service import (
    send_alert_email,
    send_critical_incident_review_email,
    send_incident_submission_email,
    send_ticket_update_email,
)
from app.services.notification_service import send_stakeholder_notifications
from app.services.priority_ai import predict_incident_priority
from app.services.report_validation_ai import validate_incident_report
from app.services.audit_log import get_incident_logbook
from app.config.settings import settings
from app.issue_model import IssueIn
from app.auth import get_current_user, is_official_account
from app.roles import normalize_official_role
from app.utils import serialize_doc, serialize_list, to_object_id

router = APIRouter(prefix="/api")
LOGGER = logging.getLogger(__name__)
INCIDENT_STATUSES = {"open", "pending", "in_progress", "resolved"}
CRITICAL_APPROVAL_ROLES = {"supervisor", "department"}
PRIORITY_ALIASES = {
    "low": "low",
    "minor": "low",
    "medium": "medium",
    "moderate": "medium",
    "high": "high",
    "major": "high",
    "critical": "high",
    "severe": "high",
    "emergency": "high",
}
IOT_SEVERITY_ALIASES = {
    "low": "low",
    "minor": "low",
    "medium": "medium",
    "moderate": "medium",
    "high": "high",
    "major": "high",
    "critical": "high",
    "severe": "high",
    "emergency": "high",
}
IOT_PRIORITY_BY_SEVERITY = {
    "low": "low",
    "medium": "medium",
    "high": "high",
}
OFFICIAL_ACTIVITY_ROLES = {"department", "supervisor", "field_inspector", "worker"}
ROLE_FIELD_INSPECTOR = "field_inspector"
LOCAL_REPORTER_EDIT_WINDOW_MINUTES = 5
LOCAL_USER_TYPES = {"citizen", "local"}
INACTIVE_DUPLICATE_STATUSES = {"resolved", "rejected"}
DUPLICATE_TEXT_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "at",
    "be",
    "by",
    "for",
    "from",
    "has",
    "in",
    "is",
    "it",
    "near",
    "of",
    "on",
    "please",
    "road",
    "street",
    "the",
    "there",
    "this",
    "to",
    "was",
    "with",
}
MIN_DUPLICATE_TEXT_SCORE = 0.42
CATEGORY_MATCH_DUPLICATE_SCORE = 0.52
STRICT_DUPLICATE_TEXT_SCORE = 0.72

def _now_iso():
    return datetime.utcnow().isoformat()

def _next_public_incident_id(created_at: str | None = None) -> str:
    parsed_created_at = _parse_iso_datetime(created_at) or datetime.utcnow()
    month_key = parsed_created_at.strftime("%y%m")
    counter_doc = counters.find_one_and_update(
        {"_id": f"incident_seq_{month_key}"},
        {"$inc": {"seq": 1}, "$setOnInsert": {"createdAt": _now_iso()}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    serial = int((counter_doc or {}).get("seq") or 1)
    return f"{month_key}{serial:04d}"

def _sanitize_iot_text(value: str | None, *, default: str = "", max_len: int = 120) -> str:
    text = str(value or "").strip()
    if not text:
        return default
    if len(text) > max_len:
        text = text[:max_len]
    return text

def _normalize_iot_token(value: str | None) -> str:
    token = _sanitize_iot_text(value, max_len=64).lower().replace("-", "_").replace(" ", "_")
    return token

def _normalize_iot_severity(value: str | None) -> str:
    normalized = _normalize_iot_token(value)
    return IOT_SEVERITY_ALIASES.get(normalized, "high")

def _normalize_priority_value(value: str | None, default: str = "medium") -> str:
    normalized = _normalize_iot_token(value)
    return PRIORITY_ALIASES.get(normalized, default)

def _resolve_iot_priority(severity: str) -> str:
    return IOT_PRIORITY_BY_SEVERITY.get(severity, "high")

def _extract_iot_api_key(
    x_iot_api_key: str | None,
    x_api_key: str | None,
    authorization: str | None,
) -> str:
    for candidate in (x_iot_api_key, x_api_key):
        value = (candidate or "").strip()
        if value:
            return value

    auth_value = (authorization or "").strip()
    if not auth_value:
        return ""

    lower_auth = auth_value.lower()
    if lower_auth.startswith("bearer "):
        return auth_value.split(" ", 1)[1].strip()
    if lower_auth.startswith("token "):
        return auth_value.split(" ", 1)[1].strip()
    return auth_value

def _validate_iot_api_key(api_key: str):
    expected_keys = [item for item in settings.IOT_API_KEYS if item]
    if not expected_keys:
        return

    if not api_key:
        raise HTTPException(status_code=401, detail="Missing IoT API key")

    for candidate in expected_keys:
        if secrets.compare_digest(candidate, api_key):
            return
    raise HTTPException(status_code=401, detail="Invalid IoT API key")

def _resolve_request_ip(request: Request) -> str | None:
    for header_name in ("cf-connecting-ip", "x-forwarded-for", "x-real-ip"):
        raw_value = (request.headers.get(header_name) or "").strip()
        if not raw_value:
            continue
        if header_name == "x-forwarded-for":
            return raw_value.split(",", 1)[0].strip()
        return raw_value
    if request.client and request.client.host:
        return request.client.host
    return None

def _save_images(images: list[str] | None):
    image_urls = []
    if not images:
        return image_urls
    for img in images:
        if not img:
            continue
        try:
            path = save_image(img)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid image data")
        filename = os.path.basename(path)
        image_urls.append(f"/images/{filename}")
    return image_urls

def _get_incident_doc(incident_id: str):
    try:
        obj_id = to_object_id(incident_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid incident id")
    doc = incidents.find_one({"_id": obj_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Incident not found")
    return doc

def _is_official(user: dict):
    return is_official_account(user)

def _user_type_value(user: dict | None) -> str:
    return str((user or {}).get("userType") or "").strip().lower()

def _clean_user_id(value: object) -> str:
    return str(value or "").strip()

def _current_official_role(user: dict) -> str | None:
    return normalize_official_role(user.get("officialRole"))

def _has_department_or_supervisor_verification(doc: dict) -> bool:
    incident_status = (doc.get("status") or "").strip().lower()
    if incident_status in {"verified", "in_progress", "resolved"}:
        return True

    ticket_status = _ticket_status_for_incident(doc)
    if ticket_status in {"verified", "in_progress", "resolved"}:
        return True

    incident_object_id = doc.get("_id")
    incident_id = str(incident_object_id) if incident_object_id is not None else ""
    if not incident_id:
        return False

    verification_log = incident_logs.find_one(
        {
            "incidentId": incident_id,
            "action": {"$in": ["ticket_verified_by_supervisor", "ticket_verified_by_department"]},
        },
        {"_id": 1},
    )
    return bool(verification_log)

def _is_common_incident(doc: dict) -> bool:
    if bool(doc.get("commonIncident")):
        return True
    try:
        return int(doc.get("duplicateReportCount") or 0) >= 2
    except Exception:
        return False

def _is_primary_local_reporter(doc: dict, user: dict) -> bool:
    if _is_official(user):
        return False
    reporter_id = _clean_user_id(doc.get("reporterId"))
    current_user_id = _clean_user_id(user.get("id"))
    return bool(reporter_id and current_user_id and reporter_id == current_user_id)

def _can_view_incident(doc: dict, user: dict):
    if _is_official(user):
        if _current_official_role(user) == ROLE_FIELD_INSPECTOR:
            return _has_department_or_supervisor_verification(doc)
        return True
    if _is_primary_local_reporter(doc, user):
        return True
    return _is_common_incident(doc)

def _can_participate_in_incident(doc: dict, user: dict) -> bool:
    if _is_official(user):
        return _can_view_incident(doc, user)
    return _is_primary_local_reporter(doc, user)

def _can_receive_incident_event(user: dict | None, doc: dict) -> bool:
    if not isinstance(user, dict):
        return False
    return _can_view_incident(doc, user)

def _ticket_status_for_incident(doc: dict) -> str:
    incident_object_id = doc.get("_id")
    incident_id = str(incident_object_id) if incident_object_id is not None else ""
    if not incident_id:
        return ""
    ticket_doc = tickets.find_one({"incidentId": incident_id}, {"status": 1})
    return (ticket_doc or {}).get("status", "").strip().lower()

def _has_official_logbook_action(doc: dict) -> bool:
    incident_object_id = doc.get("_id")
    incident_id = str(incident_object_id) if incident_object_id is not None else ""
    if not incident_id:
        return False
    row = incident_logs.find_one(
        {
            "incidentId": incident_id,
            "actorOfficialRole": {"$in": sorted(OFFICIAL_ACTIVITY_ROLES)},
        },
        {"_id": 1},
    )
    return bool(row)

def _reporter_edit_window_expired(doc: dict, now: datetime | None = None) -> bool:
    created_at = _parse_iso_datetime(doc.get("createdAt"))
    if not created_at:
        return True
    current_time = now or datetime.utcnow()
    window_end = created_at + timedelta(minutes=LOCAL_REPORTER_EDIT_WINDOW_MINUTES)
    return current_time > window_end

def _reporter_edit_locked(doc: dict) -> bool:
    if _reporter_edit_window_expired(doc):
        return True
    if bool(doc.get("officialActionTaken")):
        return True
    if _has_official_logbook_action(doc):
        return True
    incident_status = (doc.get("status") or "").strip().lower()
    if incident_status in {"verified", "in_progress", "resolved"}:
        return True
    ticket_status = _ticket_status_for_incident(doc)
    return ticket_status in {"verified", "in_progress", "resolved"}

def _reporter_delete_locked(doc: dict) -> bool:
    incident_status = (doc.get("status") or "").strip().lower()
    if incident_status in {"verified", "resolved"}:
        return True
    ticket_status = _ticket_status_for_incident(doc)
    if ticket_status in {"verified", "resolved"}:
        return True

    incident_object_id = doc.get("_id")
    incident_id = str(incident_object_id) if incident_object_id is not None else ""
    if not incident_id:
        return False
    verification_log = incident_logs.find_one(
        {
            "incidentId": incident_id,
            "action": {"$in": ["ticket_verified_by_supervisor", "ticket_verified_by_department"]},
        },
        {"_id": 1},
    )
    return bool(verification_log)

def _safe_float(value: object) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except Exception:
        return None

def _meters_to_latitude_delta(radius_meters: float) -> float:
    return float(radius_meters) / 111_320.0

def _meters_to_longitude_delta(radius_meters: float, latitude: float) -> float:
    cosine = max(abs(math.cos(math.radians(latitude))), 0.01)
    return float(radius_meters) / (111_320.0 * cosine)

def _haversine_distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    earth_radius_m = 6_371_000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * (math.sin(delta_lambda / 2.0) ** 2)
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(1.0 - a, 0.0)))
    return earth_radius_m * c

def _normalize_duplicate_text(value: str | None) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return ""
    normalized = re.sub(r"[^a-z0-9]+", " ", raw)
    return re.sub(r"\s+", " ", normalized).strip()

def _duplicate_tokens(*parts: str | None) -> set[str]:
    text = " ".join(_normalize_duplicate_text(part) for part in parts if str(part or "").strip())
    if not text:
        return set()
    tokens: set[str] = set()
    for token in text.split():
        if len(token) < 3:
            continue
        if token in DUPLICATE_TEXT_STOPWORDS:
            continue
        tokens.add(token)
    return tokens

def _sequence_similarity(left: str | None, right: str | None) -> float:
    a = _normalize_duplicate_text(left)
    b = _normalize_duplicate_text(right)
    if not a or not b:
        return 0.0
    return float(difflib.SequenceMatcher(None, a, b).ratio())

def _token_overlap_metrics(left_tokens: set[str], right_tokens: set[str]) -> tuple[float, float]:
    if not left_tokens or not right_tokens:
        return 0.0, 0.0
    overlap = left_tokens & right_tokens
    union = left_tokens | right_tokens
    jaccard = len(overlap) / max(len(union), 1)
    min_ratio = len(overlap) / max(min(len(left_tokens), len(right_tokens)), 1)
    return float(jaccard), float(min_ratio)

def _duplicate_similarity_score(
    *,
    candidate: dict,
    title: str | None,
    description: str | None,
    category: str | None,
    severity: str | None,
    scope: str | None,
) -> tuple[float, dict[str, float | bool]]:
    incoming_title = _normalize_duplicate_text(title)
    incoming_description = _normalize_duplicate_text(description)
    incoming_combined = " ".join(part for part in [incoming_title, incoming_description] if part).strip()

    candidate_title = _normalize_duplicate_text(candidate.get("title"))
    candidate_description = _normalize_duplicate_text(candidate.get("description"))
    candidate_combined = " ".join(part for part in [candidate_title, candidate_description] if part).strip()

    incoming_tokens = _duplicate_tokens(title, description)
    candidate_tokens = _duplicate_tokens(candidate.get("title"), candidate.get("description"))
    token_jaccard, token_min_ratio = _token_overlap_metrics(incoming_tokens, candidate_tokens)

    title_ratio = _sequence_similarity(incoming_title, candidate_title)
    description_ratio = _sequence_similarity(incoming_description, candidate_description)
    combined_ratio = _sequence_similarity(incoming_combined, candidate_combined)
    base_text_score = max(
        combined_ratio,
        (description_ratio * 0.7) + (title_ratio * 0.3),
        (token_jaccard * 0.55) + (token_min_ratio * 0.45),
    )

    incoming_category = _normalize_iot_token(category)
    candidate_category = _normalize_iot_token(candidate.get("category"))
    category_match = bool(incoming_category and candidate_category and incoming_category == candidate_category)

    incoming_severity = _normalize_iot_token(severity)
    candidate_severity = _normalize_iot_token(candidate.get("severity"))
    severity_match = bool(incoming_severity and candidate_severity and incoming_severity == candidate_severity)

    incoming_scope = _normalize_iot_token(scope)
    candidate_scope = _normalize_iot_token(candidate.get("scope"))
    scope_match = bool(incoming_scope and candidate_scope and incoming_scope == candidate_scope)

    score = base_text_score
    if category_match:
        score += 0.12
    if severity_match:
        score += 0.04
    if scope_match:
        score += 0.02
    if token_min_ratio >= 0.5:
        score += 0.04

    details: dict[str, float | bool] = {
        "base_text_score": round(base_text_score, 4),
        "title_ratio": round(title_ratio, 4),
        "description_ratio": round(description_ratio, 4),
        "combined_ratio": round(combined_ratio, 4),
        "token_jaccard": round(token_jaccard, 4),
        "token_min_ratio": round(token_min_ratio, 4),
        "category_match": category_match,
        "severity_match": severity_match,
        "scope_match": scope_match,
    }
    return float(score), details

def _is_duplicate_similarity_match(
    *,
    candidate: dict,
    title: str | None,
    description: str | None,
    category: str | None,
    severity: str | None,
    scope: str | None,
) -> tuple[bool, float, dict[str, float | bool]]:
    score, details = _duplicate_similarity_score(
        candidate=candidate,
        title=title,
        description=description,
        category=category,
        severity=severity,
        scope=scope,
    )
    base_text_score = float(details.get("base_text_score") or 0.0)
    category_match = bool(details.get("category_match"))
    token_min_ratio = float(details.get("token_min_ratio") or 0.0)

    if base_text_score < MIN_DUPLICATE_TEXT_SCORE:
        return False, score, details
    if category_match and score >= CATEGORY_MATCH_DUPLICATE_SCORE:
        return True, score, details
    if score >= STRICT_DUPLICATE_TEXT_SCORE and token_min_ratio >= 0.45:
        return True, score, details
    return False, score, details

def _incident_origin_is_local(doc: dict) -> bool:
    reporter_user_type = str(doc.get("reporterUserType") or "").strip().lower()
    if reporter_user_type in LOCAL_USER_TYPES:
        return True
    if reporter_user_type:
        return False

    reporter_id = _clean_user_id(doc.get("reporterId"))
    if not reporter_id:
        return False

    user_doc = None
    try:
        user_doc = users.find_one({"_id": to_object_id(reporter_id)}, {"userType": 1})
    except Exception:
        user_doc = users.find_one({"_id": reporter_id}, {"userType": 1})
    return str((user_doc or {}).get("userType") or "").strip().lower() in LOCAL_USER_TYPES

def _find_local_duplicate_incident(
    *,
    latitude: float | None,
    longitude: float | None,
    title: str | None,
    description: str | None,
    category: str | None,
    severity: str | None,
    scope: str | None,
) -> dict | None:
    lat = _safe_float(latitude)
    lon = _safe_float(longitude)
    radius_meters = max(float(settings.INCIDENT_DUPLICATE_RADIUS_METERS or 0.0), 0.0)
    if lat is None or lon is None or radius_meters <= 0:
        return None

    lat_delta = _meters_to_latitude_delta(radius_meters)
    lon_delta = _meters_to_longitude_delta(radius_meters, lat)
    query = {
        "status": {"$nin": sorted(INACTIVE_DUPLICATE_STATUSES)},
        "latitude": {"$gte": lat - lat_delta, "$lte": lat + lat_delta},
        "longitude": {"$gte": lon - lon_delta, "$lte": lon + lon_delta},
    }

    best_match: dict | None = None
    best_distance: float | None = None
    best_score: float | None = None
    for candidate in incidents.find(query).sort("createdAt", 1).limit(25):
        if not _incident_origin_is_local(candidate):
            continue

        candidate_lat = _safe_float(candidate.get("latitude"))
        candidate_lon = _safe_float(candidate.get("longitude"))
        if candidate_lat is None or candidate_lon is None:
            continue

        distance_meters = _haversine_distance_meters(lat, lon, candidate_lat, candidate_lon)
        if distance_meters > radius_meters:
            continue

        is_match, similarity_score, _details = _is_duplicate_similarity_match(
            candidate=candidate,
            title=title,
            description=description,
            category=category,
            severity=severity,
            scope=scope,
        )
        if not is_match:
            continue

        if (
            best_match is None
            or best_score is None
            or similarity_score > best_score
            or (
                abs(similarity_score - best_score) < 1e-6
                and (best_distance is None or distance_meters < best_distance)
            )
        ):
            best_match = candidate
            best_distance = distance_meters
            best_score = similarity_score

    return best_match

def _merge_local_duplicate_into_incident(existing_doc: dict, current_user: dict, *, now: str) -> dict:
    obj_id = existing_doc.get("_id")
    if not obj_id:
        return existing_doc

    local_reporter_ids: list[str] = []
    reporter_id = _clean_user_id(existing_doc.get("reporterId"))
    if reporter_id:
        local_reporter_ids.append(reporter_id)
    for row in existing_doc.get("localReporterIds") or []:
        clean_value = _clean_user_id(row)
        if clean_value and clean_value not in local_reporter_ids:
            local_reporter_ids.append(clean_value)
    current_user_id = _clean_user_id(current_user.get("id"))
    if current_user_id and current_user_id not in local_reporter_ids:
        local_reporter_ids.append(current_user_id)

    duplicate_report_count = max(
        len(local_reporter_ids),
        int(existing_doc.get("duplicateReportCount") or 0),
        int(existing_doc.get("votes") or 0),
        1,
    )
    common_incident = duplicate_report_count >= 2
    update_fields = {
        "commonIncident": common_incident,
        "duplicateReportCount": duplicate_report_count,
        "lastDuplicateAt": now,
        "localReporterIds": local_reporter_ids,
        "updatedAt": now,
        "votes": duplicate_report_count,
    }
    incidents.update_one({"_id": obj_id}, {"$set": update_fields})
    refreshed = incidents.find_one({"_id": obj_id})
    return refreshed or {**existing_doc, **update_fields}

async def _duplicate_incident_response(existing_doc: dict, current_user: dict, *, now: str) -> dict:
    refreshed = _merge_local_duplicate_into_incident(existing_doc, current_user, now=now)
    payload = _incident_payload_for_user(refreshed, current_user) or {}
    if isinstance(payload, dict):
        payload["duplicateMatch"] = True
    await manager.broadcast(
        predicate=lambda user: _can_receive_incident_event(user, refreshed or {}),
        message_factory=lambda user: _incident_ws_message_for_user(refreshed, user),
    )
    radius_meters = int(round(max(float(settings.INCIDENT_DUPLICATE_RADIUS_METERS or 0.0), 0.0)))
    return {
        "success": True,
        "message": f"A matching incident already exists within {radius_meters} meters. Showing the existing incident instead of creating a duplicate.",
        "data": payload,
    }

def _notify_new_issue(description: str, lat: float | None, lon: float | None):
    try:
        send_alert_email(description, lat, lon)
    except Exception as exc:
        LOGGER.warning("Alert email notification failed: %s", exc)
    text = f"SafeLive alert: {description}. Location {lat}, {lon}."
    try:
        send_stakeholder_notifications(text)
    except Exception as exc:
        LOGGER.warning("Stakeholder notification failed: %s", exc)

def _normalize_incident_status(value: str | None) -> str | None:
    if value is None:
        return None
    status = value.strip().lower()
    if status == "verified":
        return "in_progress"
    if status in {"pending_review", "under_review"}:
        return "pending"
    return status

def _resolve_reporter_email(
    reporter_email: str | None,
    reporter_id: str | None,
    reporter_phone: str | None,
) -> str | None:
    email_value = (reporter_email or "").strip()
    if email_value and "@" in email_value:
        return email_value

    if reporter_id:
        user_doc = None
        try:
            user_doc = users.find_one({"_id": to_object_id(reporter_id)}, {"email": 1})
        except Exception:
            user_doc = users.find_one({"_id": reporter_id}, {"email": 1})
        fallback_email = (user_doc or {}).get("email")
        if fallback_email and "@" in fallback_email:
            return fallback_email.strip()

    if reporter_phone:
        user_doc = users.find_one({"phone": reporter_phone}, {"email": 1})
        fallback_email = (user_doc or {}).get("email")
        if fallback_email and "@" in fallback_email:
            return fallback_email.strip()

    return None

def _send_incident_submission_email_safe(
    to_email: str,
    incident_id: str,
    title: str,
    category: str,
    priority: str | None,
    status: str,
    location: str,
    created_at: str,
):
    try:
        send_incident_submission_email(
            to_email=to_email,
            incident_id=incident_id,
            title=title,
            category=category,
            priority=priority,
            status=status,
            location=location,
            created_at=created_at,
        )
    except Exception as exc:
        LOGGER.warning("Incident submission email delivery failed for %s: %s", to_email, exc)

def _is_valid_email(value: str | None) -> bool:
    email = (value or "").strip()
    return bool(email and "@" in email and "." in email)

def _normalize_role(value: str | None) -> str:
    return (value or "").strip().lower().replace("-", "_").replace(" ", "_")

def _hash_token(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()

def _resolve_critical_review_recipients() -> list[dict]:
    query = {
        "$or": [
            {"officialRole": {"$in": sorted(CRITICAL_APPROVAL_ROLES)}},
            {"userType": "head_supervisor"},
        ]
    }
    cursor = users.find(query, {"email": 1, "name": 1, "officialRole": 1, "userType": 1})
    recipients: list[dict] = []
    seen_emails: set[str] = set()

    for row in cursor:
        email = (row.get("email") or "").strip().lower()
        if not _is_valid_email(email) or email in seen_emails:
            continue

        role = _normalize_role(row.get("officialRole"))
        if role not in CRITICAL_APPROVAL_ROLES:
            role = "supervisor" if _normalize_role(row.get("userType")) == "head_supervisor" else ""
        if role not in CRITICAL_APPROVAL_ROLES:
            continue

        seen_emails.add(email)
        approve_token = secrets.token_urlsafe(24)
        reject_token = secrets.token_urlsafe(24)
        recipients.append(
            {
                "email": email,
                "name": (row.get("name") or row.get("email") or role.title()).strip(),
                "role": role,
                "decision": "pending",
                "decisionAt": None,
                "approveTokenHash": _hash_token(approve_token),
                "rejectTokenHash": _hash_token(reject_token),
                "_approveToken": approve_token,
                "_rejectToken": reject_token,
            }
        )
    return recipients

def _build_critical_review_action_links(incident_id: str, approve_token: str, reject_token: str) -> tuple[str, str]:
    base = settings.DOMAIN.rstrip("/")
    approve_query = urlencode(
        {"incidentId": incident_id, "decision": "approve", "token": approve_token},
        safe="-_.~",
    )
    reject_query = urlencode(
        {"incidentId": incident_id, "decision": "reject", "token": reject_token},
        safe="-_.~",
    )
    approve_url = f"{base}/api/incidents/review/email?{approve_query}"
    reject_url = f"{base}/api/incidents/review/email?{reject_query}"
    return approve_url, reject_url

def _to_public_url(path_value: str | None) -> str | None:
    value = (path_value or "").strip()
    if not value:
        return None
    if value.startswith(("http://", "https://")):
        return value
    normalized = value if value.startswith("/") else f"/{value}"
    return f"{settings.DOMAIN.rstrip('/')}{normalized}"

def _build_critical_email_details(payload: dict) -> tuple[list[tuple[str, str]], list[str]]:
    details: list[tuple[str, str]] = []
    description = (payload.get("description") or "").strip()
    if description:
        details.append(("Description", description))

    status_value = (payload.get("status") or "").strip()
    if status_value:
        details.append(("Current Status", status_value.replace("_", " ").title()))

    for key, label in (
        ("severity", "Severity"),
        ("scope", "Scope"),
        ("source", "Source"),
        ("deviceId", "Device ID"),
        ("ticketId", "Ticket ID"),
        ("reportedBy", "Reported By"),
        ("reporterEmail", "Reporter Email"),
        ("reporterPhone", "Reporter Phone"),
    ):
        value = str(payload.get(key) or "").strip()
        if value:
            details.append((label, value))

    lat = payload.get("latitude")
    lon = payload.get("longitude")
    if lat is not None and lon is not None:
        details.append(("Coordinates", f"{lat}, {lon}"))

    image_urls: list[str] = []
    raw_urls = payload.get("imageUrls")
    if isinstance(raw_urls, list):
        for row in raw_urls:
            public_url = _to_public_url(str(row or ""))
            if public_url:
                image_urls.append(public_url)
    elif payload.get("imageUrl"):
        public_url = _to_public_url(str(payload.get("imageUrl") or ""))
        if public_url:
            image_urls.append(public_url)

    return details, image_urls

def _send_critical_review_email_safe(
    to_email: str,
    reviewer_name: str,
    incident_id: str,
    title: str,
    category: str,
    location: str,
    priority: str,
    created_at: str,
    approve_url: str,
    reject_url: str,
    extra_details: list[tuple[str, str]] | None = None,
    image_urls: list[str] | None = None,
):
    try:
        send_critical_incident_review_email(
            to_email=to_email,
            reviewer_name=reviewer_name,
            incident_id=incident_id,
            title=title,
            category=category,
            location=location,
            priority=priority,
            created_at=created_at,
            approve_url=approve_url,
            reject_url=reject_url,
            extra_details=extra_details,
            image_urls=image_urls,
        )
    except Exception as exc:
        LOGGER.warning("Critical incident review email failed for %s: %s", to_email, exc)

def _parse_iso_datetime(value: str | None) -> datetime | None:
    candidate = (value or "").strip()
    if not candidate:
        return None
    if candidate.endswith("Z"):
        candidate = f"{candidate[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None
    if parsed.tzinfo:
        return parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed

def _incident_review_html(title: str, message: str) -> HTMLResponse:
    html = (
        "<!doctype html><html><head><meta charset='utf-8'>"
        f"<title>{title}</title></head>"
        "<body style='font-family:Arial,sans-serif;background:#f3f5f9;padding:28px'>"
        "<div style='max-width:640px;margin:0 auto;background:#fff;border:1px solid #e6ebf2;border-radius:8px;padding:20px'>"
        f"<h2 style='margin:0 0 10px 0;color:#1d2939'>{title}</h2>"
        f"<p style='margin:0;color:#344054;line-height:1.6'>{message}</p>"
        "</div></body></html>"
    )
    return HTMLResponse(content=html)

def _sanitize_incident_payload(payload: dict | None) -> dict | None:
    if not isinstance(payload, dict):
        return payload
    payload.pop("localReporterIds", None)
    payload.pop("reporterUserType", None)
    approval = payload.get("criticalApproval")
    if isinstance(approval, dict):
        recipients = approval.get("recipients")
        if isinstance(recipients, list):
            for recipient in recipients:
                if isinstance(recipient, dict):
                    recipient.pop("approveTokenHash", None)
                    recipient.pop("rejectTokenHash", None)
    return payload

def _incident_payload_for_user(doc: dict | None, user: dict | None) -> dict | None:
    if not isinstance(doc, dict):
        return None
    payload = _sanitize_incident_payload(serialize_doc(doc)) or {}
    if not isinstance(payload, dict) or not isinstance(user, dict):
        return payload
    if _is_official(user):
        return payload
    if _is_primary_local_reporter(doc, user):
        return payload
    if _is_common_incident(doc):
        payload.pop("reportedBy", None)
        payload.pop("reporterId", None)
        payload.pop("reporterEmail", None)
        payload.pop("reporterPhone", None)
    return payload

def _incident_ws_message_for_user(doc: dict | None, user: dict | None) -> dict | None:
    payload = _incident_payload_for_user(doc, user)
    if not isinstance(payload, dict):
        return None
    return {
        "type": "NEW_INCIDENT",
        "data": payload,
    }

def _create_ticket_from_incident(doc: dict):
    if not doc:
        return None
    created_at = doc.get("createdAt") or _now_iso()
    parsed_created_at = _parse_iso_datetime(created_at) or datetime.utcnow()
    month_key = parsed_created_at.strftime("%y%m")
    counter_doc = counters.find_one_and_update(
        {"_id": f"ticket_seq_{month_key}"},
        {"$inc": {"seq": 1}, "$setOnInsert": {"createdAt": _now_iso()}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    serial = int((counter_doc or {}).get("seq") or 1)
    public_ticket_id = f"{month_key}{serial:04d}"

    ticket_doc = {
        "ticketId": public_ticket_id,
        "title": doc.get("title"),
        "description": doc.get("description"),
        "category": doc.get("category"),
        "priority": doc.get("priority") or "medium",
        "status": _normalize_incident_status(doc.get("status")) or "open",
        "location": doc.get("location"),
        "latitude": doc.get("latitude"),
        "longitude": doc.get("longitude"),
        "imageUrl": doc.get("imageUrl"),
        "imageUrls": doc.get("imageUrls"),
        "reportedBy": doc.get("reportedBy"),
        "reporterEmail": doc.get("reporterEmail"),
        "reporterPhone": doc.get("reporterPhone"),
        "assignedTo": doc.get("assignedTo"),
        "incidentId": str(doc.get("_id")),
        "createdAt": created_at,
        "updatedAt": doc.get("updatedAt") or _now_iso()
    }
    result = tickets.insert_one(ticket_doc)
    return {"id": result.inserted_id, "ticketId": public_ticket_id}

def _incident_rows_for_user(current_user: dict) -> list[dict]:
    if _is_official(current_user):
        data = list(incidents.find({}).sort("createdAt", -1))
        if _current_official_role(current_user) == ROLE_FIELD_INSPECTOR:
            data = [row for row in data if _has_department_or_supervisor_verification(row)]
        return data

    current_user_id = str(current_user.get("id") or "").strip()
    if not current_user_id:
        return []

    reporter_selectors: list[dict] = [{"reporterId": current_user_id}]
    try:
        reporter_selectors.append({"reporterId": to_object_id(current_user_id)})
    except Exception:
        pass

    query = {
        "$or": [
            {"commonIncident": True},
            *reporter_selectors,
        ]
    }
    data = list(incidents.find(query).sort("createdAt", -1))
    return [row for row in data if _can_view_incident(row, current_user)]

@router.get("/incidents")
@router.get("/issues")
def get_incidents(current_user: dict = Depends(get_current_user)):
    data = _incident_rows_for_user(current_user)
    safe_data: list[dict] = []
    for row in data:
        row["officialActionTaken"] = _reporter_edit_locked(row)
        row["reporterDeleteLocked"] = _reporter_delete_locked(row)
        payload = _incident_payload_for_user(row, current_user)
        if isinstance(payload, dict):
            safe_data.append(payload)
    return {"success": True, "data": safe_data}

@router.get("/incidents/stats")
@router.get("/issues/stats")
def stats(current_user: dict = Depends(get_current_user)):
    data = _incident_rows_for_user(current_user)
    total = len(data)
    open_c = sum(1 for row in data if (row.get("status") or "").strip().lower() == "open")
    pending_c = sum(1 for row in data if (row.get("status") or "").strip().lower() == "pending")
    in_prog = sum(1 for row in data if (row.get("status") or "").strip().lower() == "in_progress")
    resolved = sum(1 for row in data if (row.get("status") or "").strip().lower() == "resolved")
    return {
        "success": True,
        "data": {
            "total": total,
            "open": open_c,
            "inProgress": in_prog,
            "resolved": resolved,
            "pending": pending_c
        }
    }

@router.get("/incidents/{incident_id}")
@router.get("/issues/{incident_id}")
def get_incident(incident_id: str, current_user: dict = Depends(get_current_user)):
    doc = _get_incident_doc(incident_id)
    if not _can_view_incident(doc, current_user):
        raise HTTPException(status_code=403, detail="Access denied")
    doc["officialActionTaken"] = _reporter_edit_locked(doc)
    doc["reporterDeleteLocked"] = _reporter_delete_locked(doc)
    return {"success": True, "data": _incident_payload_for_user(doc, current_user)}

@router.get("/incidents/{incident_id}/logbook")
@router.get("/issues/{incident_id}/logbook")
def get_incident_logbook_entries(incident_id: str, current_user: dict = Depends(get_current_user)):
    doc = _get_incident_doc(incident_id)
    if not _can_view_incident(doc, current_user):
        raise HTTPException(status_code=403, detail="Access denied")
    data = get_incident_logbook(incident_id)
    return {"success": True, "data": data}

@router.post("/incidents")
@router.post("/issues")
async def create_incident(
    incident: IncidentCreate,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
):
    data = incident.dict()
    images = data.pop("images", None)
    if data.get("priority"):
        data["priority"] = _normalize_priority_value(data.get("priority"), default="medium")
    now = _now_iso()
    incident_status = "open"
    should_alert_stakeholders = True
    critical_email_recipients: list[dict] = []

    if not _is_official(current_user):
        duplicate_doc = _find_local_duplicate_incident(
            latitude=data.get("latitude"),
            longitude=data.get("longitude"),
            title=data.get("title"),
            description=data.get("description"),
            category=data.get("category"),
            severity=data.get("severity"),
            scope=data.get("scope"),
        )
        if duplicate_doc:
            return await _duplicate_incident_response(duplicate_doc, current_user, now=now)

        validation = validate_incident_report(
            title=data.get("title"),
            description=data.get("description"),
            category=data.get("category"),
            image_payloads=images or [],
        )
        data["aiValidation"] = {
            "isCorrect": validation.is_valid,
            "confidence": validation.confidence,
            "combinedScore": validation.combined_score,
            "descriptionScore": validation.description_score,
            "imageScore": validation.image_score,
            "reason": validation.reason,
            "source": validation.source,
            "evaluatedAt": now,
        }

        if validation.is_valid:
            priority_prediction = predict_incident_priority(
                title=data.get("title"),
                description=data.get("description"),
                category=data.get("category"),
                severity=data.get("severity"),
                scope=data.get("scope"),
                source=data.get("source"),
                location=data.get("location"),
                image_payloads=images or [],
            )
            normalized_priority = _normalize_priority_value(priority_prediction.priority, default="medium")
            data["priority"] = normalized_priority
            data["aiPriority"] = {
                "priority": normalized_priority,
                "confidence": priority_prediction.confidence,
                "source": priority_prediction.source,
                "evaluatedAt": now,
            }

            is_high_priority = normalized_priority == "high"
            if is_high_priority and settings.CRITICAL_INCIDENT_EMAIL_APPROVAL_ENABLED:
                incident_status = "pending"
                data["pendingReason"] = "critical_email_approval_required"
                recipients = _resolve_critical_review_recipients()
                ttl_hours = max(int(settings.CRITICAL_INCIDENT_EMAIL_APPROVAL_EXPIRE_HOURS), 1)
                expires_at = (datetime.utcnow() + timedelta(hours=ttl_hours)).isoformat()

                persisted_recipients: list[dict] = []
                for recipient in recipients:
                    persisted_recipients.append(
                        {
                            "email": recipient.get("email"),
                            "name": recipient.get("name"),
                            "role": recipient.get("role"),
                            "decision": recipient.get("decision") or "pending",
                            "decisionAt": None,
                            "approveTokenHash": recipient.get("approveTokenHash"),
                            "rejectTokenHash": recipient.get("rejectTokenHash"),
                        }
                    )

                if persisted_recipients:
                    data["criticalApproval"] = {
                        "required": True,
                        "state": "pending",
                        "requestedAt": now,
                        "expiresAt": expires_at,
                        "recipients": persisted_recipients,
                    }
                    critical_email_recipients = recipients
                else:
                    data["criticalApproval"] = {
                        "required": True,
                        "state": "unavailable",
                        "requestedAt": now,
                        "expiresAt": expires_at,
                        "recipients": [],
                    }
                    data["pendingReason"] = "critical_email_recipients_unavailable"
                    LOGGER.warning("No supervisor/department recipients available for critical incident emails.")
        else:
            incident_status = "pending"
            data["pendingReason"] = "ai_validation_review_required"
            data["reviewRequired"] = True
            should_alert_stakeholders = False

    if not _is_official(current_user):
        duplicate_doc = _find_local_duplicate_incident(
            latitude=data.get("latitude"),
            longitude=data.get("longitude"),
            title=data.get("title"),
            description=data.get("description"),
            category=data.get("category"),
            severity=data.get("severity"),
            scope=data.get("scope"),
        )
        if duplicate_doc:
            return await _duplicate_incident_response(duplicate_doc, current_user, now=now)

    image_urls = _save_images(images)
    if image_urls:
        data["imageUrls"] = image_urls
        data["imageUrl"] = image_urls[0]

    data.update({
        "incidentId": _next_public_incident_id(now),
        "status": incident_status,
        "createdAt": now,
        "updatedAt": now,
        "hasMessages": False,
        "officialActionTaken": False,
    })
    if current_user:
        data["reportedBy"] = current_user.get("name") or current_user.get("email") or current_user.get("phone")
        data["reporterId"] = current_user.get("id")
        data["reporterUserType"] = _user_type_value(current_user)
        reporter_email = _resolve_reporter_email(
            current_user.get("email"),
            current_user.get("id"),
            current_user.get("phone"),
        )
        data["reporterEmail"] = reporter_email
        data["reporterPhone"] = current_user.get("phone")
        if not _is_official(current_user):
            current_user_id = _clean_user_id(current_user.get("id"))
            data["commonIncident"] = False
            data["duplicateReportCount"] = 1
            data["votes"] = max(int(data.get("votes") or 0), 1)
            if current_user_id:
                data["localReporterIds"] = [current_user_id]
    result = incidents.insert_one(data)
    doc = incidents.find_one({"_id": result.inserted_id})
    ticket_info = _create_ticket_from_incident(doc)
    if ticket_info:
        incidents.update_one({"_id": result.inserted_id}, {"$set": {"ticketId": ticket_info.get("ticketId")}})
        doc = incidents.find_one({"_id": result.inserted_id})
    payload = _incident_payload_for_user(doc, current_user) or {}
    reporter_email = _resolve_reporter_email(
        doc.get("reporterEmail") if isinstance(doc, dict) else None,
        doc.get("reporterId") if isinstance(doc, dict) else None,
        doc.get("reporterPhone") if isinstance(doc, dict) else None,
    )
    if reporter_email and not _is_official(current_user):
        background_tasks.add_task(
            _send_incident_submission_email_safe,
            reporter_email,
            payload.get("incidentId") or payload.get("id") or "",
            payload.get("title") or "",
            payload.get("category") or "",
            payload.get("priority"),
            payload.get("status") or "open",
            payload.get("location") or "",
            payload.get("createdAt") or now,
        )
    elif not _is_official(current_user):
        LOGGER.warning(
            "Incident submission email skipped: reporter email unavailable for incident %s",
            payload.get("incidentId") or payload.get("id"),
        )

    if critical_email_recipients and payload.get("id"):
        extra_details, image_urls = _build_critical_email_details(payload)
        for recipient in critical_email_recipients:
            approve_token = (recipient.get("_approveToken") or "").strip()
            reject_token = (recipient.get("_rejectToken") or "").strip()
            to_email = (recipient.get("email") or "").strip()
            if not approve_token or not reject_token or not to_email:
                continue
            approve_url, reject_url = _build_critical_review_action_links(
                payload.get("id"),
                approve_token,
                reject_token,
            )
            background_tasks.add_task(
                _send_critical_review_email_safe,
                to_email,
                recipient.get("name") or recipient.get("role") or "Reviewer",
                payload.get("incidentId") or payload.get("id"),
                payload.get("title") or "",
                payload.get("category") or "",
                payload.get("location") or "",
                _normalize_priority_value(payload.get("priority"), default="high"),
                payload.get("createdAt") or now,
                approve_url,
                reject_url,
                extra_details,
                image_urls,
            )

    if should_alert_stakeholders:
        _notify_new_issue(payload.get("description", ""), payload.get("latitude"), payload.get("longitude"))
    await manager.broadcast(
        predicate=lambda user: _can_receive_incident_event(user, doc or {}),
        message_factory=lambda user: _incident_ws_message_for_user(doc, user),
    )
    return {"success": True, "data": payload}

@router.get("/incidents/review/email", response_class=HTMLResponse, include_in_schema=False)
@router.get("/issues/review/email", response_class=HTMLResponse, include_in_schema=False)
def review_critical_incident_via_email(incidentId: str, decision: str, token: str):
    decision_value = (decision or "").strip().lower()
    if decision_value not in {"approve", "reject"}:
        return _incident_review_html("Invalid Action", "The review action is invalid.")

    token_value = (token or "").strip()
    if not token_value:
        return _incident_review_html("Invalid Link", "This review link is invalid or incomplete.")

    try:
        doc = _get_incident_doc(incidentId)
    except HTTPException as exc:
        if exc.status_code == 404:
            return _incident_review_html("Incident Not Found", "This incident review link is no longer valid.")
        return _incident_review_html("Invalid Incident", "This incident review link is invalid.")

    approval_block = doc.get("criticalApproval")
    if not isinstance(approval_block, dict) or not approval_block.get("required"):
        return _incident_review_html("Review Not Required", "This incident does not require email approval.")

    current_state = (approval_block.get("state") or "").strip().lower()
    if current_state == "approved":
        return _incident_review_html("Already Approved", "This incident has already been approved and moved to in progress.")

    expires_at = _parse_iso_datetime(approval_block.get("expiresAt"))
    now_dt = datetime.utcnow()
    if expires_at and now_dt > expires_at:
        now_iso = _now_iso()
        incidents.update_one(
            {"_id": doc.get("_id")},
            {
                "$set": {
                    "criticalApproval.state": "expired",
                    "updatedAt": now_iso,
                    "pendingReason": "critical_email_approval_expired",
                }
            },
        )
        return _incident_review_html("Review Expired", "This review link has expired. Please review the incident in dashboard.")

    hashed_token = _hash_token(token_value)
    recipients = approval_block.get("recipients")
    if not isinstance(recipients, list) or not recipients:
        return _incident_review_html("Review Unavailable", "No reviewer records were found for this incident.")

    matched = None
    expected_key = "approveTokenHash" if decision_value == "approve" else "rejectTokenHash"
    for recipient in recipients:
        expected_hash = str(recipient.get(expected_key) or "").strip()
        if expected_hash and secrets.compare_digest(expected_hash, hashed_token):
            matched = recipient
            break

    if not matched:
        return _incident_review_html("Invalid Link", "This review link is invalid or has already been replaced.")

    prior_decision = (matched.get("decision") or "pending").strip().lower()
    if prior_decision == decision_value:
        return _incident_review_html("Already Submitted", "Your decision was already recorded for this incident.")

    now_iso = _now_iso()
    matched["decision"] = decision_value
    matched["decisionAt"] = now_iso

    approvals = 0
    pending = 0
    for recipient in recipients:
        user_decision = (recipient.get("decision") or "pending").strip().lower()
        if user_decision == "approve":
            approvals += 1
        elif user_decision not in {"reject"}:
            pending += 1

    incident_status = _normalize_incident_status(doc.get("status")) or "pending"
    new_state = "pending"
    pending_reason = doc.get("pendingReason")

    if approvals > 0:
        new_state = "approved"
        incident_status = "in_progress"
        pending_reason = None
    elif pending == 0:
        new_state = "rejected"
        incident_status = "pending"
        pending_reason = "critical_email_rejected"

    set_updates = {
        "criticalApproval.recipients": recipients,
        "criticalApproval.state": new_state,
        "criticalApproval.lastDecisionAt": now_iso,
        "updatedAt": now_iso,
        "status": incident_status,
    }
    update_op: dict = {"$set": set_updates}
    if pending_reason:
        set_updates["pendingReason"] = pending_reason
    else:
        update_op["$unset"] = {"pendingReason": ""}
    incidents.update_one({"_id": doc.get("_id")}, update_op)

    tickets.update_one(
        {"incidentId": str(doc.get("_id"))},
        {
            "$set": {
                "status": incident_status,
                "updatedAt": now_iso,
            }
        },
    )

    if incident_status == "in_progress":
        return _incident_review_html(
            "Incident Approved",
            "Your approval has been recorded. The incident was moved to in progress.",
        )

    if decision_value == "reject":
        return _incident_review_html(
            "Incident Rejected",
            "Your rejection has been recorded. The incident remains pending for supervisor review.",
        )

    return _incident_review_html(
        "Decision Recorded",
        "Your decision was saved. The incident is awaiting remaining reviewer decisions.",
    )

@router.post("/iot/incidents")
@router.post("/report")
async def report_issue(
    issue: IssueIn,
    request: Request,
    x_iot_api_key: str | None = Header(default=None, alias="X-IoT-Api-Key"),
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
    authorization: str | None = Header(default=None),
):
    request_path = request.url.path.rstrip("/").lower()
    if request_path.endswith("/report") and not settings.IOT_ACCEPT_LEGACY_REPORT_ENDPOINT:
        raise HTTPException(status_code=410, detail="Legacy endpoint disabled. Use /api/iot/incidents")

    api_key = _extract_iot_api_key(x_iot_api_key, x_api_key, authorization)
    _validate_iot_api_key(api_key)

    latitude = float(issue.latitude)
    longitude = float(issue.longitude)
    if latitude < -90 or latitude > 90:
        raise HTTPException(status_code=400, detail="Latitude must be between -90 and 90")
    if longitude < -180 or longitude > 180:
        raise HTTPException(status_code=400, detail="Longitude must be between -180 and 180")

    source_value = _normalize_iot_token(issue.source) or "edge"
    allowed_sources = {_normalize_iot_token(item) for item in settings.IOT_ALLOWED_SOURCES if item}
    if allowed_sources and source_value not in allowed_sources:
        raise HTTPException(status_code=400, detail=f"Unsupported source '{source_value}'")

    description = _sanitize_iot_text(issue.description, max_len=2000)
    if len(description) < 3:
        raise HTTPException(status_code=400, detail="Description is too short")

    severity_value = _normalize_iot_severity(issue.severity)
    fallback_priority = _resolve_iot_priority(severity_value)
    priority_value = fallback_priority
    scope_value = _normalize_iot_token(issue.scope) or "city"
    category_value = _normalize_iot_token(issue.category) or "ai"
    device_id = _sanitize_iot_text(issue.deviceId, default="unknown-device", max_len=128)
    event_id = _sanitize_iot_text(issue.eventId, max_len=128)
    sensor_type = _sanitize_iot_text(issue.sensorType, max_len=80)

    confidence = issue.confidence
    if confidence is not None and (confidence < 0 or confidence > 1):
        raise HTTPException(status_code=400, detail="Confidence must be between 0 and 1")

    captured_at_value: str | None = None
    raw_captured_at = _sanitize_iot_text(issue.capturedAt, max_len=64)
    if raw_captured_at:
        parsed_captured_at = _parse_iso_datetime(raw_captured_at)
        if not parsed_captured_at:
            raise HTTPException(status_code=400, detail="capturedAt must be a valid ISO datetime")
        captured_at_value = parsed_captured_at.isoformat()

    image_payloads: list[str] = []
    if issue.image:
        image_payloads.append(issue.image)
    if isinstance(issue.images, list):
        image_payloads.extend(issue.images)

    cleaned_images: list[str] = []
    for raw_image in image_payloads:
        image_value = str(raw_image or "").strip()
        if not image_value:
            continue
        if image_value.startswith("data:") and "," in image_value:
            image_value = image_value.split(",", 1)[1].strip()
        if settings.IOT_MAX_IMAGE_BASE64_LENGTH > 0 and len(image_value) > settings.IOT_MAX_IMAGE_BASE64_LENGTH:
            raise HTTPException(status_code=413, detail="Image payload is too large")
        cleaned_images.append(image_value)

    if settings.IOT_MAX_IMAGE_COUNT > 0 and len(cleaned_images) > settings.IOT_MAX_IMAGE_COUNT:
        raise HTTPException(status_code=400, detail=f"Maximum {settings.IOT_MAX_IMAGE_COUNT} images allowed")
    if settings.IOT_REQUIRE_IMAGE and not cleaned_images:
        raise HTTPException(status_code=400, detail="At least one image is required")

    metadata = issue.metadata if isinstance(issue.metadata, dict) else None
    if metadata and len(metadata) > 64:
        raise HTTPException(status_code=400, detail="Metadata contains too many keys")

    now = _now_iso()
    if event_id:
        existing = incidents.find_one({"eventId": event_id, "deviceId": device_id})
        if existing:
            payload = _sanitize_incident_payload(serialize_doc(existing)) or {}
            return {
                "success": True,
                "duplicate": True,
                "ack": {
                    "incidentId": payload.get("incidentId") or payload.get("id"),
                    "ticketId": payload.get("ticketId"),
                    "eventId": event_id,
                    "receivedAt": now,
                    "duplicate": True,
                },
                "data": payload,
            }

    image_urls = _save_images(cleaned_images)

    location_value = _sanitize_iot_text(issue.location, max_len=180)
    if not location_value:
        location_value = f"{latitude}, {longitude}"

    title = f"IoT Alert from {device_id}"
    if sensor_type:
        title = f"IoT {sensor_type} Alert"

    priority_prediction = predict_incident_priority(
        title=title,
        description=description,
        category=category_value,
        severity=severity_value,
        scope=scope_value,
        source=source_value,
        location=location_value,
        image_payloads=cleaned_images,
    )
    priority_value = _normalize_priority_value(priority_prediction.priority, default=fallback_priority)

    data = {
        "incidentId": _next_public_incident_id(now),
        "title": title,
        "description": description,
        "category": category_value,
        "priority": priority_value,
        "location": location_value,
        "latitude": latitude,
        "longitude": longitude,
        "severity": severity_value,
        "scope": scope_value,
        "source": source_value,
        "deviceId": device_id,
        "status": "open",
        "createdAt": now,
        "updatedAt": now,
        "hasMessages": False,
        "officialActionTaken": False,
        "reporterUserType": "iot",
        "reportedBy": _sanitize_iot_text(issue.reportedBy, default=f"IoT Device {device_id}", max_len=120),
        "aiPriority": {
            "priority": priority_value,
            "confidence": priority_prediction.confidence,
            "source": priority_prediction.source,
            "evaluatedAt": now,
        },
        "ingestion": {
            "receivedAt": now,
            "remoteIp": _resolve_request_ip(request),
            "cfRay": _sanitize_iot_text(request.headers.get("cf-ray"), max_len=120) or None,
            "userAgent": _sanitize_iot_text(request.headers.get("user-agent"), max_len=240) or None,
        },
    }
    if event_id:
        data["eventId"] = event_id
    if sensor_type:
        data["sensorType"] = sensor_type
    if confidence is not None:
        data["confidence"] = float(confidence)
    if captured_at_value:
        data["capturedAt"] = captured_at_value
    if metadata:
        data["metadata"] = metadata
    if image_urls:
        data["imageUrls"] = image_urls
        data["imageUrl"] = image_urls[0]

    result = incidents.insert_one(data)
    doc = incidents.find_one({"_id": result.inserted_id})
    ticket_info = _create_ticket_from_incident(doc)
    if ticket_info:
        incidents.update_one({"_id": result.inserted_id}, {"$set": {"ticketId": ticket_info.get("ticketId")}})
        doc = incidents.find_one({"_id": result.inserted_id})

    payload = _sanitize_incident_payload(serialize_doc(doc)) or {}
    _notify_new_issue(description, latitude, longitude)
    await manager.broadcast(
        predicate=lambda user: _can_receive_incident_event(user, doc or {}),
        message_factory=lambda user: _incident_ws_message_for_user(doc, user),
    )
    return {
        "success": True,
        "ack": {
            "incidentId": payload.get("incidentId") or payload.get("id"),
            "ticketId": payload.get("ticketId"),
            "eventId": event_id or None,
            "receivedAt": now,
            "duplicate": False,
        },
        "data": payload,
    }

@router.put("/incidents/{incident_id}")
@router.put("/issues/{incident_id}")
def update_incident(incident_id: str, incident: IncidentUpdate, current_user: dict = Depends(get_current_user)):
    existing_doc = _get_incident_doc(incident_id)
    is_official_user = _is_official(current_user)
    updates = incident.dict(exclude_unset=True, exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")

    if not is_official_user:
        if not _is_primary_local_reporter(existing_doc, current_user):
            raise HTTPException(status_code=403, detail="Access denied")
        if _reporter_edit_window_expired(existing_doc):
            raise HTTPException(
                status_code=403,
                detail=f"Local users can only edit incidents within {LOCAL_REPORTER_EDIT_WINDOW_MINUTES} minutes of upload",
            )
        if _reporter_edit_locked(existing_doc):
            raise HTTPException(status_code=403, detail="Incident can no longer be edited after verification")
        allowed_fields = {"title", "description", "category", "location", "latitude", "longitude", "images"}
        disallowed_fields = sorted([key for key in updates.keys() if key not in allowed_fields])
        if disallowed_fields:
            raise HTTPException(
                status_code=403,
                detail=f"Local users can only edit basic details before verification: {', '.join(disallowed_fields)}",
            )

    if "status" in updates:
        normalized_status = _normalize_incident_status(updates.get("status"))
        if normalized_status not in INCIDENT_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status")
        updates["status"] = normalized_status
    if "priority" in updates:
        updates["priority"] = _normalize_priority_value(updates.get("priority"), default="medium")
    if is_official_user:
        updates["officialActionTaken"] = True
    images = updates.pop("images", None)
    if images is not None:
        image_urls = _save_images(images)
        if image_urls:
            updates["imageUrls"] = image_urls
            updates["imageUrl"] = image_urls[0]
    updates["updatedAt"] = _now_iso()
    obj_id = existing_doc.get("_id")
    incidents.update_one({"_id": obj_id}, {"$set": updates})
    doc = incidents.find_one({"_id": obj_id})
    if doc:
        ticket_updates = {}
        for field in [
            "title",
            "description",
            "category",
            "priority",
            "status",
            "location",
            "latitude",
            "longitude",
            "assignedTo",
            "imageUrl",
            "imageUrls",
        ]:
            if field in updates:
                ticket_updates[field] = doc.get(field)
        if ticket_updates:
            ticket_updates["updatedAt"] = doc.get("updatedAt")
            tickets.update_one({"incidentId": str(doc.get("_id"))}, {"$set": ticket_updates})
        resolved_email = _resolve_reporter_email(
            doc.get("reporterEmail"),
            doc.get("reporterId"),
            doc.get("reporterPhone"),
        )
        if updates.get("status") == "resolved" and resolved_email:
            try:
                send_ticket_update_email(
                    resolved_email,
                    doc.get("title", "Ticket"),
                    "resolved",
                )
            except Exception as exc:
                LOGGER.warning("Resolved notification email failed for incident %s: %s", incident_id, exc)
        elif updates.get("status") == "resolved":
            LOGGER.warning("Resolved notification email skipped: reporter email unavailable for incident %s", incident_id)
    return {"success": True, "data": _incident_payload_for_user(doc, current_user)}

@router.delete("/incidents/{incident_id}")
@router.delete("/issues/{incident_id}")
def delete_incident(incident_id: str, current_user: dict = Depends(get_current_user)):
    doc = _get_incident_doc(incident_id)
    obj_id = doc.get("_id")
    if not obj_id:
        raise HTTPException(status_code=404, detail="Incident not found")

    if not _is_official(current_user):
        if not _is_primary_local_reporter(doc, current_user):
            raise HTTPException(status_code=403, detail="Access denied")
        reporter_id = str(doc.get("reporterId") or "").strip()
        current_user_id = str(current_user.get("id") or "").strip()
        if reporter_id and reporter_id != current_user_id:
            raise HTTPException(status_code=403, detail="Access denied")
        if _reporter_delete_locked(doc):
            raise HTTPException(status_code=403, detail="Incident can no longer be deleted after verification")

    result = incidents.delete_one({"_id": obj_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Incident not found")
    messages.delete_many({"incidentId": {"$in": [incident_id, str(obj_id), obj_id]}})
    tickets.delete_many(
        {
            "$or": [
                {"incidentId": incident_id},
                {"incidentId": str(obj_id)},
                {"incidentId": obj_id},
            ]
        }
    )
    return {"success": True, "data": True}

@router.get("/incidents/{incident_id}/messages")
@router.get("/issues/{incident_id}/messages")
def get_messages(incident_id: str, current_user: dict = Depends(get_current_user)):
    incident_doc = _get_incident_doc(incident_id)
    if not _can_participate_in_incident(incident_doc, current_user):
        raise HTTPException(status_code=403, detail="Access denied")
    data = list(messages.find({"incidentId": incident_id}).sort("createdAt", 1))
    return {"success": True, "data": serialize_list(data)}

@router.post("/incidents/{incident_id}/messages")
@router.post("/issues/{incident_id}/messages")
async def create_message(incident_id: str, payload: MessageCreate, current_user: dict = Depends(get_current_user)):
    incident_doc = _get_incident_doc(incident_id)
    if not _can_participate_in_incident(incident_doc, current_user):
        raise HTTPException(status_code=403, detail="Access denied")
    message_doc = {
        "incidentId": incident_id,
        "message": payload.message,
        "sender": current_user.get("name") or current_user.get("email") or current_user.get("phone"),
        "senderId": current_user.get("id"),
        "createdAt": _now_iso()
    }
    result = messages.insert_one(message_doc)
    incidents.update_one({"_id": to_object_id(incident_id)}, {"$set": {"hasMessages": True, "updatedAt": _now_iso()}})
    doc = messages.find_one({"_id": result.inserted_id})
    return {"success": True, "data": serialize_doc(doc)}
