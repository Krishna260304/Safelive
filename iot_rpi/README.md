# SafeLive RPi 5 IoT Edge Device
> **Autonomous Real-Time Civic Incident Detection & Field Inspection Unit**

An edge-AI hardware subsystem for the **SafeLive Smart City Platform**, running on **Raspberry Pi 5**. It inspects municipal infrastructure from vehicle-mounted camera feeds, identifies civic hazards in real-time with YOLOv8, cross-references with precision GPS telemetry, debounces duplicates, transmits verified incident reports to the central cloud server, and serves a local high-speed Wi-Fi portal for on-site Field Inspectors.

---

## 🌟 Key Architecture & Capabilities

```
+-----------------------------------------------------------------------------------------+
|                                  Raspberry Pi 5 Unit                                    |
|                                                                                         |
|  [ Camera Feed ]     [ Serial GPS ]                                                     |
|  (USB / Picamera2)   (NEO-6M / USB)                                                     |
|        |                  |                                                             |
|        v                  v                                                             |
|  +------------+     +------------+                                                      |
|  | Camera     |     | GPS        |                                                      |
|  | Streamer   |     | Tracker    |                                                      |
|  +-----+------+     +-----+------+                                                      |
|        |                  |                                                             |
|        v                  |                                                             |
|  +--------------------+   |                                                             |
|  | YOLOv8 Civic       |   |                                                             |
|  | Detection Engine   |   |                                                             |
|  +---------+----------+   |                                                             |
|            |              |                                                             |
|            +-------+------+                                                             |
|                    |                                                                    |
|                    v                                                                    |
|       +----------------------------+                                                    |
|       | Incident Manager           |                                                    |
|       | - Anti-Spam Debounce       |                                                    |
|       | - Offline SQLite Buffer    |                                                    |
|       +----+------------------+----+                                                    |
|            |                  |                                                         |
|            v                  v                                                         |
|    [ Only Detected ]   [ Local Web Server (0.0.0.0:8080) ]                              |
|    [   Incidents   ]   [ (Direct Wi-Fi Hotspot for Field Inspector) ]                   |
|            |                  |                                                         |
+------------|------------------|---------------------------------------------------------+
             |                  |
             v                  v
    +-----------------+  +-------------------------------+
    | SafeLive Server |  | Field Inspector Portal (WiFi) |
    | POST /api/iot   |  | - Real-time Annotated Video   |
    | /incidents      |  | - Live GPS Map HUD            |
    +-----------------+  | - Password-Protected Pairing  |
                         +-------------------------------+
```

1. **Edge AI Civic Incident Detection**:
   - Runs YOLOv8 with civic model mappings (`pothole`, `garbage`, `water_leak`, `damaged_pole`, `street_light`, `debris`).
   - Dynamic Severity Assignment (`critical`, `high`, `medium`, `low`) calculated using bounding box area and model confidence.
   - Annotates frames with high-visibility HUD bounding boxes and GPS telemetry.

2. **Smart Bandwidth Conservation**:
   - **Continuous live video stays strictly local on the device** (accessible over Wi-Fi by field officers).
   - Only **verified incidents** exceeding confidence thresholds are packaged and sent to the central server.
   - **Spatial & Temporal Debouncing**: Prevents duplicate reports of the same pothole/garbage pile within a 30-meter radius or 45-second cooldown window.

3. **GPS Telemetry & Offline Resilience**:
   - Reads NMEA sentences (`$GNGGA`, `$GPGGA`, `$GPRMC`) from NEO-6M / NEO-8M / USB GPS modules at 9600 baud.
   - Offline SQLite buffer (`data/incidents_cache.db`): Incidents detected during cellular blackouts are queued and automatically synced when reconnected.

4. **Field Inspector Local Wi-Fi Pairing**:
   - Built-in FastAPI server (`http://192.168.4.1:8080`).
   - Field Inspector connects to the device's Wi-Fi hotspot (`SafeLive-RPi5-XXXX`), enters the device password, and views:
     - Real-time video stream with live bounding boxes.
     - Live GPS map coordinates, heading, and speed.
     - Edge telemetry (CPU temperature, RAM, GPS fix, Satellites).
     - Recent on-device incident sync logs.
     - Device configuration sliders (confidence threshold, cooldown interval, server URL).

---

## 🔌 Hardware Wiring & Setup

| Module | RPi 5 Pin / Interface | Description |
| :--- | :--- | :--- |
| **USB Webcam** or **Pi Camera V3** | USB 3.0 Port or CAM/DISP0 CSI | Front-facing vehicle mount |
| **u-blox NEO-6M / NEO-8M GPS** | USB-to-UART Dongle or GPIO 14/15 | Serial GPS (Tx -> Rx, Rx -> Tx, VCC 5V/3.3V, GND) |
| **Power Supply** | USB-C 5V / 5A | Official RPi 27W USB-C or Car 12V-to-5V Stepdown |

---

## 🚀 1-Click Installation on Raspberry Pi 5

```bash
# Copy this folder to your Raspberry Pi 5 (the trained model is included in `models/best.pt`)
cd iot_rpi

# Make setup scripts executable
chmod +x setup_rpi5.sh setup_ap.sh

# Run automated setup
./setup_rpi5.sh
```

---

## 📡 Wi-Fi Access Point (Hotspot) Setup

To allow Field Inspectors to connect directly in the field without an external router:

```bash
# Syntax: ./setup_ap.sh <SSID> <PASSWORD>
sudo ./setup_ap.sh SafeLive-RPi5-01 safelive2026
```

This creates a Wi-Fi network `SafeLive-RPi5-01` with IP `192.168.4.1`.

---

## ⚙️ Configuration (.env)

Edit `.env` to match your deployment:

```ini
DEVICE_ID=rpi5-safelive-unit-01
DEVICE_NAME="SafeLive RPi 5 Patrol Unit #1"
DEVICE_PASSWORD=safelive2026
SERVER_URL=https://safelive.in/api/iot/incidents
CAMERA_TYPE=v4l2          # 'v4l2', 'picamera2', 'stream', or 'test'
GPS_PORT=/dev/ttyUSB0     # Serial port for GPS
CONFIDENCE_THRESHOLD=0.45 # Minimum detection confidence
COOLDOWN_SECONDS=45.0     # Anti-spam cooldown
```

The supplied `models/best.pt` is the trained SafeLive checkpoint. Keep the
`YOLO_MODEL_PATH=models/best.pt` setting unless you intentionally replace it.

The default Pi 5 profile captures at 640×360 and performs up to 2 AI inferences
per second. This keeps the 8 GB unit responsive and leaves headroom for the
local API, GPS, and offline queue. You can raise `INFERENCE_FPS_LIMIT` after
checking CPU temperature and inference latency on the vehicle.

---

## 🧪 Running & Testing

### Test in Terminal:
```bash
source venv/bin/activate
python3 main.py
```

### Systemd Service Commands:
```bash
sudo systemctl start safelive-edge    # Start background service
sudo systemctl status safelive-edge   # Check status
journalctl -u safelive-edge -f        # View live logs
sudo systemctl restart safelive-edge  # Restart service
```

---

## 🌐 Local API Endpoints

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `POST /api/auth` | POST | Authenticate Field Inspector with device password |
| `GET /api/status` | GET | Real-time hardware, GPS, camera, and ML telemetry |
| `GET /api/stream/mjpeg` | GET | Live MJPEG video stream with YOLO bounding boxes |
| `GET /api/incidents` | GET | List recent edge-detected civic incidents |
| `GET /api/snapshots/{file}` | GET | Retrieve captured incident snapshot |
| `GET/POST /api/config` | GET/POST | Read/Update runtime edge parameters |
| `POST /api/trigger` | POST | Manual on-site incident report |
| `WS /ws/live` | WS | Real-time WebSocket telemetry stream |
