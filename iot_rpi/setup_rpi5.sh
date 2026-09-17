#!/usr/bin/env bash
# ==============================================================================
# SafeLive RPi 5 Edge AI Setup Script
# For Raspberry Pi OS 64-bit (Debian Bookworm) / Ubuntu 22.04+
# ==============================================================================

set -e

echo "=================================================================="
echo " 🛠️  Installing SafeLive Edge AI Environment on Raspberry Pi 5"
echo "=================================================================="

# 1. Update system packages
echo "📦 Updating apt packages..."
sudo apt-get update -y
sudo apt-get install -y \
    python3-pip \
    python3-venv \
    python3-dev \
    libgl1 \
    libglib2.0-0 \
    libcap-dev \
    libcamera-dev \
    python3-picamera2 \
    v4l-utils \
    sqlite3 \
    git

# 2. Add user to dialout and video groups for serial GPS and camera access
echo "🔌 Setting up hardware permissions (video, dialout, tty)..."
sudo usermod -a -G dialout,video $USER || true

# 3. Create virtual environment
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -d "venv" ]; then
    echo "🐍 Creating Python virtual environment..."
    python3 -m venv venv --system-site-packages
fi

source venv/bin/activate

# 4. Install Python dependencies
echo "📥 Installing Python dependencies from requirements.txt..."
pip install --upgrade pip setuptools wheel
pip install -r requirements.txt

# 5. Create directories & copy .env if missing
mkdir -p data/snapshots models
if [ ! -f ".env" ]; then
    echo "📝 Generating .env configuration from template..."
    cp .env.example .env
fi

# 6. Download default YOLOv8 nano model if missing
if [ ! -f "models/yolov8n.pt" ]; then
    echo "🧠 Downloading default YOLOv8n base model..."
    python3 -c "from ultralytics import YOLO; YOLO('yolov8n.pt')" || true
    if [ -f "yolov8n.pt" ]; then
        cp yolov8n.pt models/yolov8n.pt
    fi
fi

# 7. Configure systemd service
SERVICE_PATH="/etc/systemd/system/safelive-edge.service"
echo "⚙️ Configuring systemd service at $SERVICE_PATH..."

sudo bash -c "cat <<EOF > $SERVICE_PATH
[Unit]
Description=SafeLive RPi 5 Civic Edge AI Service
After=network.target network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$SCRIPT_DIR
Environment=PYTHONUNBUFFERED=1
Environment=OMP_NUM_THREADS=4
Environment=OPENBLAS_NUM_THREADS=4
Environment=MKL_NUM_THREADS=4
ExecStart=$SCRIPT_DIR/venv/bin/python3 $SCRIPT_DIR/main.py
Nice=5
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF"

sudo systemctl daemon-reload
echo "=================================================================="
echo " ✅ Setup Complete!"
echo ""
echo "To start the SafeLive Edge Service immediately:"
echo "   sudo systemctl start safelive-edge"
echo ""
echo "To enable auto-start on boot:"
echo "   sudo systemctl enable safelive-edge"
echo ""
echo "To view live logs:"
echo "   journalctl -u safelive-edge -f"
echo ""
echo "To test run manually in terminal:"
echo "   source venv/bin/activate && python3 main.py"
echo "=================================================================="
