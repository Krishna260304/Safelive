import cv2

def capture_frame():

    cap = cv2.VideoCapture(0)

    if not cap.isOpened():
        return None

    ret, frame = cap.read()
    cap.release()

    if not ret:
        return None

    return frame
