"""
SafeLive RPi 5 Edge Device - Camera Subsystem
=============================================
Thread-safe video capture supporting:
1. USB Webcams / V4L2 devices (/dev/video0)
2. Raspberry Pi Camera Module 3 / HQ Camera via Picamera2
3. RTSP / HTTP live video streams
4. Synthetic test generator (for development & offline testing)
"""

import time
import logging
import threading
import numpy as np
import cv2
from typing import Optional, Tuple
from config import config

LOGGER = logging.getLogger("safelive.camera")


class CameraStream:
    """Thread-safe background camera frame grabber."""

    def __init__(self):
        self.camera_type = config.CAMERA_TYPE
        self.camera_index = config.CAMERA_INDEX
        self.stream_url = config.STREAM_URL
        self.target_width = config.FRAME_WIDTH
        self.target_height = config.FRAME_HEIGHT
        self.target_fps = config.TARGET_FPS

        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._current_frame: Optional[np.ndarray] = None
        self._last_frame_time: float = 0.0
        self._fps_actual: float = 0.0
        self._frame_count: int = 0
        self._is_connected: bool = False
        self._cap: Optional[cv2.VideoCapture] = None
        self._picam2 = None

    def start(self) -> bool:
        """Start the background capture thread."""
        if self._running:
            return True
        self._running = True
        self._thread = threading.Thread(target=self._capture_loop, name="CameraWorker", daemon=True)
        self._thread.start()
        LOGGER.info("Camera capture worker started (Type: %s)", self.camera_type)
        return True

    def stop(self):
        """Stop capture and release hardware resources."""
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        self._release_backend()
        LOGGER.info("Camera capture worker stopped.")

    def get_frame(self) -> Optional[np.ndarray]:
        """Return the latest frame (BGR format) or None."""
        with self._lock:
            if self._current_frame is None:
                return None
            return self._current_frame.copy()

    def get_status(self) -> dict:
        """Return camera health and performance metrics."""
        return {
            "connected": self._is_connected,
            "backend": self.camera_type,
            "resolution": f"{self.target_width}x{self.target_height}",
            "fps_actual": round(self._fps_actual, 1),
            "target_fps": self.target_fps,
            "total_frames": self._frame_count,
        }

    # --------------------------------------------------------------------------
    # Internal Capture Loop & Backend Drivers
    # --------------------------------------------------------------------------

    def _capture_loop(self):
        fps_start_time = time.time()
        frames_in_second = 0

        while self._running:
            if not self._is_connected:
                success = self._init_backend()
                if not success:
                    time.sleep(config.CAMERA_RECONNECT_DELAY)
                    continue

            frame = self._read_frame()
            if frame is None:
                LOGGER.warning("Camera read failed, attempting reconnect...")
                self._is_connected = False
                self._release_backend()
                time.sleep(1.0)
                continue

            # Update frame thread-safely
            with self._lock:
                self._current_frame = frame
                self._last_frame_time = time.time()

            self._frame_count += 1
            frames_in_second += 1

            # Update FPS metric every second
            now = time.time()
            if now - fps_start_time >= 1.0:
                self._fps_actual = frames_in_second / (now - fps_start_time)
                frames_in_second = 0
                fps_start_time = now

            # Pacing delay to maintain target FPS
            delay = max(0.001, (1.0 / self.target_fps) - 0.005)
            time.sleep(delay)

    def _init_backend(self) -> bool:
        """Initialize the selected camera hardware backend."""
        try:
            if self.camera_type == "picamera2":
                return self._init_picam2()
            elif self.camera_type in ("v4l2", "usb"):
                return self._init_v4l2()
            elif self.camera_type == "stream":
                return self._init_stream()
            else:
                # Test/synthetic mode
                self._is_connected = True
                LOGGER.info("Using Synthetic Test Camera Mode")
                return True
        except Exception as exc:
            LOGGER.error("Failed to initialize camera backend %s: %s", self.camera_type, exc)
            self._is_connected = False
            return False

    def _init_v4l2(self) -> bool:
        LOGGER.info("Initializing V4L2 USB camera index %d...", self.camera_index)
        cap = cv2.VideoCapture(self.camera_index, cv2.CAP_V4L2)
        if not cap.isOpened():
            # Fallback to default backend
            cap = cv2.VideoCapture(self.camera_index)
        if not cap.isOpened():
            LOGGER.error("Could not open V4L2 camera at index %d", self.camera_index)
            return False

        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.target_width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.target_height)
        cap.set(cv2.CAP_PROP_FPS, self.target_fps)
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # Minimize latency

        self._cap = cap
        self._is_connected = True
        LOGGER.info("V4L2 Camera connected successfully.")
        return True

    def _init_picam2(self) -> bool:
        try:
            # The package is named ``picamera2`` on Raspberry Pi OS.
            from picamera2 import Picamera2  # type: ignore
            LOGGER.info("Initializing Picamera2 for Raspberry Pi 5 CSI camera...")
            picam2 = Picamera2()
            config_picam = picam2.create_video_configuration(
                main={"size": (self.target_width, self.target_height), "format": "RGB888"}
            )
            picam2.configure(config_picam)
            picam2.start()
            self._picam2 = picam2
            self._is_connected = True
            LOGGER.info("Picamera2 started successfully.")
            return True
        except ImportError:
            LOGGER.warning("Picamera2 library not found. Falling back to V4L2 USB camera.")
            self.camera_type = "v4l2"
            return self._init_v4l2()
        except Exception as exc:
            LOGGER.error("Picamera2 init error: %s", exc)
            return False

    def _init_stream(self) -> bool:
        if not self.stream_url:
            LOGGER.error("STREAM_URL is empty for camera_type 'stream'")
            return False
        LOGGER.info("Connecting to RTSP/HTTP stream: %s", self.stream_url)
        cap = cv2.VideoCapture(self.stream_url)
        if not cap.isOpened():
            LOGGER.error("Failed to connect to stream: %s", self.stream_url)
            return False
        self._cap = cap
        self._is_connected = True
        return True

    def _read_frame(self) -> Optional[np.ndarray]:
        if self.camera_type == "picamera2" and self._picam2:
            try:
                frame_rgb = self._picam2.capture_array()
                return cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)
            except Exception as exc:
                LOGGER.error("Picamera2 capture error: %s", exc)
                return None

        if self._cap:
            ret, frame = self._cap.read()
            if not ret or frame is None:
                return None
            return frame

        # Synthetic generator
        return self._generate_synthetic_frame()

    def _generate_synthetic_frame(self) -> np.ndarray:
        """Generate a realistic test frame simulating civic road/urban feed."""
        h, w = self.target_height, self.target_width
        frame = np.zeros((h, w, 3), dtype=np.uint8)

        # Sky background gradient
        for y in range(int(h * 0.45)):
            c = int(180 - (y / (h * 0.45)) * 40)
            frame[y, :] = (c + 30, c + 10, c - 20)

        # Road surface
        frame[int(h * 0.45):, :] = (70, 70, 75)

        # Road lanes
        lane_w = int(w * 0.02)
        center_x = w // 2
        t = time.time()
        dash_offset = int((t * 200) % 100)

        for y in range(int(h * 0.45), h, 80):
            dash_y = (y + dash_offset) % (h - int(h * 0.45)) + int(h * 0.45)
            if dash_y + 40 < h:
                cv2.rectangle(frame, (center_x - lane_w // 2, dash_y), (center_x + lane_w // 2, dash_y + 40), (220, 220, 220), -1)

        # Side curbs
        cv2.rectangle(frame, (0, int(h * 0.45)), (int(w * 0.15), h), (90, 110, 90), -1)
        cv2.rectangle(frame, (int(w * 0.85), int(h * 0.45)), (w, h), (90, 110, 90), -1)

        # Periodic simulated pothole / garbage for live testing
        cycle = int(t) % 15
        if cycle < 8:
            # Simulated pothole
            pot_cx, pot_cy = int(w * 0.42), int(h * 0.72)
            cv2.ellipse(frame, (pot_cx, pot_cy), (70, 35), 15, 0, 360, (25, 25, 30), -1)
            cv2.ellipse(frame, (pot_cx, pot_cy), (60, 28), 15, 0, 360, (15, 15, 20), -1)
            cv2.putText(frame, "SIMULATED POTHOLE", (pot_cx - 80, pot_cy - 45), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 165, 255), 1)

        # Timestamp & Simulation watermark
        time_str = time.strftime("%Y-%m-%d %H:%M:%S")
        cv2.putText(frame, f"SafeLive RPi5 Camera Feed | {time_str}", (20, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        cv2.putText(frame, f"Device: {config.DEVICE_ID} | Mode: {self.camera_type.upper()}", (20, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 200), 1)

        return frame

    def _release_backend(self):
        if self._cap:
            try:
                self._cap.release()
            except Exception:
                pass
            self._cap = None
        if self._picam2:
            try:
                self._picam2.stop()
            except Exception:
                pass
            self._picam2 = None
        self._is_connected = False
