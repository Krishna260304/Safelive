"""
SafeLive RPi 5 Edge Device - Local Web & Streaming API Server
============================================================
Provides an on-device local HTTP & WebSocket server for Field Inspectors:
- Device Wi-Fi Pairing & Password Authentication
- Live Camera & YOLO Detection MJPEG/WebSocket Stream
- Real-time Hardware Telemetry (CPU Temp, RAM, GPS Fix, Speed)
- Edge Incident Feed & Snapshot Inspection
- Device Configuration & Manual Triggering
"""

import os
import time
import json
import logging
import asyncio
import socket
import threading
import secrets
from pathlib import Path
from typing import Optional, Dict, Any, List
import cv2
import numpy as np

from fastapi import FastAPI, HTTPException, Header, Depends, WebSocket, WebSocketDisconnect, Response
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import config

LOGGER = logging.getLogger("safelive.local_server")

# Global state references populated by main.py
CAMERA_STREAM = None
GPS_TRACKER = None
DETECTOR = None
INCIDENT_MGR = None
LATEST_ANNOTATED_FRAME: Optional[np.ndarray] = None
LATEST_FRAME_LOCK = None
ACTIVE_TOKENS: set[str] = set()

app = FastAPI(
    title="SafeLive RPi 5 Edge Controller",
    description="Local edge API for Field Inspector direct Wi-Fi inspection & telemetry",
    version="2.0.0"
)

# Enable CORS for local web browsers / portals connecting over Wi-Fi
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SETUP_PAGE = Path(__file__).resolve().parent / "setup.html"


# ------------------------------------------------------------------------------
# Request / Response Schemas
# ------------------------------------------------------------------------------
class AuthRequest(BaseModel):
    password: str
    deviceId: Optional[str] = None


class ConfigUpdateRequest(BaseModel):
    confidence_threshold: Optional[float] = None
    server_sync_enabled: Optional[bool] = None
    server_url: Optional[str] = None
    cooldown_seconds: Optional[float] = None
    new_device_password: Optional[str] = None


class ManualTriggerRequest(BaseModel):
    category: str = "field_inspection"
    title: str = "Field Inspector Manual Report"
    description: str
    severity: str = "high"


# ------------------------------------------------------------------------------
# Authentication Dependency
# ------------------------------------------------------------------------------
def verify_device_token(authorization: Optional[str] = Header(None)) -> bool:
    """Validate Bearer token for protected local endpoints."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Device authentication required")
    token = authorization.replace("Bearer ", "").strip()
    if token not in ACTIVE_TOKENS:
        raise HTTPException(status_code=401, detail="Invalid Device Password / Token")
    return True


# ------------------------------------------------------------------------------
# Hardware Telemetry Helpers (Raspberry Pi 5)
# ------------------------------------------------------------------------------
def get_rpi_cpu_temperature() -> Optional[float]:
    """Read CPU temperature in Celsius from hardware thermal zone."""
    try:
        thermal_path = "/sys/class/thermal/thermal_zone0/temp"
        if os.path.exists(thermal_path):
            with open(thermal_path, "r") as f:
                temp_milli = int(f.read().strip())
                return round(temp_milli / 1000.0, 1)
    except Exception:
        pass
    return None


def get_system_telemetry() -> dict:
    """Get real system resource usage."""
    try:
        import psutil  # type: ignore
        cpu_pct = psutil.cpu_percent(interval=None)
        mem = psutil.virtual_memory()
        disk = psutil.disk_usage("/")
        return {
            "cpu_percent": cpu_pct,
            "memory_percent": mem.percent,
            "memory_used_mb": round(mem.used / (1024 * 1024), 1),
            "memory_total_mb": round(mem.total / (1024 * 1024), 1),
            "disk_percent": disk.percent,
        }
    except Exception:
        return {
            "cpu_percent": None,
            "memory_percent": None,
            "memory_used_mb": None,
            "memory_total_mb": None,
            "disk_percent": None,
        }


# ------------------------------------------------------------------------------
# API Endpoints
# ------------------------------------------------------------------------------

@app.get("/")
def root():
    if SETUP_PAGE.exists():
        return FileResponse(str(SETUP_PAGE), media_type="text/html")
    return {
        "status": "online",
        "device_id": config.DEVICE_ID,
        "device_name": config.DEVICE_NAME,
        "service": "SafeLive RPi 5 Edge AI Unit",
        "endpoints": {
            "auth": "POST /api/auth",
            "status": "GET /api/status",
            "stream_mjpeg": "GET /api/stream/mjpeg",
            "stream_frame": "GET /api/stream/frame",
            "incidents": "GET /api/incidents",
            "config": "GET/POST /api/config",
            "ws_live": "WS /ws/live",
        }
    }


@app.get("/setup", include_in_schema=False)
@app.get("/setup.html", include_in_schema=False)
def setup_page():
    """Serve the password-protected device setup page."""
    if not SETUP_PAGE.exists():
        raise HTTPException(status_code=404, detail="Setup page not installed")
    return FileResponse(str(SETUP_PAGE), media_type="text/html")


def start_discovery_responder():
    """Announce this unit to a LAN discovery request (no mock devices involved)."""
    def serve():
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("0.0.0.0", 37020))
        while True:
            try:
                message, address = sock.recvfrom(1024)
                if message != b"SAFELIVE_DISCOVER_RPI5":
                    continue
                probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                try:
                    probe.connect(address)
                    host = probe.getsockname()[0]
                finally:
                    probe.close()
                response = {
                    "service": "safelive-rpi5",
                    "device_id": config.DEVICE_ID,
                    "device_name": config.DEVICE_NAME,
                    "ssid": config.WIFI_SSID or f"SafeLive-RPi5-{config.DEVICE_ID[-4:]}",
                    "host": host,
                    "port": config.LOCAL_SERVER_PORT,
                }
                sock.sendto(json.dumps(response).encode("utf-8"), address)
            except Exception as exc:
                LOGGER.warning("Discovery responder stopped: %s", exc)
                break
    threading.Thread(target=serve, name="RpiDiscoveryResponder", daemon=True).start()


@app.post("/api/auth")
def authenticate_device(req: AuthRequest):
    """
    Authenticate Field Inspector with device password.
    Returns session token and device metadata.
    """
    if req.password == config.DEVICE_PASSWORD or req.password == config.DEVICE_SECRET_KEY:
        LOGGER.info("Field Inspector authenticated successfully with device password.")
        token = secrets.token_urlsafe(32)
        ACTIVE_TOKENS.add(token)
        return {
            "success": True,
            "token": token,
            "device_id": config.DEVICE_ID,
            "device_name": config.DEVICE_NAME,
            "authenticated_at": time.time(),
            "message": "Connected to SafeLive RPi 5 Edge Unit",
        }
    LOGGER.warning("Failed authentication attempt with invalid password.")
    raise HTTPException(status_code=401, detail="Incorrect Device Password")


@app.get("/api/status")
def get_device_status(_: bool = Depends(verify_device_token)):
    """Return aggregated real-time telemetry (Hardware, GPS, Camera, ML, Sync)."""
    gps_data = GPS_TRACKER.get_telemetry() if GPS_TRACKER else {}
    camera_data = CAMERA_STREAM.get_status() if CAMERA_STREAM else {}
    detector_data = DETECTOR.get_status() if DETECTOR else {}
    queue_data = INCIDENT_MGR.get_queue_stats() if INCIDENT_MGR else {}
    system_data = get_system_telemetry()
    cpu_temp = get_rpi_cpu_temperature()

    return {
        "device_id": config.DEVICE_ID,
        "device_name": config.DEVICE_NAME,
        "scope": config.SCOPE,
        "source": config.SOURCE,
        "timestamp": time.time(),
        "hardware": {
            "cpu_temperature_c": cpu_temp,
            "temperature_warning": cpu_temp is not None and cpu_temp > 75.0,
            **system_data,
        },
        "gps": gps_data,
        "camera": camera_data,
        "ml_detector": detector_data,
        "server_sync": queue_data,
        "wifi_hotspot": {
            "ssid": config.WIFI_SSID or f"SafeLive-RPi5-{config.DEVICE_ID[-4:]}",
            "ip": config.LOCAL_SERVER_HOST,
            "port": config.LOCAL_SERVER_PORT,
        }
    }


@app.get("/api/incidents")
def get_recent_incidents(limit: int = 20, _: bool = Depends(verify_device_token)):
    """Return recent civic incidents detected by this edge device."""
    if not INCIDENT_MGR:
        return {"incidents": []}
    return {
        "device_id": config.DEVICE_ID,
        "count": len(INCIDENT_MGR.get_recent_incidents(limit)),
        "incidents": INCIDENT_MGR.get_recent_incidents(limit),
        "stats": INCIDENT_MGR.get_queue_stats(),
    }


@app.get("/api/snapshots/{filename}")
def get_snapshot_image(filename: str, _: bool = Depends(verify_device_token)):
    """Serve saved incident JPEG snapshot."""
    clean_filename = Path(filename).name
    file_path = config.LOCAL_STORAGE_DIR / "snapshots" / clean_filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return FileResponse(str(file_path), media_type="image/jpeg")


@app.get("/api/stream/frame")
def get_latest_frame(_: bool = Depends(verify_device_token)):
    """Return the single latest processed frame as JPEG."""
    global LATEST_ANNOTATED_FRAME
    frame = None
    if LATEST_FRAME_LOCK:
        with LATEST_FRAME_LOCK:
            if LATEST_ANNOTATED_FRAME is not None:
                frame = LATEST_ANNOTATED_FRAME.copy()

    if frame is None and CAMERA_STREAM:
        frame = CAMERA_STREAM.get_frame()

    if frame is None:
        raise HTTPException(status_code=503, detail="Camera stream unavailable")

    _, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
    return Response(content=buffer.tobytes(), media_type="image/jpeg")


def _generate_mjpeg_stream():
    """Generator function that yields multipart MJPEG frames."""
    global LATEST_ANNOTATED_FRAME
    while True:
        frame = None
        if LATEST_FRAME_LOCK:
            with LATEST_FRAME_LOCK:
                if LATEST_ANNOTATED_FRAME is not None:
                    frame = LATEST_ANNOTATED_FRAME.copy()

        if frame is None and CAMERA_STREAM:
            frame = CAMERA_STREAM.get_frame()

        if frame is not None:
            _, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
            frame_bytes = buffer.tobytes()
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n" + frame_bytes + b"\r\n"
            )
        time.sleep(0.04)  # ~25 FPS stream


@app.get("/api/stream/mjpeg")
def stream_mjpeg():
    """
    Live Video Stream with real-time YOLO bounding boxes.
    Can be directly embedded into an <img> tag in HTML/React:
    <img src="http://192.168.4.1:8080/api/stream/mjpeg" />
    """
    return StreamingResponse(
        _generate_mjpeg_stream(),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )


@app.websocket("/ws/live")
async def websocket_live_stream(websocket: WebSocket):
    """
    High-speed WebSocket delivering live detection metadata & telemetry to the Field Inspector UI.
    """
    await websocket.accept()
    LOGGER.info("WebSocket client connected to live telemetry stream.")
    try:
        while True:
            gps_telemetry = GPS_TRACKER.get_telemetry() if GPS_TRACKER else {}
            detector_stats = DETECTOR.get_status() if DETECTOR else {}
            cpu_temp = get_rpi_cpu_temperature()

            data = {
                "type": "TELEMETRY_UPDATE",
                "timestamp": time.time(),
                "gps": gps_telemetry,
                "ml": detector_stats,
                "cpu_temp": cpu_temp,
                "device_id": config.DEVICE_ID,
            }
            await websocket.send_text(json.dumps(data))
            await asyncio.sleep(0.5)  # 2 Hz telemetry update
    except WebSocketDisconnect:
        LOGGER.info("WebSocket client disconnected.")
    except Exception as exc:
        LOGGER.warning("WebSocket stream error: %s", exc)


@app.get("/api/config")
def get_device_config(_: bool = Depends(verify_device_token)):
    """Return editable configuration parameters."""
    return {
        "device_id": config.DEVICE_ID,
        "device_name": config.DEVICE_NAME,
        "confidence_threshold": config.CONFIDENCE_THRESHOLD,
        "iou_threshold": config.IOU_THRESHOLD,
        "server_sync_enabled": config.SERVER_SYNC_ENABLED,
        "server_url": config.SERVER_URL,
        "cooldown_seconds": config.COOLDOWN_SECONDS,
        "distance_debounce_meters": config.DISTANCE_DEBOUNCE_METERS,
        "camera_type": config.CAMERA_TYPE,
        "gps_port": config.GPS_PORT,
    }


@app.post("/api/config")
def update_device_config(req: ConfigUpdateRequest, _: bool = Depends(verify_device_token)):
    """Update runtime configuration parameters."""
    if req.confidence_threshold is not None:
        config.CONFIDENCE_THRESHOLD = max(0.1, min(1.0, req.confidence_threshold))
        if DETECTOR:
            DETECTOR.conf_threshold = config.CONFIDENCE_THRESHOLD

    if req.server_sync_enabled is not None:
        config.SERVER_SYNC_ENABLED = req.server_sync_enabled

    if req.server_url is not None and req.server_url.strip():
        config.SERVER_URL = req.server_url.strip()

    if req.cooldown_seconds is not None:
        config.COOLDOWN_SECONDS = max(5.0, req.cooldown_seconds)

    if req.new_device_password is not None and len(req.new_device_password) >= 4:
        config.DEVICE_PASSWORD = req.new_device_password

    LOGGER.info("Device configuration updated by Field Inspector.")
    return {"success": True, "config": get_device_config(True)}


@app.post("/api/trigger")
def manual_incident_trigger(req: ManualTriggerRequest, _: bool = Depends(verify_device_token)):
    """Allow Field Inspector to submit a manual on-site inspection ticket."""
    if not CAMERA_STREAM or not INCIDENT_MGR:
        raise HTTPException(status_code=503, detail="Services not initialized")

    frame = CAMERA_STREAM.get_frame()
    if frame is None:
        raise HTTPException(status_code=503, detail="Camera frame unavailable")

    from detector import DetectedIssue
    h, w = frame.shape[:2]
    manual_issue = DetectedIssue(
        category=req.category,
        title=req.title,
        description=req.description,
        department="Field Inspection",
        severity=req.severity,
        confidence=1.0,
        bbox=(int(w * 0.2), int(h * 0.2), int(w * 0.8), int(h * 0.8)),
        area_ratio=0.36,
    )

    incident = INCIDENT_MGR.process_detection(manual_issue, frame)
    return {"success": True, "incident": incident}
