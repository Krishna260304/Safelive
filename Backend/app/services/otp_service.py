from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta

from app.config.settings import settings
from app.database import otp_challenges
from app.services.email_service import send_otp_email
from app.services.notification_service import send_sms
from app.utils import to_object_id

LOGGER = logging.getLogger(__name__)

PURPOSE_LOGIN_2FA = "login_2fa"
PURPOSE_CHANGE_PASSWORD = "change_password"
PURPOSE_ENABLE_2FA = "enable_2fa"
PURPOSE_DISABLE_2FA = "disable_2fa"


class OtpError(RuntimeError):
    pass


@dataclass(frozen=True)
class OtpChallengeInfo:
    challenge_id: str
    channels_sent: list[str]
    masked_email: str | None = None
    masked_phone: str | None = None


def _utcnow() -> datetime:
    return datetime.utcnow()


def _otp_hash(otp: str) -> str:
    key = settings.SECRET_KEY.encode("utf-8")
    payload = otp.encode("utf-8")
    return hmac.new(key, payload, hashlib.sha256).hexdigest()


def _generate_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _mask_email(value: str | None) -> str | None:
    if not value:
        return None
    email = value.strip()
    if "@" not in email:
        return None
    local, domain = email.split("@", 1)
    if not local:
        return f"***@{domain}"
    prefix = local[:2]
    return f"{prefix}{'*' * max(1, len(local) - len(prefix))}@{domain}"


def _mask_phone(value: str | None) -> str | None:
    if not value:
        return None
    phone = value.strip()
    digits = "".join(ch for ch in phone if ch.isdigit())
    if len(digits) < 4:
        return None
    suffix = digits[-4:]
    if phone.startswith("+"):
        # Keep the country code prefix length (best-effort).
        prefix = phone[: phone.find(digits[0])] if digits and digits[0] in phone else "+"
        return f"{prefix}{'*' * max(4, len(digits) - 4)}{suffix}"
    return f"{'*' * max(4, len(digits) - 4)}{suffix}"


def _purpose_label(purpose: str) -> str:
    if purpose == PURPOSE_LOGIN_2FA:
        return "sign-in"
    if purpose == PURPOSE_CHANGE_PASSWORD:
        return "password change"
    if purpose == PURPOSE_ENABLE_2FA:
        return "enabling 2FA"
    if purpose == PURPOSE_DISABLE_2FA:
        return "disabling 2FA"
    return "verification"


def _assert_resend_allowed(user_id: str, purpose: str) -> None:
    now = _utcnow()
    existing = otp_challenges.find_one(
        {"userId": user_id, "purpose": purpose, "used": False, "expiresAt": {"$gte": now}},
        sort=[("createdAt", -1)],
    )
    if not existing:
        return
    created_at = existing.get("createdAt")
    if isinstance(created_at, datetime):
        age_seconds = (now - created_at).total_seconds()
        if age_seconds < settings.OTP_MIN_RESEND_SECONDS:
            raise OtpError("OTP recently sent. Please wait a moment and try again.")


def create_and_send_otp(user_doc: dict, purpose: str) -> OtpChallengeInfo:
    user_id = str(user_doc.get("_id") or "").strip()
    if not user_id:
        raise OtpError("Unable to create OTP challenge: missing user id")

    _assert_resend_allowed(user_id=user_id, purpose=purpose)

    now = _utcnow()
    otp_value = _generate_otp()
    expires_at = now + timedelta(minutes=max(1, settings.OTP_EXPIRE_MINUTES))

    # Invalidate any previous active challenges for this purpose.
    otp_challenges.update_many(
        {"userId": user_id, "purpose": purpose, "used": False},
        {"$set": {"used": True, "invalidatedAt": now}},
    )

    insert_result = otp_challenges.insert_one(
        {
            "userId": user_id,
            "purpose": purpose,
            "otpHash": _otp_hash(otp_value),
            "attempts": 0,
            "used": False,
            "createdAt": now,
            "expiresAt": expires_at,
        }
    )

    email = (user_doc.get("email") or "").strip()
    phone = (user_doc.get("phone") or "").strip()
    channels_sent: list[str] = []
    delivery: dict = {}

    if email:
        try:
            send_otp_email(
                to_email=email,
                otp=otp_value,
                context=_purpose_label(purpose),
                expires_minutes=settings.OTP_EXPIRE_MINUTES,
            )
            channels_sent.append("email")
            delivery["email"] = {"ok": True, "to": email}
        except Exception as exc:
            delivery["email"] = {"ok": False, "to": email, "error": str(exc)}
            LOGGER.warning("OTP email delivery failed for %s: %s", email, exc)

    if phone:
        ok, err = send_sms(phone, f"SafeLive code: {otp_value}. Expires in {settings.OTP_EXPIRE_MINUTES} minutes.")
        if ok:
            channels_sent.append("sms")
            delivery["sms"] = {"ok": True, "to": phone}
        else:
            delivery["sms"] = {"ok": False, "to": phone, "error": err or "unknown error"}
            LOGGER.warning("OTP SMS delivery failed for %s: %s", phone, err)

    otp_challenges.update_one(
        {"_id": insert_result.inserted_id},
        {
            "$set": {
                "delivery": delivery,
                "channelsSent": channels_sent,
                "sentAt": now,
            }
        },
    )

    if not channels_sent:
        raise OtpError("Unable to deliver OTP to email or phone. Check email/Twilio configuration.")

    return OtpChallengeInfo(
        challenge_id=str(insert_result.inserted_id),
        channels_sent=channels_sent,
        masked_email=_mask_email(email),
        masked_phone=_mask_phone(phone),
    )


def verify_otp(challenge_id: str, otp: str, *, purpose: str | None = None, user_id: str | None = None) -> dict:
    if not challenge_id:
        raise OtpError("challengeId is required")
    otp_value = (otp or "").strip()
    if not otp_value:
        raise OtpError("OTP is required")

    try:
        obj_id = to_object_id(challenge_id)
    except Exception:
        raise OtpError("Invalid challengeId")

    now = _utcnow()
    record = otp_challenges.find_one({"_id": obj_id})
    if not record:
        raise OtpError("OTP challenge not found")
    if purpose and record.get("purpose") != purpose:
        raise OtpError("OTP challenge purpose mismatch")
    if user_id and record.get("userId") != user_id:
        raise OtpError("OTP challenge does not belong to this user")
    if record.get("used"):
        raise OtpError("OTP challenge already used")
    expires_at = record.get("expiresAt")
    if isinstance(expires_at, datetime) and expires_at < now:
        raise OtpError("OTP expired")

    attempts = int(record.get("attempts") or 0)
    if attempts >= settings.OTP_MAX_ATTEMPTS:
        raise OtpError("Too many attempts. Please request a new OTP.")

    expected_hash = (record.get("otpHash") or "").strip()
    provided_hash = _otp_hash(otp_value)
    if not expected_hash or not hmac.compare_digest(expected_hash, provided_hash):
        otp_challenges.update_one({"_id": obj_id}, {"$inc": {"attempts": 1}})
        raise OtpError("Invalid OTP")

    otp_challenges.update_one(
        {"_id": obj_id},
        {"$set": {"used": True, "verifiedAt": now}},
    )
    return record

