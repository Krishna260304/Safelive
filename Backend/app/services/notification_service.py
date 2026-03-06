import base64
import json
from urllib import request, parse, error
from app.config.settings import settings

def _normalize_phone(value: str) -> str:
    if not value:
        return ""
    cleaned = "".join(ch for ch in value if ch.isdigit() or ch == "+")
    if cleaned.startswith("+"):
        return cleaned
    if cleaned.startswith("0"):
        cleaned = cleaned[1:]
    if len(cleaned) == 10:
        return f"+91{cleaned}"
    if len(cleaned) == 12 and cleaned.startswith("91"):
        return f"+{cleaned}"
    return cleaned

def _twilio_request(path: str, data: dict):
    sid = settings.TWILIO_ACCOUNT_SID
    token = settings.TWILIO_AUTH_TOKEN
    if not sid or not token:
        return False, "Twilio credentials missing"
    encoded = parse.urlencode(data).encode("utf-8")
    url = f"https://api.twilio.com{path}"
    req = request.Request(url, data=encoded, method="POST")
    basic = base64.b64encode(f"{sid}:{token}".encode("utf-8")).decode("utf-8")
    req.add_header("Authorization", f"Basic {basic}")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with request.urlopen(req, timeout=12) as res:
            body = res.read().decode("utf-8")
            _ = json.loads(body)
            return 200 <= res.status < 300, ""
    except error.HTTPError as exc:
        try:
            payload = exc.read().decode("utf-8")
        except Exception:
            payload = str(exc)
        return False, payload
    except Exception as exc:
        return False, str(exc)


def _firebase_sms_request(to_phone: str, message: str):
    endpoint = (settings.FIREBASE_SMS_FUNCTION_URL or "").strip()
    if not endpoint:
        return False, "Firebase SMS function URL missing"

    payload = json.dumps(
        {
            "to": to_phone,
            "message": message,
        }
    ).encode("utf-8")
    req = request.Request(endpoint, data=payload, method="POST")
    req.add_header("Content-Type", "application/json")
    token = (settings.FIREBASE_SMS_FUNCTION_BEARER_TOKEN or "").strip()
    if token:
        req.add_header("Authorization", f"Bearer {token}")

    timeout = max(int(settings.FIREBASE_SMS_TIMEOUT_SECONDS or 12), 1)
    try:
        with request.urlopen(req, timeout=timeout) as res:
            body = res.read().decode("utf-8") if res else ""
            parsed = {}
            if body:
                try:
                    parsed = json.loads(body)
                except Exception:
                    parsed = {}
            if isinstance(parsed, dict):
                if parsed.get("ok") is False or parsed.get("success") is False:
                    return False, str(parsed.get("error") or parsed.get("message") or "Firebase SMS failed")
            return 200 <= res.status < 300, ""
    except error.HTTPError as exc:
        try:
            payload = exc.read().decode("utf-8")
        except Exception:
            payload = str(exc)
        return False, payload
    except Exception as exc:
        return False, str(exc)

def send_sms(to_phone: str, message: str):
    to_phone = _normalize_phone(to_phone)
    if not to_phone:
        return False, "SMS phone configuration missing"

    provider = (settings.SMS_PROVIDER or "twilio").strip().lower()
    if provider == "firebase":
        if (settings.FIREBASE_SMS_FUNCTION_URL or "").strip():
            return _firebase_sms_request(to_phone, message)
        if not (
            (settings.TWILIO_ACCOUNT_SID or "").strip()
            and (settings.TWILIO_AUTH_TOKEN or "").strip()
            and (settings.TWILIO_SMS_FROM or "").strip()
        ):
            return False, "Firebase SMS function URL missing"
    elif provider != "twilio":
        return False, f"Unsupported SMS_PROVIDER: {provider}"

    from_phone = _normalize_phone(settings.TWILIO_SMS_FROM)
    if not from_phone:
        return False, "SMS phone configuration missing"
    return _twilio_request(
        f"/2010-04-01/Accounts/{settings.TWILIO_ACCOUNT_SID}/Messages.json",
        {
            "To": to_phone,
            "From": from_phone,
            "Body": message,
        },
    )

def send_whatsapp(to_phone: str, message: str):
    to_phone = _normalize_phone(to_phone)
    from_phone = _normalize_phone(settings.TWILIO_WHATSAPP_FROM)
    if not to_phone or not from_phone:
        return False, "WhatsApp phone configuration missing"
    return _twilio_request(f"/2010-04-01/Accounts/{settings.TWILIO_ACCOUNT_SID}/Messages.json", {
        "To": f"whatsapp:{to_phone}",
        "From": f"whatsapp:{from_phone}",
        "Body": message
    })

def send_stakeholder_notifications(message: str):
    results = {"sms": None, "whatsapp": None}
    if settings.SMS_ALERT_TO:
        ok, err = send_sms(settings.SMS_ALERT_TO, message)
        results["sms"] = {"ok": ok, "error": err or None}
    if settings.WHATSAPP_ALERT_TO:
        ok, err = send_whatsapp(settings.WHATSAPP_ALERT_TO, message)
        results["whatsapp"] = {"ok": ok, "error": err or None}
    return results
