from datetime import datetime, timedelta
import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from app.config.settings import settings
from app.database import users
from app.roles import normalize_official_role
from app.utils import serialize_doc

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")
OFFICIAL_ROLES = {"official", "head_supervisor"}

def _normalize_role(value: str | None) -> str:
    return (value or "").strip().lower()

def is_official_account(user: dict | None) -> bool:
    if not isinstance(user, dict):
        return False
    return _normalize_role(user.get("userType")) in OFFICIAL_ROLES

def is_head_supervisor_account(user: dict | None) -> bool:
    if not isinstance(user, dict):
        return False
    return _normalize_role(user.get("userType")) == "head_supervisor"

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(password: str, hashed: str) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False

def create_token(data: dict, expires_minutes: int | None = None):
    expires = datetime.utcnow() + timedelta(minutes=expires_minutes or settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = dict(data)
    payload["exp"] = expires
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

def get_user_from_token(token: str) -> dict:
    payload = decode_token(token)
    user_id = payload.get("sub")
    email = payload.get("email")
    
    db_user = None
    if user_id:
        db_user = users.find_one({"_id": user_id})

        if not db_user:
            try:
                from bson import ObjectId
                db_user = users.find_one({"_id": ObjectId(user_id)})
            except Exception:
                pass

    if not db_user and email:
        db_user = users.find_one({"email": email})
    
    if not db_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    data = serialize_doc(db_user)
    if data:
        data.pop("password", None)
    return data

def get_current_user(token: str = Depends(oauth2_scheme)):
    return get_user_from_token(token)

def get_official_user(current_user: dict = Depends(get_current_user)):
    if not is_official_account(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Official or head supervisor access required")
    return current_user

def get_head_supervisor_user(current_user: dict = Depends(get_current_user)):
    if not is_head_supervisor_account(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Head supervisor access required")
    return current_user

def require_official_roles(*allowed_roles: str):
    normalized_allowed = {normalize_official_role(role) for role in allowed_roles}
    normalized_allowed.discard(None)

    def _dependency(current_user: dict = Depends(get_official_user)):
        role = normalize_official_role(current_user.get("officialRole"))
        if role not in normalized_allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role permissions")
        return current_user

    return _dependency
