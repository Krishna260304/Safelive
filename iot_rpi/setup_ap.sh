#!/usr/bin/env bash
# ==============================================================================
# SafeLive RPi 5 - Wi-Fi Hotspot Setup (Access Point Mode)
# ==============================================================================
# Turns the Raspberry Pi 5 into a Wi-Fi Access Point so Field Inspectors can
# connect their phones/laptops directly in the field without any external router.
# ==============================================================================

set -e

SSID_NAME="${1:-SafeLive-RPi5-01}"
WIFI_PASS="${2:-safelive2026}"
AP_INTERFACE="wlan0"

echo "=================================================================="
echo " 📡 Configuring SafeLive Wi-Fi Access Point on Raspberry Pi 5"
echo "    SSID     : $SSID_NAME"
echo "    Password : $WIFI_PASS"
echo "    IP       : 192.168.4.1"
echo "=================================================================="

# Check if NetworkManager is available (default on RPi OS Bookworm)
if command -v nmcli &> /dev/null; then
    echo "Using NetworkManager (nmcli)..."
    
    # Delete existing connection if exists
    sudo nmcli connection delete "$SSID_NAME" 2>/dev/null || true
    
    # Create Hotspot connection
    sudo nmcli connection add \
        type wifi \
        ifname "$AP_INTERFACE" \
        con-name "$SSID_NAME" \
        autoconnect yes \
        ssid "$SSID_NAME"
        
    sudo nmcli connection modify "$SSID_NAME" 802-11-wireless.mode ap 802-11-wireless.band bg
    sudo nmcli connection modify "$SSID_NAME" 802-11-wireless-security.key-mgmt wpa-psk
    sudo nmcli connection modify "$SSID_NAME" 802-11-wireless-security.psk "$WIFI_PASS"
    sudo nmcli connection modify "$SSID_NAME" ipv4.method shared ipv4.addresses 192.168.4.1/24
    
    echo "Starting Wi-Fi Hotspot connection..."
    sudo nmcli connection up "$SSID_NAME"
    
    echo "✅ Wi-Fi Hotspot '$SSID_NAME' is now active!"
    echo "Field Inspectors can connect to '$SSID_NAME' and browse to http://192.168.4.1:8080"
else
    echo "NetworkManager not found. Installing hostapd and dnsmasq..."
    sudo apt-get update
    sudo apt-get install -y hostapd dnsmasq

    # Stop services while configuring
    sudo systemctl stop hostapd || true
    sudo systemctl stop dnsmasq || true

    # Configure static IP for wlan0 in dhcpcd.conf
    if [ -f /etc/dhcpcd.conf ]; then
        sudo bash -c "cat <<EOF >> /etc/dhcpcd.conf
interface wlan0
    static ip_address=192.168.4.1/24
    nohook wpa_supplicant
EOF"
    fi

    # Configure dnsmasq
    sudo bash -c "cat <<EOF > /etc/dnsmasq.d/safelive-ap.conf
interface=wlan0
dhcp-range=192.168.4.10,192.168.4.100,255.255.255.0,24h
EOF"

    # Configure hostapd
    sudo bash -c "cat <<EOF > /etc/hostapd/hostapd.conf
interface=wlan0
driver=nl80211
ssid=$SSID_NAME
hw_mode=g
channel=7
wmm_enabled=0
macaddr_acl=0
auth_algs=1
ignore_broadcast_ssid=0
wpa=2
wpa_passphrase=$WIFI_PASS
wpa_key_mgmt=WPA-PSK
wpa_pairwise=TKIP
rsn_pairwise=CCMP
EOF"

    sudo systemctl unmask hostapd
    sudo systemctl enable hostapd
    sudo systemctl restart hostapd
    sudo systemctl restart dnsmasq
    echo "✅ Hostapd Wi-Fi Hotspot is now active!"
fi
