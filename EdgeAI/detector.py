import logging
import os

from ultralytics import YOLO

LOGGER = logging.getLogger(__name__)

MODEL_PATH = os.getenv("YOLO_MODEL_PATH", "models/best.pt")
YOLO_DEVICE = os.getenv("YOLO_DEVICE", "auto").strip().lower()


def _resolve_yolo_device() -> str:
    if YOLO_DEVICE != "auto":
        return YOLO_DEVICE
    try:
        import torch  # type: ignore

        if torch.cuda.is_available():
            return "cuda:0"
    except Exception as exc:
        LOGGER.debug("Torch CUDA detection failed, falling back to CPU: %s", exc)
    return "cpu"


DETECTION_DEVICE = _resolve_yolo_device()
model = YOLO(MODEL_PATH)
try:
    model.to(DETECTION_DEVICE)
except Exception as exc:
    LOGGER.warning("Could not move YOLO model to %s: %s", DETECTION_DEVICE, exc)


def detect_issue(frame):
    results = model(frame, device=DETECTION_DEVICE, verbose=False)

    for r in results:
        if len(r.boxes) > 0:
            return True, "Garbage Overflow Detected"

    return False, "No Issue"
