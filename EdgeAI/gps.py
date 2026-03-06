import serial
import pynmea2

def get_coordinates():

    port = "/dev/ttyUSB0"
    ser = serial.Serial(port, baudrate=9600, timeout=1)

    while True:
        line = ser.readline().decode('ascii', errors='replace')
        if line.startswith('$GPGGA'):
            msg = pynmea2.parse(line)
            lat = msg.latitude
            lon = msg.longitude
            return lat, lon
