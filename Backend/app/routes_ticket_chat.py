
from __future__ import annotations

import json
import textwrap
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from app.auth import get_current_user, is_official_account
from app.config.settings import settings
from app.database import incident_logs, incidents, ticket_chat_messages, ticket_chat_sessions, tickets, users
from app.roles import normalize_official_role
from app.services.ws_manager import manager
from app.utils import serialize_doc, serialize_list, to_object_id

router = APIRouter(prefix="/api/tickets")

ROLE_LOCAL = "citizen"
ROLE_DEPARTMENT = "department"
ROLE_SUPERVISOR = "supervisor"
TARGET_ROLES = {ROLE_DEPARTMENT, ROLE_SUPERVISOR}
ALLOWED_OFFICIAL_CHAT_ROLES = {ROLE_DEPARTMENT, ROLE_SUPERVISOR}
CHAT_RETENTION_HOURS = 48
MAX_MESSAGE_LENGTH = 4000
MAX_ATTACHMENT_COUNT = 5
MAX_ATTACHMENT_SIZE_BYTES = 15 * 1024 * 1024
SUPPORTED_CHAT_ENCRYPTION_ALGORITHMS = {"AES-GCM"}
PDF_PAGE_WIDTH = 595
PDF_PAGE_HEIGHT = 842


class TicketChatSessionCreate(BaseModel):
    targetRole: str
    targetUserId: str | None = None
    localUserId: str | None = None


class TicketChatSessionCryptoKeyUpsert(BaseModel):
    publicKeyJwk: dict[str, Any]
    algorithm: str | None = "ECDH-P256"
    fingerprint: str | None = None


class TicketChatIdentityKeyUpsert(BaseModel):
    publicKeyJwk: dict[str, Any]
    algorithm: str | None = "ECDH-P256"
    fingerprint: str | None = None


def _now_dt() -> datetime:
    return datetime.utcnow()


def _retention_expires_at(now: datetime | None = None) -> datetime:
    ref = now or _now_dt()
    return ref + timedelta(hours=CHAT_RETENTION_HOURS)


def _normalize_role(value: str | None) -> str:
    return (normalize_official_role(value) or "").strip()


def _clean_user_id(value: str | None) -> str:
    return str(value or "").strip()


def _normalize_user_type(value: str | None) -> str:
    raw = str(value or "").strip().lower()
    if raw in {"local", ROLE_LOCAL}:
        return ROLE_LOCAL
    return raw


def _is_citizen(current_user: dict) -> bool:
    return _normalize_user_type(current_user.get("userType")) == ROLE_LOCAL


def _resolve_chat_role(current_user: dict) -> str:
    if _is_citizen(current_user):
        return ROLE_LOCAL

    if not is_official_account(current_user):
        raise HTTPException(status_code=403, detail="Chat is available only for local users, department, and supervisor")

    official_role = _normalize_role(current_user.get("officialRole"))
    if official_role in ALLOWED_OFFICIAL_CHAT_ROLES:
        return official_role

    user_type = _normalize_user_type(current_user.get("userType"))
    if user_type == "head_supervisor":
        return ROLE_SUPERVISOR

    raise HTTPException(status_code=403, detail="Only department and supervisor officials can access chat")


def _find_user_doc(user_id: str | None, projection: dict | None = None) -> dict | None:
    candidate_id = _clean_user_id(user_id)
    if not candidate_id:
        return None
    doc = None
    try:
        doc = users.find_one({"_id": to_object_id(candidate_id)}, projection)
    except Exception:
        doc = None
    if doc:
        return doc
    return users.find_one({"_id": candidate_id}, projection)


def _user_display_name(doc: dict | None, fallback: str = "User") -> str:
    if not isinstance(doc, dict):
        return fallback
    return str(doc.get("name") or doc.get("fullName") or doc.get("email") or doc.get("phone") or fallback).strip() or fallback


def _ticket_selectors(ticket_ref: str) -> list[dict]:
    selectors: list[dict] = []
    clean_ref = ticket_ref.strip()
    if not clean_ref:
        return selectors

    selectors.append({"ticketId": clean_ref})
    selectors.append({"incidentId": clean_ref})

    try:
        selectors.append({"_id": to_object_id(clean_ref)})
    except Exception:
        pass

    return selectors


def _get_ticket_doc(ticket_ref: str) -> dict:
    selectors = _ticket_selectors(ticket_ref)
    if not selectors:
        raise HTTPException(status_code=400, detail="Invalid ticket reference")

    doc = tickets.find_one({"$or": selectors})
    if not doc:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return doc


def _resolve_ticket_reporter(ticket_doc: dict) -> dict | None:
    reporter_id = _clean_user_id(ticket_doc.get("reporterId"))
    reporter_name = str(ticket_doc.get("reportedBy") or "").strip()

    incident_id = _clean_user_id(ticket_doc.get("incidentId"))
    if incident_id:
        incident_doc = None
        try:
            incident_doc = incidents.find_one({"_id": to_object_id(incident_id)}, {"reporterId": 1, "reportedBy": 1})
        except Exception:
            incident_doc = incidents.find_one({"_id": incident_id}, {"reporterId": 1, "reportedBy": 1})

        if incident_doc:
            reporter_id = _clean_user_id((incident_doc or {}).get("reporterId")) or reporter_id
            reporter_name = str((incident_doc or {}).get("reportedBy") or reporter_name).strip()

    if not reporter_id:
        return None

    user_doc = _find_user_doc(reporter_id, {"name": 1, "email": 1, "phone": 1})
    if not reporter_name and user_doc:
        reporter_name = _user_display_name(user_doc, fallback="Local User")
    if not reporter_name:
        reporter_name = "Local User"

    return {
        "id": reporter_id,
        "name": reporter_name,
        "role": ROLE_LOCAL,
        "label": reporter_name,
    }


def _is_reopened_ticket(ticket_doc: dict) -> bool:
    reopened_by = ticket_doc.get("reopenedBy")
    if isinstance(reopened_by, dict):
        return any(str(reopened_by.get(key) or "").strip() for key in ("id", "name", "timestamp"))
    if reopened_by:
        return True
    reopen_warning = ticket_doc.get("reopenWarning")
    if isinstance(reopen_warning, dict):
        return any(str(value or "").strip() for value in reopen_warning.values())
    return False


def _can_official_access_ticket(ticket_doc: dict, role: str, official_user_id: str) -> bool:
    if role == ROLE_DEPARTMENT:
        return True
    if role == ROLE_SUPERVISOR:
        if not official_user_id:
            return False
        if not _is_reopened_ticket(ticket_doc):
            return True
        reopened_supervisor_id = _clean_user_id(ticket_doc.get("reopenedSupervisorId"))
        if not reopened_supervisor_id:
            return False
        return reopened_supervisor_id == official_user_id
    return False


def _can_access_chat(ticket_doc: dict, current_user: dict, role: str, reporter: dict | None) -> bool:
    user_id = _clean_user_id(current_user.get("id"))
    if not user_id:
        return False

    if role == ROLE_LOCAL:
        reporter_id = _clean_user_id((reporter or {}).get("id"))
        return bool(reporter_id and reporter_id == user_id)

    return _can_official_access_ticket(ticket_doc, role, user_id)


def _option_from_user_doc(doc: dict, role_fallback: str) -> dict:
    payload = serialize_doc(doc) or {}
    chat_crypto_key = payload.get("chatCryptoKey")
    return {
        "id": _clean_user_id(payload.get("id")),
        "name": _user_display_name(payload, fallback="Official"),
        "role": _normalize_role(payload.get("officialRole")) or role_fallback,
        "department": str(payload.get("department") or "").strip() or None,
        "chatCryptoKey": chat_crypto_key if isinstance(chat_crypto_key, dict) else None,
    }


def _dedupe_user_options(options: list[dict]) -> list[dict]:
    deduped: list[dict] = []
    seen: set[str] = set()
    for row in options:
        user_id = _clean_user_id(row.get("id"))
        if not user_id or user_id in seen:
            continue
        seen.add(user_id)
        deduped.append(row)
    return deduped


def _resolve_department_options(ticket_doc: dict, current_user: dict, directory_limit: int | None = 16) -> list[dict]:
    options: list[dict] = []
    current_role = _normalize_role(current_user.get("officialRole"))
    current_department = str(current_user.get("department") or "").strip()

    if current_role == ROLE_DEPARTMENT:
        options.append(
            {
                "id": _clean_user_id(current_user.get("id")),
                "name": _user_display_name(current_user, fallback="Department"),
                "role": ROLE_DEPARTMENT,
                "department": current_department or None,
            }
        )

    direct_ids = {
        _clean_user_id(ticket_doc.get("reopenedBy", {}).get("id")) if isinstance(ticket_doc.get("reopenedBy"), dict) else "",
        _clean_user_id(ticket_doc.get("verifiedById")),
        _clean_user_id(ticket_doc.get("resolvedById")),
        _clean_user_id(ticket_doc.get("updatesVerifiedById")),
    }
    for candidate_id in sorted([row for row in direct_ids if row]):
        doc = _find_user_doc(candidate_id, {"name": 1, "officialRole": 1, "department": 1, "email": 1, "phone": 1, "chatCryptoKey": 1})
        if not doc:
            continue
        role = _normalize_role(doc.get("officialRole"))
        if role != ROLE_DEPARTMENT:
            continue
        options.append(_option_from_user_doc(doc, ROLE_DEPARTMENT))

    query: dict[str, Any] = {"officialRole": ROLE_DEPARTMENT}
    if current_department:
        query["department"] = current_department

    if directory_limit is None:
        cursor = users.find(query, {"name": 1, "officialRole": 1, "department": 1, "email": 1, "phone": 1, "chatCryptoKey": 1})
        for row in cursor:
            options.append(_option_from_user_doc(row, ROLE_DEPARTMENT))
    elif directory_limit > 0:
        cursor = users.find(query, {"name": 1, "officialRole": 1, "department": 1, "email": 1, "phone": 1, "chatCryptoKey": 1}).limit(directory_limit)
        for row in cursor:
            options.append(_option_from_user_doc(row, ROLE_DEPARTMENT))

    return _dedupe_user_options(options)


def _resolve_supervisor_options(ticket_doc: dict, current_user: dict, directory_limit: int = 20) -> list[dict]:
    options: list[dict] = []
    current_role = _normalize_role(current_user.get("officialRole"))
    current_department = str(current_user.get("department") or "").strip()

    if current_role == ROLE_SUPERVISOR:
        options.append(
            {
                "id": _clean_user_id(current_user.get("id")),
                "name": _user_display_name(current_user, fallback="Supervisor"),
                "role": ROLE_SUPERVISOR,
                "department": current_department or None,
            }
        )

    direct_ids = {
        _clean_user_id(ticket_doc.get("reopenedSupervisorId")),
        _clean_user_id(ticket_doc.get("assignedBySupervisorId")),
        _clean_user_id(ticket_doc.get("verifiedById")),
        _clean_user_id(ticket_doc.get("resolvedById")),
    }
    for candidate_id in sorted([row for row in direct_ids if row]):
        doc = _find_user_doc(candidate_id, {"name": 1, "officialRole": 1, "department": 1, "email": 1, "phone": 1, "chatCryptoKey": 1})
        if not doc:
            continue
        role = _normalize_role(doc.get("officialRole"))
        if role != ROLE_SUPERVISOR:
            continue
        options.append(_option_from_user_doc(doc, ROLE_SUPERVISOR))

    query: dict[str, Any] = {"officialRole": ROLE_SUPERVISOR}
    if current_department:
        query["department"] = current_department

    if directory_limit > 0:
        cursor = users.find(query, {"name": 1, "officialRole": 1, "department": 1, "email": 1, "phone": 1, "chatCryptoKey": 1}).limit(directory_limit)
        for row in cursor:
            options.append(_option_from_user_doc(row, ROLE_SUPERVISOR))

    return _dedupe_user_options(options)


def _allowed_target_roles(role: str, departments: list[dict], supervisors: list[dict]) -> list[str]:
    if role == ROLE_LOCAL:
        targets: list[str] = []
        if departments:
            targets.append(ROLE_DEPARTMENT)
        if supervisors:
            targets.append(ROLE_SUPERVISOR)
        return targets
    if role == ROLE_DEPARTMENT:
        return [ROLE_DEPARTMENT]
    if role == ROLE_SUPERVISOR:
        return [ROLE_SUPERVISOR]
    return []


def _find_option_by_user_id(options: list[dict], user_id: str | None) -> dict | None:
    candidate_id = _clean_user_id(user_id)
    if not candidate_id:
        return None
    for option in options:
        if _clean_user_id(option.get("id")) == candidate_id:
            return option
    return None


def _ticket_log_selector_values(ticket_doc: dict) -> list[Any]:
    values: list[Any] = []
    seen: set[str] = set()
    for raw in (
        ticket_doc.get("_id"),
        str(ticket_doc.get("_id") or "").strip(),
        str(ticket_doc.get("ticketId") or "").strip(),
    ):
        if raw is None:
            continue
        text = str(raw).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        values.append(raw)
        try:
            obj_id = to_object_id(text)
        except Exception:
            obj_id = None
        if obj_id is not None:
            obj_text = str(obj_id)
            if obj_text not in seen:
                seen.add(obj_text)
                values.append(obj_id)
    return values


def _latest_official_actor_target(ticket_doc: dict, departments: list[dict], supervisors: list[dict]) -> dict | None:
    selector_values = _ticket_log_selector_values(ticket_doc)
    if not selector_values:
        return None

    latest_entry = incident_logs.find_one(
        {
            "ticketId": {"$in": selector_values},
            "actorOfficialRole": {"$in": [ROLE_DEPARTMENT, ROLE_SUPERVISOR]},
        },
        sort=[("createdAt", -1)],
    )
    if not latest_entry:
        return None

    actor_role = _normalize_role(latest_entry.get("actorOfficialRole"))
    actor_user_id = _clean_user_id(latest_entry.get("actorUserId"))
    if actor_role == ROLE_DEPARTMENT:
        return _find_option_by_user_id(departments, actor_user_id)
    if actor_role == ROLE_SUPERVISOR:
        return _find_option_by_user_id(supervisors, actor_user_id)
    return None


def _resolve_preferred_target(ticket_doc: dict, departments: list[dict], supervisors: list[dict]) -> dict | None:
    latest_actor_target = _latest_official_actor_target(ticket_doc, departments, supervisors)
    if latest_actor_target:
        return latest_actor_target

    for candidate_id in (
        ticket_doc.get("reopenedSupervisorId"),
        ticket_doc.get("assignedBySupervisorId"),
    ):
        match = _find_option_by_user_id(supervisors, candidate_id)
        if match:
            return match

    reopened_by = ticket_doc.get("reopenedBy")
    if isinstance(reopened_by, dict):
        match = _find_option_by_user_id(departments, reopened_by.get("id"))
        if match:
            return match

    for candidate_id in (
        ticket_doc.get("resolvedById"),
        ticket_doc.get("verifiedById"),
        ticket_doc.get("updatesVerifiedById"),
    ):
        match = _find_option_by_user_id(supervisors, candidate_id)
        if match:
            return match
        match = _find_option_by_user_id(departments, candidate_id)
        if match:
            return match

    status = str(ticket_doc.get("status") or "").strip().lower()
    if status in {"verified", "in_progress", "resolved"} and supervisors:
        return supervisors[0]
    if departments:
        return departments[0]
    if supervisors:
        return supervisors[0]
    return None


def _resolve_target_official(
    *,
    target_role: str,
    target_user_id: str,
    current_user: dict,
    departments: list[dict],
    supervisors: list[dict],
) -> dict:
    options = departments if target_role == ROLE_DEPARTMENT else supervisors
    if not options:
        raise HTTPException(status_code=400, detail=f"No available {target_role} account for this ticket")

    if target_user_id:
        for option in options:
            if _clean_user_id(option.get("id")) == target_user_id:
                return option
        raise HTTPException(status_code=400, detail="Selected official is not available for this ticket")

    current_user_id = _clean_user_id(current_user.get("id"))
    if current_user_id:
        for option in options:
            if _clean_user_id(option.get("id")) == current_user_id:
                return option

    return options[0]


def _active_session_selector(ticket_object_id: str, official_user_id: str, local_user_id: str) -> dict:
    return {
        "ticketId": ticket_object_id,
        "officialUserId": official_user_id,
        "localUserId": local_user_id,
        "endedAt": {"$exists": False},
    }


def _get_session_doc(ticket_object_id: str, session_id: str) -> dict:
    try:
        session_obj_id = to_object_id(session_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid chat session id")

    doc = ticket_chat_sessions.find_one({"_id": session_obj_id, "ticketId": ticket_object_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Chat session not found")
    return doc


def _require_session_participant(session_doc: dict, current_user: dict):
    current_user_id = _clean_user_id(current_user.get("id"))
    if not current_user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    participants = session_doc.get("participants")
    if not isinstance(participants, list):
        raise HTTPException(status_code=403, detail="Access denied")

    for row in participants:
        if not isinstance(row, dict):
            continue
        if _clean_user_id(row.get("userId")) == current_user_id:
            return

    raise HTTPException(status_code=403, detail="Access denied")


def _refresh_retention(session_id: str, now_iso: str, expires_at: datetime):
    ticket_chat_sessions.update_one(
        {"_id": to_object_id(session_id)},
        {"$set": {"lastActivityAt": now_iso, "updatedAt": now_iso, "expiresAt": expires_at}},
    )
    ticket_chat_messages.update_many({"sessionId": session_id}, {"$set": {"expiresAt": expires_at}})


def _is_visible_chat_message(row: dict) -> bool:
    if not isinstance(row, dict):
        return False
    if bool(row.get("aiGenerated")):
        return False
    message_type = str(row.get("messageType") or "").strip().lower()
    return message_type != "assistant"


def _normalize_upload_extension(content_type: str, original_name: str | None) -> str:
    suffix = Path(str(original_name or "")).suffix.strip().lower()
    if suffix and 1 <= len(suffix) <= 10:
        return suffix
    if content_type.startswith("image/"):
        return ".jpg"
    if content_type.startswith("video/"):
        return ".mp4"
    return ".bin"


async def _persist_upload(
    file: UploadFile,
    attachment_meta: dict | None = None,
    *,
    allow_encrypted_binary: bool = False,
    require_encrypted_upload: bool = False,
) -> dict:
    meta = attachment_meta if isinstance(attachment_meta, dict) else {}
    content_type = (file.content_type or "").strip().lower()
    is_encrypted_attachment = bool(meta.get("encrypted"))
    if require_encrypted_upload and not is_encrypted_attachment:
        raise HTTPException(status_code=400, detail="Attachments must be encrypted")
    if not allow_encrypted_binary and not any(content_type.startswith(prefix) for prefix in ("image/", "video/")):
        raise HTTPException(status_code=400, detail="Only image and video files are allowed")
    if allow_encrypted_binary and not is_encrypted_attachment and not any(
        content_type.startswith(prefix) for prefix in ("image/", "video/")
    ):
        raise HTTPException(status_code=400, detail="Only encrypted binary or image/video files are allowed")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Attachment file is empty")
    if len(raw) > MAX_ATTACHMENT_SIZE_BYTES:
        raise HTTPException(status_code=400, detail="Attachment exceeds 15 MB size limit")

    original_file_name = str(meta.get("originalFileName") or file.filename or "").strip()
    original_mime_type = str(meta.get("originalMimeType") or "").strip().lower() or None
    ext = ".bin" if is_encrypted_attachment else _normalize_upload_extension(content_type, original_file_name)
    file_name = f"chat_{datetime.utcnow().strftime('%Y%m%d_%H%M%S_%f')}_{uuid4().hex[:8]}{ext}"
    upload_dir = Path(settings.IMAGE_DIR) / "chat"
    upload_dir.mkdir(parents=True, exist_ok=True)
    file_path = upload_dir / file_name
    with open(file_path, "wb") as handle:
        handle.write(raw)

    declared_media_type = str(meta.get("mediaType") or "").strip().lower()
    if declared_media_type not in {"image", "video", "file"}:
        declared_media_type = ""
    default_media_type = "video" if content_type.startswith("video/") else "image"
    encryption_algorithm = str(meta.get("encryptionAlgorithm") or "").strip() or None
    iv_value = str(meta.get("iv") or "").strip() or None

    return {
        "url": f"/images/chat/{file_name}",
        "fileName": str(file.filename or file_name),
        "contentType": content_type,
        "sizeBytes": len(raw),
        "mediaType": declared_media_type or default_media_type,
        "encrypted": is_encrypted_attachment,
        "encryptionAlgorithm": encryption_algorithm,
        "iv": iv_value,
        "originalFileName": original_file_name or str(file.filename or file_name),
        "originalMimeType": original_mime_type,
    }


def _resolve_chat_attachment_path(url_value: str) -> Path | None:
    raw_url = str(url_value or "").strip()
    if not raw_url:
        return None

    parsed = urlparse(raw_url)
    raw_path = str(parsed.path or raw_url).replace("\\", "/").strip()
    if not raw_path:
        return None

    if raw_path.startswith("/images/chat/"):
        file_name = raw_path[len("/images/chat/") :].strip()
    elif raw_path.startswith("images/chat/"):
        file_name = raw_path[len("images/chat/") :].strip()
    else:
        return None

    safe_name = Path(file_name).name.strip()
    if not safe_name:
        return None

    chat_dir = (Path(settings.IMAGE_DIR) / "chat").resolve()
    candidate = (chat_dir / safe_name).resolve()
    if candidate.parent != chat_dir:
        return None
    return candidate


def _purge_chat_session_artifacts(session_doc: dict | None) -> dict:
    if not isinstance(session_doc, dict):
        return {"messagesDeleted": 0, "filesDeleted": 0, "sessionDeleted": False}

    session_id = str(session_doc.get("_id") or "").strip()
    if not session_id:
        return {"messagesDeleted": 0, "filesDeleted": 0, "sessionDeleted": False}

    message_rows = list(ticket_chat_messages.find({"sessionId": session_id}))
    deleted_files = 0
    for row in message_rows:
        attachments = row.get("attachments")
        if not isinstance(attachments, list):
            continue
        for attachment in attachments:
            if not isinstance(attachment, dict):
                continue
            file_path = _resolve_chat_attachment_path(str(attachment.get("url") or ""))
            if not file_path:
                continue
            try:
                if file_path.exists():
                    file_path.unlink()
                    deleted_files += 1
            except Exception:
                continue

    delete_messages_result = ticket_chat_messages.delete_many({"sessionId": session_id})
    delete_session_result = ticket_chat_sessions.delete_one({"_id": session_doc.get("_id")})
    return {
        "messagesDeleted": int(delete_messages_result.deleted_count or 0),
        "filesDeleted": deleted_files,
        "sessionDeleted": bool(delete_session_result.deleted_count),
    }


def _safe_pdf_text(value: str) -> str:
    text = str(value or "").replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    text = text.replace("\r", " ").replace("\n", " ").strip()
    if not text:
        return " "
    return text.encode("latin-1", "replace").decode("latin-1")


def _build_pdf(pages: list[list[str]]) -> bytes:
    objects: list[bytes] = []

    def _append_obj(data: bytes) -> int:
        objects.append(data)
        return len(objects)

    font_id = _append_obj(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    pages_id = _append_obj(b"<<>>")
    page_ids: list[int] = []

    for page_lines in pages:
        commands = ["BT", "/F1 11 Tf", "50 800 Td"]
        for idx, line in enumerate(page_lines):
            if idx > 0:
                commands.append("0 -14 Td")
            commands.append(f"({_safe_pdf_text(line)}) Tj")
        commands.append("ET")
        stream_data = "\n".join(commands).encode("latin-1", "replace")
        content_id = _append_obj(
            f"<< /Length {len(stream_data)} >>\nstream\n".encode("ascii") + stream_data + b"\nendstream"
        )
        page_obj = (
            f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {PDF_PAGE_WIDTH} {PDF_PAGE_HEIGHT}] "
            f"/Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {content_id} 0 R >>"
        ).encode("ascii")
        page_ids.append(_append_obj(page_obj))

    kids = " ".join(f"{page_id} 0 R" for page_id in page_ids)
    objects[pages_id - 1] = f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>".encode("ascii")
    catalog_id = _append_obj(f"<< /Type /Catalog /Pages {pages_id} 0 R >>".encode("ascii"))

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for idx, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out.extend(f"{idx} 0 obj\n".encode("ascii"))
        out.extend(obj)
        out.extend(b"\nendobj\n")

    start_xref = len(out)
    out.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    out.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        out.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    out.extend(
        (
            f"trailer\n<< /Size {len(objects) + 1} /Root {catalog_id} 0 R >>\n"
            f"startxref\n{start_xref}\n%%EOF"
        ).encode("ascii")
    )
    return bytes(out)


def _transcript_pdf_bytes(ticket_doc: dict, session_doc: dict, message_rows: list[dict]) -> bytes:
    ticket_public_id = str(ticket_doc.get("ticketId") or ticket_doc.get("_id") or "").strip()
    header_lines = [
        f"Ticket Chat Transcript - {ticket_public_id or 'Ticket'}",
        f"Generated: {datetime.utcnow().isoformat()} UTC",
        f"Target Role: {str(session_doc.get('targetRole') or '').replace('_', ' ').title() or 'N/A'}",
        f"Local User: {session_doc.get('localUserName') or session_doc.get('localUserId') or 'N/A'}",
        f"Official: {session_doc.get('officialUserName') or session_doc.get('officialUserId') or 'N/A'}",
        " ",
    ]

    body_lines: list[str] = []
    for row in message_rows:
        created_at = str(row.get("createdAt") or "").strip() or "N/A"
        sender_name = str(row.get("senderName") or "User").strip()
        sender_role = str(row.get("senderRole") or "").replace("_", " ").strip()
        role_suffix = f" ({sender_role})" if sender_role else ""
        message_text = str(row.get("message") or "").strip()
        if bool(row.get("encrypted")) and str(row.get("messageCiphertext") or "").strip():
            message_text = "[Encrypted message]"
        if not message_text:
            message_text = "[media attachment]"
        prefix = f"[{created_at}] {sender_name}{role_suffix}: "
        body_lines.extend(textwrap.wrap(prefix + message_text, width=95) or [prefix + message_text])

        attachments = row.get("attachments")
        if isinstance(attachments, list):
            for att in attachments:
                if not isinstance(att, dict):
                    continue
                media_type = str(att.get("mediaType") or "file").strip()
                url = str(att.get("url") or "").strip()
                if not url:
                    continue
                line = f"  Attachment ({media_type}): {url}"
                body_lines.extend(textwrap.wrap(line, width=95) or [line])
        body_lines.append(" ")

    lines = header_lines + (body_lines or ["No messages found."])
    page_size = 50
    pages: list[list[str]] = []
    for idx in range(0, len(lines), page_size):
        pages.append(lines[idx : idx + page_size])
    if not pages:
        pages = [["No messages found."]]
    return _build_pdf(pages)


def _existing_sessions_for_user(ticket_object_id: str, role: str, current_user_id: str, reporter_id: str | None) -> list[dict]:
    query: dict[str, Any] = {
        "ticketId": ticket_object_id,
        "initiatedBy": ROLE_LOCAL,
        "endedAt": {"$exists": False},
    }

    if role == ROLE_LOCAL:
        query["localUserId"] = reporter_id
    else:
        query["officialUserId"] = current_user_id

    return list(ticket_chat_sessions.find(query).sort("createdAt", -1))


def _session_participant_ids(session_doc: dict | None) -> set[str]:
    participant_ids: set[str] = set()
    if not isinstance(session_doc, dict):
        return participant_ids

    for key in ("officialUserId", "localUserId"):
        value = _clean_user_id(session_doc.get(key))
        if value:
            participant_ids.add(value)

    participants = session_doc.get("participants")
    if isinstance(participants, list):
        for row in participants:
            if not isinstance(row, dict):
                continue
            value = _clean_user_id(row.get("userId"))
            if value:
                participant_ids.add(value)

    return participant_ids


def _peer_participant_id(session_doc: dict | None, current_user_id: str) -> str:
    if not isinstance(session_doc, dict):
        return ""
    participant_ids = _session_participant_ids(session_doc)
    for participant_id in participant_ids:
        if participant_id and participant_id != current_user_id:
            return participant_id
    return ""


def _session_peer_key_bundle(session_doc: dict | None, current_user_id: str) -> dict | None:
    if not isinstance(session_doc, dict):
        return None
    participant_keys = session_doc.get("participantKeys")
    if not isinstance(participant_keys, dict):
        return None
    peer_id = _peer_participant_id(session_doc, current_user_id)
    if not peer_id:
        return None
    bundle = participant_keys.get(peer_id)
    return bundle if isinstance(bundle, dict) else None


async def _broadcast_ticket_chat_sync(
    *,
    ticket_id: str,
    session_id: str,
    at: str,
    participant_ids: set[str],
    started: bool = False,
    ended: bool = False,
    ended_at: str | None = None,
    purged: bool = False,
    purge_reason: str | None = None,
):
    if not participant_ids:
        return

    await manager.broadcast(
        {
            "type": "TICKET_CHAT_SYNC",
            "data": {
                "ticketId": ticket_id,
                "sessionId": session_id,
                "at": at,
                "started": started,
                "ended": ended,
                "endedAt": ended_at,
                "purged": purged,
                "purgeReason": purge_reason,
            },
        },
        predicate=lambda user: _clean_user_id((user or {}).get("id")) in participant_ids,
    )


async def purge_active_ticket_chats_for_user(user_id: str, *, reason: str = "disconnected"):
    clean_user_id = _clean_user_id(user_id)
    if not clean_user_id:
        return

    sessions = list(
        ticket_chat_sessions.find(
            {
                "endedAt": {"$exists": False},
                "$or": [
                    {"officialUserId": clean_user_id},
                    {"localUserId": clean_user_id},
                    {"participants": {"$elemMatch": {"userId": clean_user_id}}},
                ],
            }
        )
    )
    if not sessions:
        return

    now_iso = _now_dt().isoformat()
    for session_doc in sessions:
        session_id = str(session_doc.get("_id") or "").strip()
        ticket_id = str(session_doc.get("ticketId") or "").strip()
        if not session_id or not ticket_id:
            continue

        await _broadcast_ticket_chat_sync(
            ticket_id=ticket_id,
            session_id=session_id,
            at=now_iso,
            participant_ids=_session_participant_ids(session_doc),
            ended=True,
            ended_at=now_iso,
            purged=True,
            purge_reason=reason,
        )
        _purge_chat_session_artifacts(session_doc)


@router.post("/chat/identity-key")
def upsert_ticket_chat_identity_key(
    payload: TicketChatIdentityKeyUpsert,
    current_user: dict = Depends(get_current_user),
):
    current_user_id = _clean_user_id(current_user.get("id"))
    if not current_user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    public_key_jwk = payload.publicKeyJwk if isinstance(payload.publicKeyJwk, dict) else {}
    if not public_key_jwk:
        raise HTTPException(status_code=400, detail="publicKeyJwk is required")

    now_iso = _now_dt().isoformat()
    key_bundle = {
        "publicKeyJwk": public_key_jwk,
        "algorithm": str(payload.algorithm or "ECDH-P256").strip() or "ECDH-P256",
        "fingerprint": str(payload.fingerprint or "").strip() or None,
        "updatedAt": now_iso,
    }

    update_result = users.update_one({"_id": current_user_id}, {"$set": {"chatCryptoKey": key_bundle, "updatedAt": now_iso}})
    if update_result.matched_count == 0:
        try:
            update_result = users.update_one(
                {"_id": to_object_id(current_user_id)},
                {"$set": {"chatCryptoKey": key_bundle, "updatedAt": now_iso}},
            )
        except Exception:
            update_result = update_result

    if update_result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "success": True,
        "data": key_bundle,
    }


@router.get("/chat/inbox-summary")
def get_ticket_chat_inbox_summary(current_user: dict = Depends(get_current_user)):
    role = _resolve_chat_role(current_user)
    current_user_id = _clean_user_id(current_user.get("id"))
    if not current_user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    query: dict[str, Any] = {
        "initiatedBy": ROLE_LOCAL,
        "endedAt": {"$exists": False},
    }
    if role == ROLE_LOCAL:
        query["localUserId"] = current_user_id
    else:
        query["officialUserId"] = current_user_id

    received_chats_count = ticket_chat_sessions.count_documents(query)

    return {
        "success": True,
        "data": {
            "receivedChatsCount": received_chats_count,
        },
    }


@router.get("/{ticket_ref}/chat/options")
def get_ticket_chat_options(ticket_ref: str, current_user: dict = Depends(get_current_user)):
    role = _resolve_chat_role(current_user)
    current_user_id = _clean_user_id(current_user.get("id"))

    ticket_doc = _get_ticket_doc(ticket_ref)
    ticket_object_id = str(ticket_doc.get("_id") or "")
    reporter = _resolve_ticket_reporter(ticket_doc)

    if not _can_access_chat(ticket_doc, current_user, role, reporter):
        raise HTTPException(status_code=403, detail="Access denied")

    department_directory_limit = None if role == ROLE_LOCAL else 16
    supervisor_directory_limit = 0 if role == ROLE_LOCAL else 20
    departments = _resolve_department_options(ticket_doc, current_user, directory_limit=department_directory_limit)
    supervisors = _resolve_supervisor_options(ticket_doc, current_user, directory_limit=supervisor_directory_limit)
    allowed_targets = _allowed_target_roles(role, departments, supervisors)
    preferred_target = _resolve_preferred_target(ticket_doc, departments, supervisors)

    reporter_id = _clean_user_id((reporter or {}).get("id"))
    existing_sessions = _existing_sessions_for_user(ticket_object_id, role, current_user_id, reporter_id)
    chat_visible = role == ROLE_LOCAL or len(existing_sessions) > 0

    return {
        "success": True,
        "data": {
            "ticketId": ticket_object_id,
            "ticketPublicId": str(ticket_doc.get("ticketId") or "").strip() or None,
            "targetRoles": [{"value": value, "label": value.replace("_", " ").title()} for value in allowed_targets],
            "departments": departments,
            "supervisors": supervisors,
            "localParticipant": reporter,
            "existingSessions": serialize_list(existing_sessions),
            "defaultTargetRole": _normalize_role((preferred_target or {}).get("role")) or (allowed_targets[0] if allowed_targets else None),
            "preferredTargetRole": _normalize_role((preferred_target or {}).get("role")) or None,
            "preferredTargetUser": preferred_target,
            "currentUserRole": role,
            "currentUserId": current_user_id,
            "retentionHours": CHAT_RETENTION_HOURS,
            "initiateEnabled": role == ROLE_LOCAL,
            "chatVisible": chat_visible,
        },
    }

@router.post("/{ticket_ref}/chat/sessions")
async def open_ticket_chat_session(
    ticket_ref: str,
    payload: TicketChatSessionCreate,
    current_user: dict = Depends(get_current_user),
):
    role = _resolve_chat_role(current_user)
    current_user_id = _clean_user_id(current_user.get("id"))

    ticket_doc = _get_ticket_doc(ticket_ref)
    ticket_object_id = str(ticket_doc.get("_id") or "")
    reporter = _resolve_ticket_reporter(ticket_doc)

    if not _can_access_chat(ticket_doc, current_user, role, reporter):
        raise HTTPException(status_code=403, detail="Access denied")

    local_user_id = _clean_user_id((reporter or {}).get("id"))
    if not local_user_id:
        raise HTTPException(status_code=400, detail="Local reporter details are unavailable for this ticket")

    department_directory_limit = None if role == ROLE_LOCAL else 16
    supervisor_directory_limit = 0 if role == ROLE_LOCAL else 20
    departments = _resolve_department_options(ticket_doc, current_user, directory_limit=department_directory_limit)
    supervisors = _resolve_supervisor_options(ticket_doc, current_user, directory_limit=supervisor_directory_limit)
    preferred_target = _resolve_preferred_target(ticket_doc, departments, supervisors)

    if role != ROLE_LOCAL:
        target_role = _normalize_role(payload.targetRole)
        if target_role not in TARGET_ROLES:
            raise HTTPException(status_code=400, detail="targetRole must be department or supervisor")
        if target_role != role:
            raise HTTPException(status_code=403, detail="Officials can open only chats assigned to their own role")
        existing = ticket_chat_sessions.find_one(
            {
                **_active_session_selector(ticket_object_id, current_user_id, local_user_id),
                "targetRole": target_role,
            }
        )
        if not existing:
            raise HTTPException(status_code=404, detail="No local-initiated chat available for this ticket")
        existing_keys = existing.get("participantKeys")
        current_crypto_key = current_user.get("chatCryptoKey") if isinstance(current_user, dict) else None
        if isinstance(current_crypto_key, dict) and (
            not isinstance(existing_keys, dict) or not isinstance(existing_keys.get(current_user_id), dict)
        ):
            now_iso = _now_dt().isoformat()
            ticket_chat_sessions.update_one(
                {"_id": existing.get("_id")},
                {
                    "$set": {
                        f"participantKeys.{current_user_id}": current_crypto_key,
                        "updatedAt": now_iso,
                    }
                },
            )
            existing = _get_session_doc(ticket_object_id, str(existing.get("_id")))
        return {"success": True, "data": serialize_doc(existing)}

    requested_target_role = _normalize_role(payload.targetRole)
    requested_target_user_id = _clean_user_id(payload.targetUserId)
    if requested_target_role in TARGET_ROLES:
        target_official = _resolve_target_official(
            target_role=requested_target_role,
            target_user_id=requested_target_user_id,
            current_user=current_user,
            departments=departments,
            supervisors=supervisors,
        )
    else:
        target_official = preferred_target
    target_role = _normalize_role((target_official or {}).get("role"))
    if not target_official or target_role not in TARGET_ROLES:
        raise HTTPException(status_code=400, detail="No responsible department or supervisor is available for this ticket")

    selector = _active_session_selector(ticket_object_id, target_official["id"], local_user_id)
    existing = ticket_chat_sessions.find_one(selector)
    if existing:
        return {"success": True, "data": serialize_doc(existing)}

    now = _now_dt()
    now_iso = now.isoformat()
    expires_at = _retention_expires_at(now)

    session_doc = {
        "ticketId": ticket_object_id,
        "incidentId": _clean_user_id(ticket_doc.get("incidentId")) or None,
        "targetRole": target_role,
        "officialUserId": target_official["id"],
        "officialUserName": target_official["name"],
        "officialDepartment": target_official.get("department"),
        "localUserId": local_user_id,
        "localUserName": str((reporter or {}).get("name") or "Local User").strip(),
        "participants": [
            {
                "userId": target_official["id"],
                "name": target_official["name"],
                "role": target_official["role"],
            },
            {
                "userId": local_user_id,
                "name": str((reporter or {}).get("name") or "Local User").strip(),
                "role": ROLE_LOCAL,
            },
        ],
        "initiatedBy": ROLE_LOCAL,
        "startedByUserId": current_user_id,
        "startedByName": _user_display_name(current_user, fallback="Local User"),
        "createdAt": now_iso,
        "updatedAt": now_iso,
        "lastActivityAt": now_iso,
        "expiresAt": expires_at,
        "participantKeys": {},
    }
    target_official_crypto_key = target_official.get("chatCryptoKey")
    if isinstance(target_official_crypto_key, dict):
        session_doc["participantKeys"][target_official["id"]] = target_official_crypto_key
    local_crypto_key = current_user.get("chatCryptoKey") if isinstance(current_user, dict) else None
    if isinstance(local_crypto_key, dict):
        session_doc["participantKeys"][local_user_id] = local_crypto_key
    inserted = ticket_chat_sessions.insert_one(session_doc)
    saved = ticket_chat_sessions.find_one({"_id": inserted.inserted_id})
    await _broadcast_ticket_chat_sync(
        ticket_id=ticket_object_id,
        session_id=str(inserted.inserted_id),
        at=now_iso,
        participant_ids=_session_participant_ids(saved or session_doc),
        started=True,
    )
    return {"success": True, "data": serialize_doc(saved)}


@router.post("/{ticket_ref}/chat/sessions/{session_id}/crypto-key")
async def upsert_ticket_chat_session_crypto_key(
    ticket_ref: str,
    session_id: str,
    payload: TicketChatSessionCryptoKeyUpsert,
    current_user: dict = Depends(get_current_user),
):
    role = _resolve_chat_role(current_user)
    ticket_doc = _get_ticket_doc(ticket_ref)
    ticket_object_id = str(ticket_doc.get("_id") or "")
    reporter = _resolve_ticket_reporter(ticket_doc)
    if not _can_access_chat(ticket_doc, current_user, role, reporter):
        raise HTTPException(status_code=403, detail="Access denied")

    session_doc = _get_session_doc(ticket_object_id, session_id)
    _require_session_participant(session_doc, current_user)
    current_user_id = _clean_user_id(current_user.get("id"))
    if not current_user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    public_key_jwk = payload.publicKeyJwk if isinstance(payload.publicKeyJwk, dict) else {}
    if not public_key_jwk:
        raise HTTPException(status_code=400, detail="publicKeyJwk is required")

    now_iso = _now_dt().isoformat()
    key_bundle = {
        "publicKeyJwk": public_key_jwk,
        "algorithm": str(payload.algorithm or "ECDH-P256").strip() or "ECDH-P256",
        "fingerprint": str(payload.fingerprint or "").strip() or None,
        "updatedAt": now_iso,
    }
    ticket_chat_sessions.update_one(
        {"_id": session_doc.get("_id")},
        {
            "$set": {
                f"participantKeys.{current_user_id}": key_bundle,
                "updatedAt": now_iso,
            }
        },
    )

    refreshed = _get_session_doc(ticket_object_id, session_id)
    await _broadcast_ticket_chat_sync(
        ticket_id=ticket_object_id,
        session_id=session_id,
        at=now_iso,
        participant_ids=_session_participant_ids(refreshed),
    )
    peer_key_bundle = _session_peer_key_bundle(refreshed, current_user_id)
    return {
        "success": True,
        "data": {
            "session": serialize_doc(refreshed),
            "peerKey": peer_key_bundle,
        },
    }


@router.get("/{ticket_ref}/chat/sessions/{session_id}/messages")
def list_ticket_chat_messages(
    ticket_ref: str,
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    role = _resolve_chat_role(current_user)

    ticket_doc = _get_ticket_doc(ticket_ref)
    ticket_object_id = str(ticket_doc.get("_id") or "")
    reporter = _resolve_ticket_reporter(ticket_doc)
    if not _can_access_chat(ticket_doc, current_user, role, reporter):
        raise HTTPException(status_code=403, detail="Access denied")

    session_doc = _get_session_doc(ticket_object_id, session_id)
    _require_session_participant(session_doc, current_user)

    rows = [
        row
        for row in ticket_chat_messages.find({"sessionId": session_id}).sort("createdAt", 1)
        if _is_visible_chat_message(row)
    ]
    return {"success": True, "data": {"session": serialize_doc(session_doc), "messages": serialize_list(rows)}}


@router.post("/{ticket_ref}/chat/sessions/{session_id}/messages")
async def create_ticket_chat_message(
    ticket_ref: str,
    session_id: str,
    message: str = Form(default=""),
    messageCiphertext: str = Form(default=""),
    messageIv: str = Form(default=""),
    messageEncryptionAlgorithm: str = Form(default=""),
    messageEncrypted: str = Form(default=""),
    attachmentMeta: str = Form(default=""),
    files: list[UploadFile] = File(default=[]),
    current_user: dict = Depends(get_current_user),
):
    role = _resolve_chat_role(current_user)

    ticket_doc = _get_ticket_doc(ticket_ref)
    ticket_object_id = str(ticket_doc.get("_id") or "")
    reporter = _resolve_ticket_reporter(ticket_doc)
    if not _can_access_chat(ticket_doc, current_user, role, reporter):
        raise HTTPException(status_code=403, detail="Access denied")

    session_doc = _get_session_doc(ticket_object_id, session_id)
    _require_session_participant(session_doc, current_user)
    if session_doc.get("endedAt"):
        raise HTTPException(status_code=400, detail="This chat has ended. Start a new chat session to continue.")

    text = (message or "").strip()
    message_ciphertext = str(messageCiphertext or "").strip()
    message_iv = str(messageIv or "").strip()
    message_encryption_algorithm = str(messageEncryptionAlgorithm or "").strip() or "AES-GCM"
    message_encrypted_flag = str(messageEncrypted or "").strip().lower() in {"1", "true", "yes", "on"}
    is_encrypted_message = message_encrypted_flag or bool(message_ciphertext)
    has_attachments = len(files) > 0

    if len(text) > MAX_MESSAGE_LENGTH:
        raise HTTPException(status_code=400, detail=f"Message cannot exceed {MAX_MESSAGE_LENGTH} characters")
    if is_encrypted_message and (not message_ciphertext or not message_iv):
        raise HTTPException(status_code=400, detail="Encrypted messages require ciphertext and iv")
    if is_encrypted_message and message_encryption_algorithm not in SUPPORTED_CHAT_ENCRYPTION_ALGORITHMS:
        raise HTTPException(status_code=400, detail="Unsupported message encryption algorithm")
    if is_encrypted_message and text:
        raise HTTPException(status_code=400, detail="Do not include plaintext when encrypted payload is provided")
    if text and not is_encrypted_message:
        raise HTTPException(status_code=400, detail="Plaintext messages are disabled. Use encrypted payload.")
    if len(files) > MAX_ATTACHMENT_COUNT:
        raise HTTPException(status_code=400, detail=f"You can upload up to {MAX_ATTACHMENT_COUNT} files per message")

    attachment_meta_rows: list[dict] = []
    if attachmentMeta.strip():
        try:
            parsed_attachment_meta = json.loads(attachmentMeta)
            if isinstance(parsed_attachment_meta, list):
                attachment_meta_rows = [row if isinstance(row, dict) else {} for row in parsed_attachment_meta]
            else:
                raise ValueError("attachmentMeta must be a JSON array")
        except Exception:
            raise HTTPException(status_code=400, detail="attachmentMeta must be valid JSON array")
    if attachment_meta_rows and len(attachment_meta_rows) != len(files):
        raise HTTPException(status_code=400, detail="attachmentMeta length must match files length")
    if has_attachments and not attachment_meta_rows:
        raise HTTPException(status_code=400, detail="Encrypted attachments require attachmentMeta")
    if not is_encrypted_message and not has_attachments:
        raise HTTPException(status_code=400, detail="Encrypted message text or at least one encrypted attachment is required")
    for meta_row in attachment_meta_rows:
        if not bool(meta_row.get("encrypted")):
            raise HTTPException(status_code=400, detail="All attachments must be encrypted")
        if not str(meta_row.get("iv") or "").strip():
            raise HTTPException(status_code=400, detail="Encrypted attachments require iv")
        meta_algorithm = str(meta_row.get("encryptionAlgorithm") or "").strip() or "AES-GCM"
        if meta_algorithm not in SUPPORTED_CHAT_ENCRYPTION_ALGORITHMS:
            raise HTTPException(status_code=400, detail="Unsupported attachment encryption algorithm")

    attachments: list[dict] = []
    allow_encrypted_binary = bool(attachment_meta_rows)
    for index, upload in enumerate(files):
        meta = attachment_meta_rows[index] if index < len(attachment_meta_rows) else None
        attachments.append(
            await _persist_upload(
                upload,
                meta,
                allow_encrypted_binary=allow_encrypted_binary,
                require_encrypted_upload=True,
            )
        )

    if not attachments and not is_encrypted_message:
        raise HTTPException(status_code=400, detail="Encrypted message text or at least one encrypted attachment is required")

    now = _now_dt()
    now_iso = now.isoformat()
    expires_at = _retention_expires_at(now)
    sender_name = _user_display_name(current_user, fallback="User")
    sender_id = _clean_user_id(current_user.get("id"))

    created_docs: list[dict] = []
    user_message_doc = {
        "ticketId": ticket_object_id,
        "sessionId": session_id,
        "messageType": "user",
        "message": "" if is_encrypted_message else text,
        "encrypted": is_encrypted_message,
        "messageCiphertext": message_ciphertext if is_encrypted_message else "",
        "messageIv": message_iv if is_encrypted_message else "",
        "messageEncryptionAlgorithm": message_encryption_algorithm if is_encrypted_message else None,
        "attachments": attachments,
        "senderId": sender_id,
        "senderName": sender_name,
        "senderRole": role,
        "createdAt": now_iso,
        "updatedAt": now_iso,
        "expiresAt": expires_at,
    }
    inserted = ticket_chat_messages.insert_one(user_message_doc)
    created_docs.append(ticket_chat_messages.find_one({"_id": inserted.inserted_id}) or user_message_doc)

    _refresh_retention(session_id, now_iso, expires_at)

    await _broadcast_ticket_chat_sync(
        ticket_id=ticket_object_id,
        session_id=session_id,
        at=now_iso,
        participant_ids=_session_participant_ids(session_doc),
    )

    return {"success": True, "data": serialize_list(created_docs)}

@router.post("/{ticket_ref}/chat/sessions/{session_id}/end")
async def end_ticket_chat_session(
    ticket_ref: str,
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    role = _resolve_chat_role(current_user)

    ticket_doc = _get_ticket_doc(ticket_ref)
    ticket_object_id = str(ticket_doc.get("_id") or "")
    reporter = _resolve_ticket_reporter(ticket_doc)
    if not _can_access_chat(ticket_doc, current_user, role, reporter):
        raise HTTPException(status_code=403, detail="Access denied")

    session_doc = _get_session_doc(ticket_object_id, session_id)
    _require_session_participant(session_doc, current_user)

    if not session_doc.get("endedAt"):
        now = _now_dt()
        now_iso = now.isoformat()
        expires_at = _retention_expires_at(now)

        ticket_chat_sessions.update_one(
            {"_id": session_doc.get("_id")},
            {
                "$set": {
                    "endedAt": now_iso,
                    "endedByUserId": _clean_user_id(current_user.get("id")),
                    "endedByName": _user_display_name(current_user, fallback="User"),
                    "updatedAt": now_iso,
                    "lastActivityAt": now_iso,
                    "expiresAt": expires_at,
                }
            },
        )
        ticket_chat_messages.update_many({"sessionId": session_id}, {"$set": {"expiresAt": expires_at}})

        await _broadcast_ticket_chat_sync(
            ticket_id=ticket_object_id,
            session_id=session_id,
            at=now_iso,
            participant_ids=_session_participant_ids(session_doc),
            ended=True,
            ended_at=now_iso,
        )

    refreshed = _get_session_doc(ticket_object_id, session_id)
    return {"success": True, "data": serialize_doc(refreshed)}


@router.post("/{ticket_ref}/chat/sessions/{session_id}/disconnect")
async def disconnect_ticket_chat_session(
    ticket_ref: str,
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    role = _resolve_chat_role(current_user)

    ticket_doc = _get_ticket_doc(ticket_ref)
    ticket_object_id = str(ticket_doc.get("_id") or "")
    reporter = _resolve_ticket_reporter(ticket_doc)
    if not _can_access_chat(ticket_doc, current_user, role, reporter):
        raise HTTPException(status_code=403, detail="Access denied")

    session_doc = _get_session_doc(ticket_object_id, session_id)
    _require_session_participant(session_doc, current_user)

    now_iso = _now_dt().isoformat()
    participant_ids = _session_participant_ids(session_doc)
    await _broadcast_ticket_chat_sync(
        ticket_id=ticket_object_id,
        session_id=session_id,
        at=now_iso,
        participant_ids=participant_ids,
        ended=True,
        ended_at=now_iso,
        purged=True,
        purge_reason="disconnected",
    )
    purge_stats = _purge_chat_session_artifacts(session_doc)
    return {
        "success": True,
        "data": {
            "sessionId": session_id,
            "purged": True,
            **purge_stats,
        },
    }


@router.get("/{ticket_ref}/chat/sessions/{session_id}/transcript.pdf")
async def download_ticket_chat_transcript_pdf(
    ticket_ref: str,
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    role = _resolve_chat_role(current_user)

    ticket_doc = _get_ticket_doc(ticket_ref)
    ticket_object_id = str(ticket_doc.get("_id") or "")
    reporter = _resolve_ticket_reporter(ticket_doc)
    if not _can_access_chat(ticket_doc, current_user, role, reporter):
        raise HTTPException(status_code=403, detail="Access denied")

    session_doc = _get_session_doc(ticket_object_id, session_id)
    _require_session_participant(session_doc, current_user)

    message_rows = [
        row
        for row in ticket_chat_messages.find({"sessionId": session_id}).sort("createdAt", 1)
        if _is_visible_chat_message(row)
    ]
    pdf_bytes = _transcript_pdf_bytes(ticket_doc, session_doc, message_rows)

    now_iso = _now_dt().isoformat()
    participant_ids = _session_participant_ids(session_doc)
    await _broadcast_ticket_chat_sync(
        ticket_id=ticket_object_id,
        session_id=session_id,
        at=now_iso,
        participant_ids=participant_ids,
        ended=True,
        ended_at=now_iso,
        purged=True,
        purge_reason="downloaded",
    )
    _purge_chat_session_artifacts(session_doc)

    ticket_public_id = str(ticket_doc.get("ticketId") or ticket_doc.get("_id") or "ticket").strip()
    safe_ticket_id = "".join(ch for ch in ticket_public_id if ch.isalnum() or ch in {"_", "-"}).strip() or "ticket"
    file_name = f"ticket-chat-{safe_ticket_id}.pdf"
    headers = {"Content-Disposition": f'attachment; filename="{file_name}"'}

    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)
