import atexit
import logging
import re
import time
from datetime import datetime, timezone
from pymongo import MongoClient
from bson import ObjectId
from app.config.settings import settings

LOGGER = logging.getLogger(__name__)

client = MongoClient(
    settings.MONGO_URL,
    serverSelectionTimeoutMS=5000,
    connectTimeoutMS=5000,
    socketTimeoutMS=10000,
)
db = client[settings.DB_NAME]

users = db["users"]
incidents = db["incidents"]
tickets = db["tickets"]
messages = db["messages"]
password_resets = db["password_resets"]
otp_challenges = db["otp_challenges"]
incident_logs = db["incident_logs"]
counters = db["counters"]
issues_collection = incidents
PUBLIC_TICKET_ID_PATTERN = re.compile(r"^(\d{4})(\d+)$")
PUBLIC_INCIDENT_ID_PATTERN = re.compile(r"^(\d{4})(\d{4})$")

atexit.register(client.close)

def ensure_db_connection(max_retries: int = 3, retry_delay_seconds: float = 1.5):
    last_error: Exception | None = None
    retries = max(int(max_retries), 1)
    delay = max(float(retry_delay_seconds), 0.1)

    for attempt in range(1, retries + 1):
        try:
            client.admin.command("ping")
            if attempt > 1:
                LOGGER.info("MongoDB connection recovered on attempt %s.", attempt)
            return
        except Exception as exc:
            last_error = exc
            LOGGER.warning("MongoDB ping failed (attempt %s/%s): %s", attempt, retries, exc)
            if attempt < retries:
                time.sleep(delay)

    raise RuntimeError(f"Unable to connect to MongoDB at {settings.MONGO_URL}: {last_error}")

def cleanup_orphan_tickets():
    incident_id_set: set[str] = set()
    for row in incidents.find({}, {"_id": 1}):
        raw_id = row.get("_id")
        if raw_id is None:
            continue
        incident_id_set.add(str(raw_id))

    orphan_ticket_ids = []
    for row in tickets.find({}, {"_id": 1, "incidentId": 1}):
        ticket_id = row.get("_id")
        incident_id = str(row.get("incidentId") or "").strip()
        if not ticket_id:
            continue
        if not incident_id or incident_id not in incident_id_set:
            orphan_ticket_ids.append(ticket_id)

    if orphan_ticket_ids:
        tickets.delete_many({"_id": {"$in": orphan_ticket_ids}})

def _parse_created_at(value) -> datetime | None:
    if isinstance(value, datetime):
        if value.tzinfo:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    text = str(value or "").strip()
    if not text:
        return None

    normalized = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo:
        return parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed

def _ticket_month_key(created_at) -> str:
    parsed = _parse_created_at(created_at) or datetime.utcnow()
    return parsed.strftime("%y%m")

def _public_ticket_id(month_key: str, serial: int) -> str:
    return f"{month_key}{serial:04d}"

def _public_incident_id(month_key: str, serial: int) -> str:
    return f"{month_key}{serial:04d}"

def _parse_public_ticket_id(value: str | None) -> tuple[str, int] | None:
    raw = str(value or "").strip()
    match = PUBLIC_TICKET_ID_PATTERN.match(raw)
    if not match:
        return None
    try:
        serial = int(match.group(2))
    except ValueError:
        return None
    if serial <= 0:
        return None
    return match.group(1), serial

def _parse_public_incident_id(value: str | None) -> tuple[str, int] | None:
    raw = str(value or "").strip()
    match = PUBLIC_INCIDENT_ID_PATTERN.match(raw)
    if not match:
        return None
    try:
        serial = int(match.group(2))
    except ValueError:
        return None
    if serial <= 0:
        return None
    return match.group(1), serial

def backfill_public_incident_ids():
    rows = list(incidents.find({}, {"_id": 1, "incidentId": 1, "createdAt": 1}).sort([("createdAt", 1), ("_id", 1)]))
    if not rows:
        return

    max_serial_by_month: dict[str, int] = {}
    used_ids: set[str] = set()

    for row in rows:
        parsed = _parse_public_incident_id(row.get("incidentId"))
        if not parsed:
            continue
        month_key, serial = parsed
        max_serial_by_month[month_key] = max(max_serial_by_month.get(month_key, 0), serial)
        used_ids.add(str(row.get("incidentId")))

    for row in rows:
        raw_incident_id = str(row.get("incidentId") or "").strip()
        parsed = _parse_public_incident_id(raw_incident_id)
        if parsed:
            public_incident_id = raw_incident_id
        else:
            month_key = _ticket_month_key(row.get("createdAt"))
            next_serial = max_serial_by_month.get(month_key, 0) + 1
            candidate = _public_incident_id(month_key, next_serial)
            while candidate in used_ids:
                next_serial += 1
                candidate = _public_incident_id(month_key, next_serial)
            public_incident_id = candidate
            used_ids.add(public_incident_id)
            max_serial_by_month[month_key] = next_serial
            incidents.update_one({"_id": row.get("_id")}, {"$set": {"incidentId": public_incident_id}})

    for month_key, serial in max_serial_by_month.items():
        counters.update_one(
            {"_id": f"incident_seq_{month_key}"},
            {"$max": {"seq": int(serial)}},
            upsert=True,
        )

def backfill_public_ticket_ids():
    rows = list(tickets.find({}, {"_id": 1, "ticketId": 1, "createdAt": 1, "incidentId": 1}).sort([("createdAt", 1), ("_id", 1)]))
    if not rows:
        return

    max_serial_by_month: dict[str, int] = {}
    used_ids: set[str] = set()

    for row in rows:
        parsed = _parse_public_ticket_id(row.get("ticketId"))
        if not parsed:
            continue
        month_key, serial = parsed
        max_serial_by_month[month_key] = max(max_serial_by_month.get(month_key, 0), serial)
        used_ids.add(str(row.get("ticketId")))

    for row in rows:
        raw_ticket_id = str(row.get("ticketId") or "").strip()
        parsed = _parse_public_ticket_id(raw_ticket_id)
        if parsed:
            public_ticket_id = raw_ticket_id
        else:
            month_key = _ticket_month_key(row.get("createdAt"))
            next_serial = max_serial_by_month.get(month_key, 0) + 1
            candidate = _public_ticket_id(month_key, next_serial)
            while candidate in used_ids:
                next_serial += 1
                candidate = _public_ticket_id(month_key, next_serial)
            public_ticket_id = candidate
            used_ids.add(public_ticket_id)
            max_serial_by_month[month_key] = next_serial
            tickets.update_one({"_id": row.get("_id")}, {"$set": {"ticketId": public_ticket_id}})

        incident_id = str(row.get("incidentId") or "").strip()
        if incident_id:
            if ObjectId.is_valid(incident_id):
                incidents.update_one({"_id": ObjectId(incident_id)}, {"$set": {"ticketId": public_ticket_id}})
            else:
                incidents.update_one({"_id": incident_id}, {"$set": {"ticketId": public_ticket_id}})

    for month_key, serial in max_serial_by_month.items():
        counters.update_one(
            {"_id": f"ticket_seq_{month_key}"},
            {"$max": {"seq": int(serial)}},
            upsert=True,
        )

def init_db():
    from pymongo.errors import OperationFailure
    
    try:
        users.create_index("email", unique=True, sparse=True)
    except OperationFailure:
        pass
    
    try:
        users.create_index("phone", unique=True, sparse=True)
    except OperationFailure:
        pass

    try:
        users.create_index("workerCode", unique=True, sparse=True)
    except OperationFailure:
        pass
    
    try:
        users.create_index("userType")
        users.create_index("officialRole")
        users.create_index([("userType", 1), ("officialRole", 1)])
    except OperationFailure:
        pass
    
    try:
        incidents.create_index("status")
        incidents.create_index("createdAt")
        incidents.create_index("updatedAt")
        incidents.create_index("category")
        incidents.create_index("priority")
        incidents.create_index("severity")
        incidents.create_index("location")
        incidents.create_index("reporterId")
        incidents.create_index("source")
        incidents.create_index("deviceId")
        incidents.create_index([("deviceId", 1), ("eventId", 1)])
        incidents.create_index("incidentId", unique=True, sparse=True)
    except OperationFailure:
        pass
    
    try:
        tickets.create_index("status")
        tickets.create_index("priority")
        tickets.create_index("createdAt")
        tickets.create_index("updatedAt")
        tickets.create_index("assignedTo")
        tickets.create_index("incidentId")
        tickets.create_index("ticketId", unique=True, sparse=True)
    except OperationFailure:
        pass
    
    try:
        messages.create_index("incidentId")
        messages.create_index("createdAt")
    except OperationFailure:
        pass
    
    try:
        password_resets.create_index("token", unique=True)
        password_resets.create_index("expiresAt", expireAfterSeconds=0)
    except OperationFailure:
        pass

    try:
        otp_challenges.create_index("expiresAt", expireAfterSeconds=0)
        otp_challenges.create_index([("userId", 1), ("purpose", 1), ("used", 1)])
    except OperationFailure:
        pass

    try:
        incident_logs.create_index("ticketId")
        incident_logs.create_index("incidentId")
        incident_logs.create_index("createdAt")
    except OperationFailure:
        pass

    cleanup_orphan_tickets()
    backfill_public_incident_ids()
    backfill_public_ticket_ids()
