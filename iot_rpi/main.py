"""
SafeLive RPi 5 Edge Device - Main Pipeline Orchestrator
======================================================
Coordinates:
1. Threaded Camera Capture (V4L2 / Picamera2 / RTSP)
2. Threaded GPS Tracking (Serial NMEA NEO-6M/8M/M9N)
3. YOLOv8 Civic Incident Detection Engine
4. Anti-Spam Debounce & Central Server Sync (IncidentManager)
5. Local Wi-Fi API & Live MJPEG Video Stream Server (FastAPI)
"""

import sys
import time
import signal
import logging
import threading
import uvicorn
import cv2
import numpy as np

from config import config
from camera import CameraStream
from gps_tracker import GPSTracker
from detector import CivicIncidentDetector
from incident_manager import IncidentManager
import local_server

# Configure rich console logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(name)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
    ]
)
LOGGER = logging.getLogger("safelive.main")

# Global instances
camera: CameraStream
gps: GPSTracker
detector: CivicIncidentDetector
incident_mgr: IncidentManager
frame_lock = threading.Lock()
running = True


def signal_handler(signum, frame):
    """Graceful termination handler."""
    global running
    LOGGER.info("Shutdown signal received (%d). Terminating edge pipeline...", signum)
    running = False


def overlay_telemetry_banner(frame: np.ndarray, gps_tracker: GPSTracker, fps: float, latency_ms: float) -> np.ndarray:
    """Render high-contrast bottom status banner on frame for Field Inspector live stream."""
    h, w = frame.shape[:2]
    telemetry = gps_tracker.get_telemetry()

    # Semi-transparent dark bottom bar
    bar_h = 42
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, h - bar_h), (w, h), (15, 15, 20), -1)
    cv2.addWeighted(overlay, 0.75, frame, 0.25, 0, frame)

    # Format text
    lat, lon = telemetry["latitude"], telemetry["longitude"]
    speed = telemetry["speed_kmh"]
    sats = telemetry["satellites"]
    fix_str = "3D-FIX" if telemetry["has_fix"] else "ACQUIRING"

    gps_text = f"GPS: {lat:.5f}, {lon:.5f} | Spd: {speed:.1f} km/h | Sats: {sats} [{fix_str}]"
    perf_text = f"FPS: {fps:.1f} | AI: {latency_ms:.0f}ms | Unit: {config.DEVICE_ID}"

    font = cv2.FONT_HERSHEY_SIMPLEX
    cv2.putText(frame, gps_text, (15, h - 14), font, 0.48, (0, 230, 255), 1, cv2.LINE_AA)
    
    (tw, _), _ = cv2.getTextSize(perf_text, font, 0.48, 1)
    cv2.putText(frame, perf_text, (max(10, w - tw - 15), h - 14), font, 0.48, (200, 255, 200), 1, cv2.LINE_AA)

    return frame


def ai_processing_loop():
    """Main CV & ML loop that processes camera frames and triggers incident reports."""
    global running
    LOGGER.info("Starting AI Detection & Processing Loop...")

    fps_count = 0
    fps_start = time.time()
    current_fps = 0.0
    last_inference_time = 0.0
    min_inference_interval = 1.0 / max(1.0, config.INFERENCE_FPS_LIMIT)

    while running:
        frame = camera.get_frame()
        if frame is None:
            time.sleep(0.01)
            continue

        now = time.time()
        should_run_inference = (now - last_inference_time) >= min_inference_interval

        if should_run_inference:
            last_inference_time = now
            issues, annotated_frame, latency_ms = detector.detect(frame)

            # Check if any civic incidents were detected
            if issues:
                for issue in issues:
                    # Pass through IncidentManager for spatial/temporal debounce and server upload
                    incident_mgr.process_detection(issue, annotated_frame, frame)
        else:
            # Re-use frame or previous annotations for smooth streaming
            annotated_frame = frame.copy()
            latency_ms = detector._last_latency_ms

        # Add GPS and telemetry HUD overlay
        annotated_frame = overlay_telemetry_banner(annotated_frame, gps, current_fps, latency_ms)

        # Update local server frame for live Wi-Fi preview
        with frame_lock:
            local_server.LATEST_ANNOTATED_FRAME = annotated_frame

        fps_count += 1
        if now - fps_start >= 1.0:
            current_fps = fps_count / (now - fps_start)
            fps_count = 0
            fps_start = now

        time.sleep(0.005)


def start_local_api_server():
    """Run FastAPI local server in background daemon."""
    LOGGER.info(
        "Starting Local Edge Server at http://%s:%d (Field Inspector Access)",
        config.LOCAL_SERVER_HOST, config.LOCAL_SERVER_PORT
    )
    uvicorn.run(
        local_server.app,
        host=config.LOCAL_SERVER_HOST,
        port=config.LOCAL_SERVER_PORT,
        log_level="warning",
        access_log=False
    )


def main():
    global camera, gps, detector, incident_mgr, running

    # Register signal handlers
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    print("=" * 70)
    print(" 🚀 SafeLive RPi 5 Civic Edge AI Device")
    print(f"    Device ID       : {config.DEVICE_ID}")
    print(f"    Device Password : {config.DEVICE_PASSWORD}")
    print(f"    Server Endpoint : {config.SERVER_URL}")
    print(f"    Local Web Host  : http://{config.LOCAL_SERVER_HOST}:{config.LOCAL_SERVER_PORT}")
    print("=" * 70)

    # 1. Initialize Subsystems
    gps = GPSTracker()
    gps.start()

    camera = CameraStream()
    camera.start()

    detector = CivicIncidentDetector()

    incident_mgr = IncidentManager(gps)
    incident_mgr.start()

    # 2. Bind references to local web server
    local_server.CAMERA_STREAM = camera
    local_server.GPS_TRACKER = gps
    local_server.DETECTOR = detector
    local_server.INCIDENT_MGR = incident_mgr
    local_server.LATEST_FRAME_LOCK = frame_lock
    local_server.start_discovery_responder()

    # 3. Start Local Web/Streaming Server Thread
    server_thread = threading.Thread(target=start_local_api_server, name="LocalServerWorker", daemon=True)
    server_thread.start()

    # 4. Start AI Loop
    try:
        ai_processing_loop()
    except KeyboardInterrupt:
        LOGGER.info("Keyboard interrupt received.")
    finally:
        LOGGER.info("Stopping all edge services...")
        incident_mgr.stop()
        camera.stop()
        gps.stop()
        LOGGER.info("SafeLive Edge Device shutdown complete.")


if __name__ == "__main__":
    main()
