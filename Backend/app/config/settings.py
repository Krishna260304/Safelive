import os
import secrets
from pathlib import Path
from dotenv import load_dotenv

_BASE_DIR = Path(__file__).resolve().parents[2]
load_dotenv(_BASE_DIR / ".env")

def _split_env_list(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value.strip())
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return float(value.strip())
    except ValueError:
        return default


def _resolve_secret_key() -> str:
    value = os.getenv("SECRET_KEY")
    if value:
        return value
    if os.getenv("ENV", "development").lower() == "production":
        raise RuntimeError("SECRET_KEY is required in production")
    return secrets.token_urlsafe(48)


class Settings:
    ENV = os.getenv("ENV", "development")
    PROJECT_NAME = os.getenv("PROJECT_NAME", "SafeLive")
    DEFAULT_DEPARTMENT_NAME = os.getenv("DEFAULT_DEPARTMENT_NAME", "Department")

    MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
    DB_NAME = os.getenv("DB_NAME", "safelive")

    SECRET_KEY = _resolve_secret_key()
    ALGORITHM = os.getenv("ALGORITHM", "HS256")
    ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))
    PASSWORD_RESET_EXPIRE_MINUTES = int(os.getenv("PASSWORD_RESET_EXPIRE_MINUTES", "30"))
    OTP_EXPIRE_MINUTES = _env_int("OTP_EXPIRE_MINUTES", 10)
    OTP_MAX_ATTEMPTS = _env_int("OTP_MAX_ATTEMPTS", 5)
    OTP_MIN_RESEND_SECONDS = _env_int("OTP_MIN_RESEND_SECONDS", 30)

    BASE_DIR = _BASE_DIR
    IMAGE_DIR = os.getenv("IMAGE_DIR", str(BASE_DIR / "images"))
    PINCODE_CSV_PATH = os.getenv("PINCODE_CSV_PATH", "")

    EMAIL_ENABLED = _env_bool("EMAIL_ENABLED", True)
    EMAIL_USER = os.getenv("EMAIL_USER", "safelive.alerts@gmail.com")
    EMAIL_PASS = os.getenv("EMAIL_PASS", "")
    EMAIL_FROM = os.getenv("EMAIL_FROM", EMAIL_USER)
    EMAIL_FROM_NAME = os.getenv("EMAIL_FROM_NAME", "SafeLive Alerts")
    EMAIL_REPLY_TO = os.getenv("EMAIL_REPLY_TO", "")
    EMAIL_ALERT_TO = os.getenv("EMAIL_ALERT_TO", EMAIL_USER)
    SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
    SMTP_PORT = _env_int("SMTP_PORT", 587)
    SMTP_USE_TLS = _env_bool("SMTP_USE_TLS", True)
    SMTP_USE_SSL = _env_bool("SMTP_USE_SSL", False)
    SMTP_TIMEOUT_SECONDS = _env_int("SMTP_TIMEOUT_SECONDS", 20)
    EMAIL_MAX_RETRIES = _env_int("EMAIL_MAX_RETRIES", 3)
    EMAIL_RETRY_BACKOFF_SECONDS = _env_float("EMAIL_RETRY_BACKOFF_SECONDS", 1.5)
    EMAIL_NOTIFY_ON_REGISTER = _env_bool("EMAIL_NOTIFY_ON_REGISTER", True)
    CRITICAL_INCIDENT_EMAIL_APPROVAL_ENABLED = _env_bool("CRITICAL_INCIDENT_EMAIL_APPROVAL_ENABLED", True)
    CRITICAL_INCIDENT_EMAIL_APPROVAL_EXPIRE_HOURS = _env_int("CRITICAL_INCIDENT_EMAIL_APPROVAL_EXPIRE_HOURS", 24)
    SMS_ALERT_TO = os.getenv("SMS_ALERT_TO", "")
    WHATSAPP_ALERT_TO = os.getenv("WHATSAPP_ALERT_TO", "")
    SMS_PROVIDER = (os.getenv("SMS_PROVIDER", "twilio") or "twilio").strip().lower()
    TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
    TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
    TWILIO_SMS_FROM = os.getenv("TWILIO_SMS_FROM", "")
    TWILIO_WHATSAPP_FROM = os.getenv("TWILIO_WHATSAPP_FROM", "")
    FIREBASE_SMS_FUNCTION_URL = os.getenv("FIREBASE_SMS_FUNCTION_URL", "")
    FIREBASE_SMS_FUNCTION_BEARER_TOKEN = os.getenv("FIREBASE_SMS_FUNCTION_BEARER_TOKEN", "")
    FIREBASE_SMS_TIMEOUT_SECONDS = _env_int("FIREBASE_SMS_TIMEOUT_SECONDS", 12)

    DOMAIN = os.getenv("DOMAIN", "https://safelive.in")
    IOT_API_KEYS = _split_env_list(os.getenv("IOT_API_KEYS"))
    IOT_ALLOWED_SOURCES = _split_env_list(os.getenv("IOT_ALLOWED_SOURCES")) or [
        "edge",
        "iot",
        "camera",
        "sensor",
    ]
    IOT_MAX_IMAGE_COUNT = _env_int("IOT_MAX_IMAGE_COUNT", 3)
    IOT_MAX_IMAGE_BASE64_LENGTH = _env_int("IOT_MAX_IMAGE_BASE64_LENGTH", 4_000_000)
    IOT_REQUIRE_IMAGE = _env_bool("IOT_REQUIRE_IMAGE", False)
    IOT_ACCEPT_LEGACY_REPORT_ENDPOINT = _env_bool("IOT_ACCEPT_LEGACY_REPORT_ENDPOINT", True)
    INCIDENT_DUPLICATE_RADIUS_METERS = _env_float("INCIDENT_DUPLICATE_RADIUS_METERS", 4.0)
    PRIORITY_AI_ENABLED = _env_bool("PRIORITY_AI_ENABLED", True)
    PRIORITY_AI_ENABLE_VISION = _env_bool("PRIORITY_AI_ENABLE_VISION", False)
    PRIORITY_AI_MODEL = os.getenv("PRIORITY_AI_MODEL", "Qwen/Qwen2.5-VL-3B-Instruct")
    PRIORITY_AI_TEXT_MODEL = os.getenv("PRIORITY_AI_TEXT_MODEL", "facebook/bart-large-mnli")
    PRIORITY_AI_MODEL_WEIGHT = _env_float("PRIORITY_AI_MODEL_WEIGHT", 0.85)
    PRIORITY_AI_OFFLINE_MODE = _env_bool("PRIORITY_AI_OFFLINE_MODE", False)
    PRIORITY_AI_REQUEST_TIMEOUT_SECONDS = _env_int("PRIORITY_AI_REQUEST_TIMEOUT_SECONDS", 10)
    PRIORITY_AI_MAX_IMAGES = _env_int("PRIORITY_AI_MAX_IMAGES", 1)
    PRIORITY_AI_MAX_NEW_TOKENS = _env_int("PRIORITY_AI_MAX_NEW_TOKENS", 56)
    PRIORITY_AI_IMAGE_MAX_EDGE = _env_int("PRIORITY_AI_IMAGE_MAX_EDGE", 960)
    PRIORITY_AI_ENABLE_DATASET_MODEL = _env_bool("PRIORITY_AI_ENABLE_DATASET_MODEL", False)
    PRIORITY_AI_EXTERNAL_DATASET = os.getenv("PRIORITY_AI_EXTERNAL_DATASET", "")
    PRIORITY_AI_MIN_TRAIN_SAMPLES = _env_int("PRIORITY_AI_MIN_TRAIN_SAMPLES", 30)
    PRIORITY_AI_MAX_TRAIN_ROWS = _env_int("PRIORITY_AI_MAX_TRAIN_ROWS", 200)
    PRIORITY_AI_VISION_WEIGHT = _env_float("PRIORITY_AI_VISION_WEIGHT", 0.7)
    PRIORITY_AI_TEXT_WEIGHT = _env_float("PRIORITY_AI_TEXT_WEIGHT", 0.3)
    PRIORITY_AI_DATASET_WEIGHT = _env_float("PRIORITY_AI_DATASET_WEIGHT", 0.2)
    PROGRESS_AI_ENABLED = _env_bool("PROGRESS_AI_ENABLED", True)
    PROGRESS_AI_MODEL = os.getenv("PROGRESS_AI_MODEL", "facebook/bart-large-mnli")
    PROGRESS_AI_OFFLINE_MODE = _env_bool("PROGRESS_AI_OFFLINE_MODE", False)
    PROGRESS_AI_REQUEST_TIMEOUT_SECONDS = _env_int("PROGRESS_AI_REQUEST_TIMEOUT_SECONDS", 10)
    LOGBOOK_AI_ENABLED = _env_bool("LOGBOOK_AI_ENABLED", True)
    LOGBOOK_AI_MODEL = os.getenv("LOGBOOK_AI_MODEL", "google/flan-t5-small")
    LOGBOOK_AI_OFFLINE_MODE = _env_bool("LOGBOOK_AI_OFFLINE_MODE", False)
    LOGBOOK_AI_REQUEST_TIMEOUT_SECONDS = _env_int("LOGBOOK_AI_REQUEST_TIMEOUT_SECONDS", 10)
    PROGRESS_TRACKER_ENABLED = _env_bool("PROGRESS_TRACKER_ENABLED", True)
    PROGRESS_TRACKER_INTERVAL_SECONDS = _env_int("PROGRESS_TRACKER_INTERVAL_SECONDS", 30)
    INSPECTOR_REMINDER_ENABLED = _env_bool("INSPECTOR_REMINDER_ENABLED", True)
    INSPECTOR_REMINDER_INTERVAL_SECONDS = _env_int("INSPECTOR_REMINDER_INTERVAL_SECONDS", 300)
    CORS_ORIGINS = _split_env_list(os.getenv("CORS_ORIGINS")) or [
        "https://safelive.in",
        "https://www.safelive.in",
        "http://www.safelive.in",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ]

settings = Settings()

if settings.ENV.lower() == "production":
    if settings.EMAIL_ENABLED and not os.getenv("EMAIL_PASS"):
        raise RuntimeError("EMAIL_PASS is required in production")
