from datetime import datetime
import re
import secrets
from fastapi import APIRouter, Depends, HTTPException
from app.auth import get_current_user, hash_password, require_official_roles
from app.config.settings import settings
from app.database import users
from app.models import DepartmentOfficialCreate, UserUpdate
from app.services.pincode_service import is_valid_pincode, normalize_pincode
from app.roles import normalize_official_role
from app.utils import serialize_doc, to_object_id
from pymongo.errors import DuplicateKeyError

router = APIRouter(prefix="/api/users")
DEPARTMENT_MANAGED_ROLES = {"supervisor", "field_inspector"}
DEFAULT_DEPARTMENT_FALLBACK = settings.DEFAULT_DEPARTMENT_NAME
WORKER_CODE_PATTERN = re.compile(r"^\d{6}$")

def _generate_worker_code() -> str:
    for _ in range(200):
        code = f"{secrets.randbelow(900000) + 100000:06d}"
        if not users.find_one({"workerCode": code}, {"_id": 1}):
            return code
    raise HTTPException(status_code=500, detail="Unable to generate worker code right now")

def _ensure_worker_code(worker_doc: dict) -> str:
    existing = str(worker_doc.get("workerCode") or "").strip()
    if WORKER_CODE_PATTERN.fullmatch(existing):
        return existing

    generated = _generate_worker_code()
    users.update_one(
        {"_id": worker_doc.get("_id")},
        {"$set": {"workerCode": generated, "updatedAt": datetime.utcnow().isoformat()}},
    )
    return generated

def _validate_optional_pincode(value: str | None) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None

    normalized = normalize_pincode(text)
    if not normalized:
        raise HTTPException(status_code=400, detail="pincode must be a valid 6-digit number")
    if not is_valid_pincode(normalized):
        raise HTTPException(status_code=400, detail="pincode not found")
    return normalized

@router.get("/profile")
def get_profile(current_user: dict = Depends(get_current_user)):
    return {"success": True, "data": current_user}

@router.put("/profile")
def update_profile(payload: UserUpdate, current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    updates = payload.dict(exclude_unset=True, exclude_none=True)
    if not updates:
        return {"success": True, "data": current_user}
    if "pincode" in updates:
        updates["pincode"] = _validate_optional_pincode(updates.get("pincode"))
    updates["updatedAt"] = datetime.utcnow().isoformat()
    obj_id = to_object_id(user_id)
    try:
        users.update_one({"_id": obj_id}, {"$set": updates})
    except DuplicateKeyError:
        raise HTTPException(status_code=400, detail="Email or phone already in use")
    user = users.find_one({"_id": obj_id})
    data = serialize_doc(user)
    if data:
        data.pop("password", None)
    return {"success": True, "data": data}

@router.get("/workers")
def list_workers(current_user: dict = Depends(require_official_roles("department", "supervisor"))):
    rows = list(
        users.find(
            {"userType": "official", "officialRole": "worker"},
            {"name": 1, "phone": 1, "email": 1, "workerSpecialization": 1, "workerCode": 1},
        ).sort("name", 1)
    )
    data = []
    for row in rows:
        payload = serialize_doc(row) or {}
        worker_code = _ensure_worker_code(row)
        data.append(
            {
                "id": payload.get("id"),
                "workerCode": worker_code,
                "name": payload.get("name") or payload.get("email") or payload.get("phone"),
                "phone": payload.get("phone"),
                "email": payload.get("email"),
                "officialRole": normalize_official_role("worker"),
                "workerSpecialization": payload.get("workerSpecialization") or "Other",
            }
        )
    return {"success": True, "data": data}

@router.get("/managed-officials")
def list_managed_officials(current_user: dict = Depends(require_official_roles("department"))):
    department_user_id = str(current_user.get("id") or "").strip()
    department_name = str(current_user.get("department") or "").strip()

    base_query: dict = {
        "userType": "official",
        "officialRole": {"$in": sorted(DEPARTMENT_MANAGED_ROLES)},
    }
    scope_conditions: list[dict] = []
    if department_user_id:
        scope_conditions.append({"createdByDepartmentId": department_user_id})
    if department_name:
        scope_conditions.append({"department": department_name})
    if scope_conditions:
        query = {"$and": [base_query, {"$or": scope_conditions}]}
    else:
        query = base_query

    rows = list(
        users.find(
            query,
            {"name": 1, "email": 1, "phone": 1, "officialRole": 1, "department": 1, "createdAt": 1},
        ).sort("createdAt", -1)
    )
    data = []
    for row in rows:
        payload = serialize_doc(row) or {}
        data.append(
            {
                "id": payload.get("id"),
                "name": payload.get("name") or payload.get("email") or payload.get("phone"),
                "email": payload.get("email"),
                "phone": payload.get("phone"),
                "officialRole": normalize_official_role(payload.get("officialRole")),
                "department": payload.get("department"),
                "createdAt": payload.get("createdAt"),
            }
        )
    return {"success": True, "data": data}

@router.post("/managed-officials")
def create_managed_official(
    payload: DepartmentOfficialCreate,
    current_user: dict = Depends(require_official_roles("department")),
):
    normalized_role = normalize_official_role(payload.officialRole)
    if normalized_role not in DEPARTMENT_MANAGED_ROLES:
        raise HTTPException(status_code=400, detail="officialRole must be supervisor or field_inspector")

    name_value = (payload.name or "").strip()
    if len(name_value) < 2:
        raise HTTPException(status_code=400, detail="Name must be at least 2 characters")

    email_value = (payload.email or "").strip().lower()
    if not email_value or "@" not in email_value:
        raise HTTPException(status_code=400, detail="A valid email is required")

    if len((payload.password or "").strip()) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    phone_value = (payload.phone or "").strip() or None
    conditions = [{"email": email_value}]
    if phone_value:
        conditions.append({"phone": phone_value})
    if users.find_one({"$or": conditions}):
        raise HTTPException(status_code=400, detail="Email or phone already in use")

    department_name = str(current_user.get("department") or "").strip()
    if not department_name:
        department_name = DEFAULT_DEPARTMENT_FALLBACK

    doc = {
        "name": name_value,
        "email": email_value,
        "phone": phone_value,
        "password": hash_password(payload.password),
        "userType": "official",
        "officialRole": normalized_role,
        "workerSpecialization": None,
        "address": payload.address,
        "pincode": _validate_optional_pincode(payload.pincode),
        "department": department_name,
        "createdByDepartmentId": str(current_user.get("id") or "").strip() or None,
        "createdByDepartmentName": current_user.get("name") or current_user.get("email"),
        "createdAt": datetime.utcnow(),
        "updatedAt": datetime.utcnow().isoformat(),
        "emailVerified": False,
        "twoFactorEnabled": False,
    }
    try:
        result = users.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status_code=400, detail="Email or phone already in use")

    created = users.find_one({"_id": result.inserted_id})
    data = serialize_doc(created) or {}
    data.pop("password", None)
    return {"success": True, "data": data}
