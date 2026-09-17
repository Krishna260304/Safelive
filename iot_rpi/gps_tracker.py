"""
SafeLive RPi 5 Edge Device - GPS Tracker Subsystem
==================================================
Threaded serial GPS receiver supporting:
- Standard NMEA 0183 ($GPGGA, $GNGGA, $GPRMC, $GPVTG)
- u-blox NEO-6M / NEO-8M / NEO-M9N / generic USB GPS dongles
- Fallback simulation / drift generator when indoors or testing
"""

import time
import math
import logging
import threading
from dataclasses import dataclass
from typing import Optional, Tuple
from config import config

LOGGER = logging.getLogger("safelive.gps")

try:
    import serial  # type: ignore
except ImportError:
    serial = None

try:
    import pynmea2  # type: ignore
except ImportError:
    pynmea2 = None


@dataclass
class GPSData:
    latitude: float = 0.0
    longitude: float = 0.0
    altitude_m: float = 0.0
    speed_kmh: float = 0.0
    heading_deg: float = 0.0
    satellites: int = 0
    hdop: float = 99.9  # Horizontal dilution of precision (<2.0 is good)
    fix_quality: int = 0  # 0=no fix, 1=GPS fix, 2=DGPS fix
    is_valid: bool = False
    timestamp: float = 0.0
    source: str = "none"  # 'hardware', 'simulated', 'fallback'


class GPSTracker:
    """Threaded GPS manager providing real-time location telemetry."""

    def __init__(self):
        self.port = config.GPS_PORT
        self.baudrate = config.GPS_BAUDRATE
        self.timeout = config.GPS_TIMEOUT
        self.mock_fallback = config.GPS_MOCK_FALLBACK

        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._current_gps = GPSData(
            latitude=config.DEFAULT_LAT,
            longitude=config.DEFAULT_LON,
            is_valid=False,
            source="init"
        )
        self._sim_lat = config.DEFAULT_LAT
        self._sim_lon = config.DEFAULT_LON
        self._sim_heading = 45.0
        self._sim_speed = 32.0  # km/h

    def start(self) -> bool:
        """Start the GPS background worker thread."""
        if self._running:
            return True
        self._running = True
        self._thread = threading.Thread(target=self._worker_loop, name="GPSWorker", daemon=True)
        self._thread.start()
        LOGGER.info("GPS background tracker started (Port: %s, Baud: %d)", self.port, self.baudrate)
        return True

    def stop(self):
        """Stop GPS tracking thread."""
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        LOGGER.info("GPS background tracker stopped.")

    def get_coordinates(self) -> Tuple[float, float]:
        """Return (latitude, longitude)."""
        with self._lock:
            return self._current_gps.latitude, self._current_gps.longitude

    def get_telemetry(self) -> dict:
        """Return full GPS telemetry object."""
        with self._lock:
            return {
                "latitude": round(self._current_gps.latitude, 7),
                "longitude": round(self._current_gps.longitude, 7),
                "altitude_m": round(self._current_gps.altitude_m, 1),
                "speed_kmh": round(self._current_gps.speed_kmh, 1),
                "heading_deg": round(self._current_gps.heading_deg, 1),
                "satellites": self._current_gps.satellites,
                "hdop": round(self._current_gps.hdop, 2),
                "fix_quality": self._current_gps.fix_quality,
                "has_fix": self._current_gps.is_valid,
                "source": self._current_gps.source,
                "timestamp": self._current_gps.timestamp or time.time(),
            }

    # --------------------------------------------------------------------------
    # Distance Calculations (Haversine Formula)
    # --------------------------------------------------------------------------
    @staticmethod
    def calculate_distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Calculate great-circle distance between two GPS coordinates in meters."""
        r = 6371000.0  # Earth radius in meters
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        delta_phi = math.radians(lat2 - lat1)
        delta_lambda = math.radians(lon2 - lon1)

        a = math.sin(delta_phi / 2.0) ** 2 + \
            math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
        c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
        return r * c

    # --------------------------------------------------------------------------
    # Background Serial Loop & NMEA Parser
    # --------------------------------------------------------------------------
    def _worker_loop(self):
        ser = None
        consecutive_errors = 0

        while self._running:
            if serial is None:
                LOGGER.debug("pyserial not available; entering GPS simulation mode")
                time.sleep(1.0)
                continue

            # Try to connect to serial port
            if ser is None:
                try:
                    ser = serial.Serial(self.port, baudrate=self.baudrate, timeout=self.timeout)
                    LOGGER.info("Connected to GPS hardware at %s", self.port)
                    consecutive_errors = 0
                except Exception as exc:
                    consecutive_errors += 1
                    if consecutive_errors % 10 == 1:
                        LOGGER.warning("Could not open GPS serial port %s: %s", self.port, exc)
                    time.sleep(1.5)
                    continue

            # Read NMEA sentence
            try:
                line_bytes = ser.readline()
                if not line_bytes:
                    time.sleep(0.1)
                    continue

                line = line_bytes.decode("ascii", errors="replace").strip()
                if not line.startswith("$"):
                    continue

                parsed = self._parse_nmea_sentence(line)
                if parsed:
                    with self._lock:
                        self._current_gps = parsed

            except Exception as exc:
                LOGGER.warning("GPS read error: %s", exc)
                try:
                    ser.close()
                except Exception:
                    pass
                ser = None
                time.sleep(1.0)

        if ser:
            try:
                ser.close()
            except Exception:
                pass

    def _parse_nmea_sentence(self, line: str) -> Optional[GPSData]:
        """Parse NMEA sentence using pynmea2 or custom parser."""
        if pynmea2 is not None:
            try:
                msg = pynmea2.parse(line)
                if hasattr(msg, "latitude") and hasattr(msg, "longitude"):
                    lat = float(msg.latitude)
                    lon = float(msg.longitude)
                    # Skip 0,0 fixes
                    if abs(lat) < 0.0001 and abs(lon) < 0.0001:
                        return None

                    sats = getattr(msg, "num_sats", 0)
                    try:
                        sats = int(sats) if sats else 0
                    except Exception:
                        sats = 0

                    hdop = getattr(msg, "horizontal_dil", 99.9)
                    try:
                        hdop = float(hdop) if hdop else 99.9
                    except Exception:
                        hdop = 99.9

                    alt = getattr(msg, "altitude", 0.0)
                    try:
                        alt = float(alt) if alt else 0.0
                    except Exception:
                        alt = 0.0

                    fix = getattr(msg, "gps_qual", 1)
                    try:
                        fix = int(fix) if fix else 1
                    except Exception:
                        fix = 1

                    return GPSData(
                        latitude=lat,
                        longitude=lon,
                        altitude_m=alt,
                        speed_kmh=self._current_gps.speed_kmh,
                        heading_deg=self._current_gps.heading_deg,
                        satellites=sats or 8,
                        hdop=hdop,
                        fix_quality=fix,
                        is_valid=True,
                        timestamp=time.time(),
                        source="hardware"
                    )
            except Exception:
                pass

        # Native fallback parser for $GPGGA / $GNGGA
        if line.startswith(("$GPGGA", "$GNGGA")):
            parts = line.split(",")
            if len(parts) >= 10:
                try:
                    raw_lat = parts[2]
                    lat_dir = parts[3]
                    raw_lon = parts[4]
                    lon_dir = parts[5]
                    qual = int(parts[6] or 0)
                    sats = int(parts[7] or 0)

                    if raw_lat and raw_lon and qual > 0:
                        lat_deg = float(raw_lat[:2]) + float(raw_lat[2:]) / 60.0
                        if lat_dir == "S":
                            lat_deg = -lat_deg

                        lon_deg = float(raw_lon[:3]) + float(raw_lon[3:]) / 60.0
                        if lon_dir == "W":
                            lon_deg = -lon_deg

                        return GPSData(
                            latitude=lat_deg,
                            longitude=lon_deg,
                            satellites=sats,
                            fix_quality=qual,
                            is_valid=True,
                            timestamp=time.time(),
                            source="hardware"
                        )
                except Exception:
                    pass

        return None
