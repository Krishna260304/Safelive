import os
import logging
import threading
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.routes_auth import router as auth_router
from app.routes_incidents import router as incident_router
from app.routes_tickets import router as ticket_router
from app.routes_ws import router as ws_router
from app.routes_users import router as users_router
from app.routes_analytics import router as analytics_router
from app.routes_public import router as public_router
from app.database import init_db
from app.config.settings import settings
from app.services.priority_ai import warmup_priority_model
from app.services.progress_ai import warmup_progress_model
from app.services.inspector_reminder import start_inspector_reminder_worker
from app.services.auto_progress_tracker import start_auto_progress_tracker_worker
from app.services.logbook_sentence_ai import warmup_logbook_sentence_model
from app.services.pincode_service import warmup_pincode_index

app = FastAPI(title="SafeLive Smart Incident Backend")
LOGGER = logging.getLogger(__name__)

app.add_middleware(
	CORSMiddleware,
	allow_origins=settings.CORS_ORIGINS,
	allow_credentials=True,
	allow_methods=["*"],
	allow_headers=["*"],
)

os.makedirs(settings.IMAGE_DIR, exist_ok=True)
app.mount("/images", StaticFiles(directory=settings.IMAGE_DIR), name="images")

app.include_router(auth_router)
app.include_router(incident_router)
app.include_router(ticket_router)
app.include_router(ws_router)
app.include_router(users_router)
app.include_router(analytics_router)
app.include_router(public_router)

def _warmup_priority_model_background():
    try:
        warmup_priority_model()
    except Exception as exc:
        # Do not block API startup if model warmup fails.
        LOGGER.warning("Incident priority model warmup failed during startup: %s", exc)


def _warmup_progress_model_background():
    try:
        warmup_progress_model()
    except Exception as exc:
        # Do not block API startup if model warmup fails.
        LOGGER.warning("Ticket progress model warmup failed during startup: %s", exc)


def _warmup_logbook_model_background():
    try:
        warmup_logbook_sentence_model()
    except Exception as exc:
        LOGGER.warning("Logbook sentence model warmup failed during startup: %s", exc)


def _warmup_pincode_index_background():
    try:
        warmup_pincode_index()
    except Exception as exc:
        LOGGER.warning("Pincode index warmup failed during startup: %s", exc)


@app.on_event("startup")
def startup():
    init_db()
    threading.Thread(target=_warmup_priority_model_background, daemon=True).start()
    threading.Thread(target=_warmup_progress_model_background, daemon=True).start()
    threading.Thread(target=_warmup_logbook_model_background, daemon=True).start()
    threading.Thread(target=_warmup_pincode_index_background, daemon=True).start()
    start_inspector_reminder_worker()
    start_auto_progress_tracker_worker()
