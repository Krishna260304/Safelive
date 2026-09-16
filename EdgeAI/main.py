import time
from camera import capture_frame
from gps import get_coordinates
from detector import detect_issue
from sender import send_issue

while True:

    frame = capture_frame()
    lat, lon = get_coordinates()

    issue, desc = detect_issue(frame)

    if issue:
        send_issue(frame, desc, lat, lon)

    time.sleep(5)
