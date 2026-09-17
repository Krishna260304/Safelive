"""
SafeLive RPi 5 Edge Device - Configuration Module
=================================================
Centralized settings management for camera, GPS, YOLOv8 inference,
incident debouncing, local Wi-Fi API server, and Safelive server syncing.
"""

import os
from pathlib import Path
from dataclasses import dataclass, field

BASE_DIR = Path(__file__).resolve().parent

# Safe dotenv loader with fallback
try:
    from dotenv import load_dotenv
    load_dotenv(BASE_DIR / ".env")
except ImportError:
    env_file = BASE_DIR / ".env"
    if env_file.exists():
        with open(env_file, "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


@dataclass
class EdgeConfig:
    # --------------------------------------------------------------------------
    # Device Identity & Authentication
    # --------------------------------------------------------------------------
    DEVICE_ID: str = os.getenv("DEVICE_ID", "rpi5-safelive-unit-01")
    DEVICE_NAME: str = os.getenv("DEVICE_NAME", "SafeLive RPi 5 Field Unit")
    # Password required by Field Inspector to connect locally to this device
    DEVICE_PASSWORD: str = os.getenv("DEVICE_PASSWORD", "safelive2026")
    DEVICE_SECRET_KEY: str = os.getenv("DEVICE_SECRET_KEY", "safelive-edge-secret-key-rpi5")
    WIFI_SSID: str = os.getenv("WIFI_SSID", "")
    SCOPE: str = os.getenv("SCOPE", "city")
    SOURCE: str = os.getenv("SOURCE", "rpi5_edge")
    
    # --------------------------------------------------------------------------
    # Safelive Central Server Sync Settings
    # --------------------------------------------------------------------------
    # Central server endpoint that receives ONLY verified detected incidents
    SERVER_URL: str = os.getenv("SERVER_URL", "http://localhost:8000/api/iot/incidents")
    IOT_API_KEY: str = os.getenv("IOT_API_KEY", "")
    SERVER_SYNC_ENABLED: bool = os.getenv("SERVER_SYNC_ENABLED", "true").lower() in ("true", "1", "yes")
    SERVER_TIMEOUT_SECONDS: float = float(os.getenv("SERVER_TIMEOUT_SECONDS", "15.0"))
    MAX_RETRIES: int = int(os.getenv("MAX_RETRIES", "3"))

    # --------------------------------------------------------------------------
    # Camera Configuration
    # --------------------------------------------------------------------------
    # 'v4l2' (USB cam), 'picamera2' (RPi CSI cam), 'stream' (RTSP/HTTP), 'test' (synthetic)
    CAMERA_TYPE: str = os.getenv("CAMERA_TYPE", "v4l2").lower()
    CAMERA_INDEX: int = int(os.getenv("CAMERA_INDEX", "0"))
    STREAM_URL: str = os.getenv("STREAM_URL", "")
    # Pi 5 CPU-friendly defaults. Increase only after measuring on the actual unit.
    FRAME_WIDTH: int = int(os.getenv("FRAME_WIDTH", "640"))
    FRAME_HEIGHT: int = int(os.getenv("FRAME_HEIGHT", "360"))
    TARGET_FPS: int = int(os.getenv("TARGET_FPS", "15"))
    CAMERA_RECONNECT_DELAY: float = float(os.getenv("CAMERA_RECONNECT_DELAY", "2.0"))

    # --------------------------------------------------------------------------
    # GPS Configuration
    # --------------------------------------------------------------------------
    # Common ports: '/dev/ttyUSB0', '/dev/serial0', '/dev/ttyAMA0'
    GPS_PORT: str = os.getenv("GPS_PORT", "/dev/ttyUSB0")
    GPS_BAUDRATE: int = int(os.getenv("GPS_BAUDRATE", "9600"))
    GPS_TIMEOUT: float = float(os.getenv("GPS_TIMEOUT", "1.0"))
    # Fallback to simulated GPS drift if no physical GPS module connected
    GPS_MOCK_FALLBACK: bool = os.getenv("GPS_MOCK_FALLBACK", "false").lower() in ("true", "1", "yes")
    DEFAULT_LAT: float = float(os.getenv("DEFAULT_LAT", "0"))
    DEFAULT_LON: float = float(os.getenv("DEFAULT_LON", "0"))

    # --------------------------------------------------------------------------
    # ML / YOLOv8 Detection Settings
    # --------------------------------------------------------------------------
    # Path to custom civic model or default YOLOv8 model (yolov8n.pt, best.pt, etc.)
    YOLO_MODEL_PATH: str = os.getenv("YOLO_MODEL_PATH", "models/best.pt")
    CONFIDENCE_THRESHOLD: float = float(os.getenv("CONFIDENCE_THRESHOLD", "0.45"))
    IOU_THRESHOLD: float = float(os.getenv("IOU_THRESHOLD", "0.45"))
    INFERENCE_DEVICE: str = os.getenv("INFERENCE_DEVICE", "cpu")  # 'cpu', 'cuda', 'npu'
    INFERENCE_FPS_LIMIT: float = float(os.getenv("INFERENCE_FPS_LIMIT", "2.0"))  # Pi 5 CPU-friendly inference rate
    INFERENCE_SIZE: int = int(os.getenv("INFERENCE_SIZE", "640"))
    MAX_DETECTIONS: int = int(os.getenv("MAX_DETECTIONS", "50"))
    SAVE_ANNOTATED_SNAPSHOTS: bool = os.getenv("SAVE_ANNOTATED_SNAPSHOTS", "true").lower() in ("true", "1", "yes")

    # --------------------------------------------------------------------------
    # Incident Logic & Anti-Spam (Debounce & Cooldown)
    # --------------------------------------------------------------------------
    # Do not send the same category incident if detected within this radius (meters)
    DISTANCE_DEBOUNCE_METERS: float = float(os.getenv("DISTANCE_DEBOUNCE_METERS", "30.0"))
    # Do not send the same category incident if detected within this duration (seconds)
    COOLDOWN_SECONDS: float = float(os.getenv("COOLDOWN_SECONDS", "45.0"))
    # Minimum severity required to report ('low', 'medium', 'high', 'critical')
    MIN_SEVERITY: str = os.getenv("MIN_SEVERITY", "medium").lower()
    LOCAL_STORAGE_DIR: Path = BASE_DIR / "data"

    # --------------------------------------------------------------------------
    # Local Web & Live Streaming Server (for Field Inspector Wi-Fi direct connect)
    # --------------------------------------------------------------------------
    LOCAL_SERVER_HOST: str = os.getenv("LOCAL_SERVER_HOST", "0.0.0.0")
    LOCAL_SERVER_PORT: int = int(os.getenv("LOCAL_SERVER_PORT", "8080"))
    ENABLE_LOCAL_SERVER: bool = os.getenv("ENABLE_LOCAL_SERVER", "true").lower() in ("true", "1", "yes")


# Global Configuration Instance
config = EdgeConfig()
# Ensure local storage directory exists
config.LOCAL_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
(config.LOCAL_STORAGE_DIR / "snapshots").mkdir(parents=True, exist_ok=True)
