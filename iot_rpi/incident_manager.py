"""
SafeLive RPi 5 Edge Device - Incident Manager & Server Dispatcher
================================================================
Responsibilities:
1. Spatial & Temporal Debouncing (anti-spam filter)
2. Incident packaging (YOLO detections + GPS telemetry + base64 annotated image)
3. Offline SQLite cache & auto-retry background worker
4. Central server dispatch (POST /api/iot/incidents)
"""

import os
import time
import json
import base64
import sqlite3
import logging
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple
import requests
import cv2
import numpy as np

from config import config
from detector import DetectedIssue
from gps_tracker import GPSTracker

LOGGER = logging.getLogger("safelive.incidents")


class IncidentManager:
    """Manages civic incident detection verification, debouncing, caching, and server transmission."""

    def __init__(self, gps_tracker: GPSTracker):
        self.gps = gps_tracker
        self.db_path = config.LOCAL_STORAGE_DIR / "incidents_cache.db"
        self.snapshots_dir = config.LOCAL_STORAGE_DIR / "snapshots"

        self._lock = threading.Lock()
        self._recent_reports: List[Dict[str, Any]] = []  # In-memory debounce history
        self._recent_incidents: List[Dict[str, Any]] = []  # For local UI display
        self._running = False
        self._sync_thread: Optional[threading.Thread] = None

        self._total_incidents_recorded = 0
        self._total_incidents_synced = 0
        self._total_sync_failures = 0
        self._last_sync_time: Optional[float] = None
        self._server_reachable = True

        self._init_db()

    def start(self):
        """Start the background sync worker."""
        if self._running:
            return
        self._running = True
        self._sync_thread = threading.Thread(target=self._sync_worker_loop, name="IncidentSyncWorker", daemon=True)
        self._sync_thread.start()
        LOGGER.info("Incident Manager & Server Sync worker started.")

    def stop(self):
        """Stop background worker."""
        self._running = False
        if self._sync_thread and self._sync_thread.is_alive():
            self._sync_thread.join(timeout=2.0)
        LOGGER.info("Incident Manager stopped.")

    # --------------------------------------------------------------------------
    # Database Initialization (SQLite)
    # --------------------------------------------------------------------------
    def _init_db(self):
        """Initialize local SQLite store for offline caching."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS queued_incidents (
                    event_id TEXT PRIMARY KEY,
                    category TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL,
                    department TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    confidence REAL NOT NULL,
                    latitude REAL NOT NULL,
                    longitude REAL NOT NULL,
                    captured_at TEXT NOT NULL,
                    image_path TEXT,
                    payload_json TEXT NOT NULL,
                    status TEXT DEFAULT 'pending',
                    retry_count INTEGER DEFAULT 0,
                    created_timestamp REAL NOT NULL
                )
            """)
            conn.commit()

    # --------------------------------------------------------------------------
    # Core Incident Processing & Debounce Logic
    # --------------------------------------------------------------------------
    def process_detection(
        self,
        issue: DetectedIssue,
        annotated_frame: np.ndarray,
        raw_frame: Optional[np.ndarray] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Evaluate if detected issue passes debounce and should be recorded/sent.
        Returns the incident record if accepted, or None if debounced.
        """
        if not self.gps.get_telemetry().get("has_fix", False):
            LOGGER.debug("Skipping incident without a live GPS fix")
            return None
        lat, lon = self.gps.get_coordinates()
        now = time.time()

        severity_rank = {"low": 0, "medium": 1, "high": 2, "critical": 3}
        if severity_rank.get(issue.severity, 0) < severity_rank.get(config.MIN_SEVERITY, 1):
            LOGGER.debug("Skipping %s incident below MIN_SEVERITY=%s", issue.category, config.MIN_SEVERITY)
            return None

        # Check debounce against recent reports
        if not self._passes_debounce(issue.category, lat, lon, now):
            LOGGER.debug("Debounced duplicate incident: %s at (%f, %f)", issue.category, lat, lon)
            return None

        # Build unique event ID
        event_id = f"evt_{int(now)}_{uuid.uuid4().hex[:8]}"
        captured_at_iso = datetime.now(timezone.utc).isoformat()

        # Save snapshot image to local disk
        snapshot_filename = f"{event_id}_{issue.category}.jpg"
        snapshot_path = self.snapshots_dir / snapshot_filename
        if not cv2.imwrite(str(snapshot_path), annotated_frame, [cv2.IMWRITE_JPEG_QUALITY, 85]):
            LOGGER.warning("Could not save incident snapshot: %s", snapshot_path)

        # Encode image to Base64 for API transmission
        encoded, buffer = cv2.imencode(".jpg", annotated_frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if not encoded:
            LOGGER.error("Could not encode incident snapshot for event %s", event_id)
            return None
        img_base64 = base64.b64encode(buffer).decode("utf-8")

        # Prepare backend-compliant payload (IssueIn schema)
        payload = {
            "description": f"{issue.title}: {issue.description}",
            "latitude": float(lat),
            "longitude": float(lon),
            "image": img_base64,
            "severity": issue.severity,
            "deviceId": config.DEVICE_ID,
            "source": config.SOURCE,
            "scope": config.SCOPE,
            "category": issue.category,
            "location": f"GPS: {lat:.6f}, {lon:.6f}",
            "eventId": event_id,
            "sensorType": "yolov8-camera-gps",
            "confidence": float(round(issue.confidence, 3)),
            "capturedAt": captured_at_iso,
            "reportedBy": f"EdgeAI-{config.DEVICE_ID}",
            "metadata": {
                "department": issue.department,
                "bbox": list(issue.bbox),
                "area_ratio": round(issue.area_ratio, 4),
                "device_name": config.DEVICE_NAME,
                "gps_telemetry": self.gps.get_telemetry(),
            }
        }

        # Store in local DB queue
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO queued_incidents (
                    event_id, category, title, description, department,
                    severity, confidence, latitude, longitude, captured_at,
                    image_path, payload_json, status, retry_count, created_timestamp
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)
            """, (
                event_id, issue.category, issue.title, issue.description, issue.department,
                issue.severity, issue.confidence, lat, lon, captured_at_iso,
                str(snapshot_path), json.dumps(payload), now
            ))
            conn.commit()

        # Update in-memory debounce tracking
        with self._lock:
            self._recent_reports.append({
                "category": issue.category,
                "lat": lat,
                "lon": lon,
                "time": now,
            })
            # Keep debounce window clean (older than 10 minutes pruned)
            self._recent_reports = [r for r in self._recent_reports if now - r["time"] < 600]

            incident_summary = {
                "event_id": event_id,
                "category": issue.category,
                "title": issue.title,
                "description": issue.description,
                "department": issue.department,
                "severity": issue.severity,
                "confidence": issue.confidence,
                "latitude": lat,
                "longitude": lon,
                "captured_at": captured_at_iso,
                "snapshot_url": f"/api/snapshots/{snapshot_filename}",
                "status": "pending",
                "timestamp": now,
            }
            self._recent_incidents.insert(0, incident_summary)
            if len(self._recent_incidents) > 50:
                self._recent_incidents.pop()

            self._total_incidents_recorded += 1

        LOGGER.info(
            "📍 Incident Recorded! [%s] %s | Lat: %.5f, Lon: %.5f | Conf: %.1f%%",
            issue.severity.upper(), issue.title, lat, lon, issue.confidence * 100
        )

        return incident_summary

    def _passes_debounce(self, category: str, lat: float, lon: float, current_time: float) -> bool:
        """Check if identical category was reported within radius or cooldown duration."""
        # The in-memory list is fast, but is lost on a reboot. Consult the durable
        # queue as well so a restarted Pi cannot emit the same observation again.
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                """SELECT latitude, longitude, created_timestamp
                   FROM queued_incidents
                   WHERE category = ? AND status IN ('pending', 'synced')
                     AND created_timestamp >= ?
                   ORDER BY created_timestamp DESC LIMIT 100""",
                (category, current_time - config.COOLDOWN_SECONDS),
            ).fetchall()
        for previous_lat, previous_lon, previous_time in rows:
            if GPSTracker.calculate_distance_meters(lat, lon, previous_lat, previous_lon) < config.DISTANCE_DEBOUNCE_METERS:
                return False

        with self._lock:
            for rep in self._recent_reports:
                if rep["category"] == category:
                    time_diff = current_time - rep["time"]
                    if time_diff < config.COOLDOWN_SECONDS:
                        dist_m = GPSTracker.calculate_distance_meters(lat, lon, rep["lat"], rep["lon"])
                        if dist_m < config.DISTANCE_DEBOUNCE_METERS:
                            return False
        return True

    # --------------------------------------------------------------------------
    # Background Server Dispatch Loop
    # --------------------------------------------------------------------------
    def _sync_worker_loop(self):
        """Worker thread that continuously syncs queued incidents to central Safelive server."""
        while self._running:
            if not config.SERVER_SYNC_ENABLED:
                time.sleep(3.0)
                continue

            try:
                self._dispatch_pending_incidents()
            except Exception as exc:
                LOGGER.error("Sync worker exception: %s", exc)

            time.sleep(2.0)

    def _dispatch_pending_incidents(self):
        """Fetch pending incidents from SQLite and transmit to server."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT event_id, payload_json, retry_count 
                FROM queued_incidents 
                WHERE status = 'pending' 
                ORDER BY created_timestamp ASC 
                LIMIT 5
            """)
            rows = cursor.fetchall()

        if not rows:
            return

        headers = {
            "Content-Type": "application/json",
            "User-Agent": f"SafeLive-Edge-RPi5/{config.DEVICE_ID}",
        }
        if config.IOT_API_KEY:
            headers["X-IoT-Api-Key"] = config.IOT_API_KEY
            headers["X-API-Key"] = config.IOT_API_KEY

        for event_id, payload_json, retry_count in rows:
            if not self._running:
                break

            try:
                payload = json.loads(payload_json)
                LOGGER.info("Dispatching incident %s to %s...", event_id, config.SERVER_URL)

                response = requests.post(
                    config.SERVER_URL,
                    json=payload,
                    headers=headers,
                    timeout=config.SERVER_TIMEOUT_SECONDS
                )

                if response.status_code in (200, 201, 202):
                    LOGGER.info("✅ Incident %s successfully synced to Safelive central server!", event_id)
                    self._update_incident_status(event_id, "synced")
                    self._server_reachable = True
                    self._total_incidents_synced += 1
                    self._last_sync_time = time.time()
                elif response.status_code in (400, 422):
                    # Unrecoverable validation error
                    LOGGER.error("Server rejected incident %s (HTTP %d): %s", event_id, response.status_code, response.text)
                    self._update_incident_status(event_id, "rejected")
                else:
                    LOGGER.warning("Server returned HTTP %d for %s: %s", response.status_code, event_id, response.text)
                    self._handle_retry(event_id, retry_count + 1)
                    self._total_sync_failures += 1

            except (requests.ConnectionError, requests.Timeout) as exc:
                LOGGER.warning("Network connection failed while syncing incident %s: %s (will retry offline)", event_id, exc)
                self._server_reachable = False
                self._handle_retry(event_id, retry_count + 1)
                self._total_sync_failures += 1
                time.sleep(3.0)  # Back off before trying next

            except Exception as exc:
                LOGGER.error("Unexpected error dispatching incident %s: %s", event_id, exc)
                self._handle_retry(event_id, retry_count + 1)
                self._total_sync_failures += 1

    def _update_incident_status(self, event_id: str, new_status: str):
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE queued_incidents SET status = ? WHERE event_id = ?", (new_status, event_id))
            conn.commit()

        # Update in-memory cache
        with self._lock:
            for inc in self._recent_incidents:
                if inc["event_id"] == event_id:
                    inc["status"] = new_status
                    break

    def _handle_retry(self, event_id: str, new_retry_count: int):
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            if new_retry_count >= config.MAX_RETRIES * 5:
                cursor.execute("UPDATE queued_incidents SET retry_count = ?, status = 'failed' WHERE event_id = ?", (new_retry_count, event_id))
            else:
                cursor.execute("UPDATE queued_incidents SET retry_count = ? WHERE event_id = ?", (new_retry_count, event_id))
            conn.commit()

    def get_recent_incidents(self, limit: int = 20) -> List[Dict[str, Any]]:
        """Return recently recorded incidents."""
        with self._lock:
            return list(self._recent_incidents[:limit])

    def get_queue_stats(self) -> dict:
        """Return queue statistics."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM queued_incidents WHERE status = 'pending'")
            pending_count = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM queued_incidents WHERE status = 'synced'")
            synced_count = cursor.fetchone()[0]

        return {
            "pending_in_queue": pending_count,
            "synced_to_server": synced_count,
            "total_recorded": self._total_incidents_recorded,
            "sync_failures": self._total_sync_failures,
            "server_reachable": self._server_reachable,
            "last_sync_time": self._last_sync_time,
            "sync_enabled": config.SERVER_SYNC_ENABLED,
            "server_url": config.SERVER_URL,
        }
