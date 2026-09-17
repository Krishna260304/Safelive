"""
SafeLive RPi 5 Edge Device - YOLOv8 Civic Incident Detector
===========================================================
Real-time object detection & civic issue classification engine.
Maps YOLOv8 predictions to municipal civic incident categories:
- Potholes & Road Damage (BBMP Roads)
- Garbage Overflow & Waste Dumping (BBMP Sanitation)
- Water Pipeline Leakage & Flooding (BWSSB)
- Damaged Electrical Poles & Dangling Wires (BESCOM)
- Broken Streetlights (BESCOM)
- Road Obstructions & Fallen Trees (Emergency/Forestry)
"""

import time
import logging
import os
import numpy as np
import cv2
from pathlib import Path
from dataclasses import dataclass, field
from typing import List, Optional, Tuple, Dict, Any
from config import config

LOGGER = logging.getLogger("safelive.detector")

try:
    from ultralytics import YOLO  # type: ignore
except ImportError:
    YOLO = None


@dataclass
class DetectedIssue:
    category: str               # 'pothole', 'garbage', 'water_leak', 'damaged_pole', 'street_light', 'debris'
    title: str                  # Human-readable title
    description: str            # Detailed incident narrative
    department: str             # e.g. 'BBMP Roads', 'BBMP Sanitation', 'BWSSB', 'BESCOM'
    severity: str               # 'low', 'medium', 'high', 'critical'
    confidence: float           # 0.0 - 1.0
    bbox: Tuple[int, int, int, int]  # (x1, y1, x2, y2) in pixels
    area_ratio: float           # bbox area / frame area
    timestamp: float = field(default_factory=time.time)


class CivicIncidentDetector:
    """YOLOv8 Inference Engine tailored for civic incident detection on Raspberry Pi 5."""

    # Map YOLO class names (custom or standard COCO) to civic categories & departments
    CLASS_MAPPINGS: Dict[str, Dict[str, Any]] = {
        # Custom Civic Classes
        "pothole": {
            "category": "pothole",
            "title": "Road Surface Pothole Detected",
            "description": "Hazardous road pothole or asphalt depression detected by vehicle camera.",
            "department": "BBMP Roads",
            "default_severity": "high",
        },
        "road_damage": {
            "category": "pothole",
            "title": "Severe Road Damage / Asphalt Crack",
            "description": "Cracked pavement and surface deterioration impeding vehicular movement.",
            "department": "BBMP Roads",
            "default_severity": "medium",
        },
        "garbage": {
            "category": "garbage",
            "title": "Garbage Overflow & Open Waste Dump",
            "description": "Uncollected roadside solid waste pile or overflowing civic bin detected.",
            "department": "BBMP Sanitation",
            "default_severity": "high",
        },
        "trash": {
            "category": "garbage",
            "title": "Roadside Garbage Accumulation",
            "description": "Litter and solid waste scattered along public pathway.",
            "department": "BBMP Sanitation",
            "default_severity": "medium",
        },
        "water_leak": {
            "category": "water_leak",
            "title": "Water Pipe Burst / Street Flooding",
            "description": "Pressurized water pipe leakage causing street water logging.",
            "department": "BWSSB",
            "default_severity": "critical",
        },
        "flooding": {
            "category": "water_leak",
            "title": "Waterlogging & Drainage Overflow",
            "description": "Accumulated water pool on public road blocking traffic.",
            "department": "BWSSB",
            "default_severity": "high",
        },
        "damaged_pole": {
            "category": "damaged_pole",
            "title": "Tilted / Damaged Electrical Pole",
            "description": "Hazardous electrical pole tilt or exposed cable danger near public area.",
            "department": "BESCOM",
            "default_severity": "critical",
        },
        "broken_light": {
            "category": "street_light",
            "title": "Non-Functional Streetlight",
            "description": "Dark spot / non-illuminated civic streetlight fixture.",
            "department": "BESCOM",
            "default_severity": "medium",
        },
        "fallen_tree": {
            "category": "debris",
            "title": "Fallen Tree / Road Obstruction",
            "description": "Large tree branch or physical debris blocking road lanes.",
            "department": "BBMP Roads",
            "default_severity": "critical",
        },
        # Names used by the trained SafeLive ten-class checkpoint.
        "damaged_road_issues": {
            "category": "pothole", "title": "Damaged Road Detected",
            "description": "Damaged road surface detected by vehicle camera.",
            "department": "BBMP Roads", "default_severity": "high",
        },
        "pothole_issues": {
            "category": "pothole", "title": "Road Surface Pothole Detected",
            "description": "Pothole detected by vehicle camera.",
            "department": "BBMP Roads", "default_severity": "high",
        },
        "illegal_parking_issues": {
            "category": "illegal_parking", "title": "Illegal Parking Detected",
            "description": "Vehicle obstructing a public road or access lane.",
            "department": "Traffic Police", "default_severity": "medium",
        },
        "broken_road_sign_issues": {
            "category": "road_sign", "title": "Damaged Road Sign Detected",
            "description": "Damaged or broken public road sign detected.",
            "department": "BBMP Roads", "default_severity": "medium",
        },
        "fallen_trees": {
            "category": "debris", "title": "Fallen Tree / Road Obstruction",
            "description": "Fallen tree obstructing a public road.",
            "department": "BBMP Roads", "default_severity": "critical",
        },
        "littering_garbage_on_public_places": {
            "category": "garbage", "title": "Garbage Accumulation Detected",
            "description": "Litter or dumped waste detected in a public place.",
            "department": "BBMP Sanitation", "default_severity": "high",
        },
        "vandalism_issues": {
            "category": "vandalism", "title": "Vandalism Detected",
            "description": "Possible damage to public property detected.",
            "department": "BBMP Urban Planning", "default_severity": "medium",
        },
        "dead_animal_pollution": {
            "category": "dead_animal", "title": "Dead Animal / Pollution Hazard Detected",
            "description": "Possible dead animal or related public health hazard detected.",
            "department": "BBMP Sanitation", "default_severity": "high",
        },
        "damaged_concrete_structures": {
            "category": "road_damage", "title": "Damaged Concrete Structure Detected",
            "description": "Damaged concrete civic structure detected.",
            "department": "BBMP Roads", "default_severity": "medium",
        },
        "damaged_electric_wires_and_poles": {
            "category": "damaged_pole", "title": "Damaged Electrical Pole / Wire Detected",
            "description": "Potentially hazardous damaged electrical infrastructure detected.",
            "department": "BESCOM", "default_severity": "critical",
        },
        # COCO fallbacks for demonstration / pre-trained standard models
        "traffic light": {
            "category": "traffic_infrastructure",
            "title": "Traffic Signal Inspection",
            "description": "Traffic signal infrastructure monitored along route.",
            "department": "Traffic Police",
            "default_severity": "low",
        },
        "fire hydrant": {
            "category": "water_leak",
            "title": "Hydrant / Municipal Water Point",
            "description": "Municipal water hydrant inspected for leaks or damage.",
            "department": "BWSSB",
            "default_severity": "medium",
        },
        "bench": {
            "category": "public_amenity",
            "title": "Public Amenity Inspection",
            "description": "Civic furniture and street amenity scan.",
            "department": "BBMP Urban Planning",
            "default_severity": "low",
        },
    }

    def __init__(self):
        configured_path = Path(config.YOLO_MODEL_PATH).expanduser()
        self.model_path = str(
            configured_path if configured_path.is_absolute() else (Path(__file__).resolve().parent / configured_path)
        )
        self.conf_threshold = config.CONFIDENCE_THRESHOLD
        self.iou_threshold = config.IOU_THRESHOLD
        self.device = config.INFERENCE_DEVICE
        self.fps_limit = config.INFERENCE_FPS_LIMIT
        self.inference_size = config.INFERENCE_SIZE
        self.max_detections = config.MAX_DETECTIONS

        self._model = None
        self._is_loaded = False
        self._last_inference_time = 0.0
        self._last_latency_ms = 0.0
        self._total_detections = 0

        self._load_model()

    def _load_model(self):
        """Load YOLOv8 weights."""
        if YOLO is None:
            LOGGER.warning("ultralytics YOLO package not installed. Running in mock detector mode.")
            self._is_loaded = False
            return

        try:
            # Avoid excessive context switching on the Pi's CPU.
            import torch  # type: ignore
            torch.set_num_threads(max(1, min(4, os.cpu_count() or 4)))
            LOGGER.info("Loading YOLOv8 model from %s on device %s...", self.model_path, self.device)
            self._model = YOLO(self.model_path)
            self._is_loaded = True
            LOGGER.info("YOLOv8 model loaded successfully.")
        except Exception as exc:
            LOGGER.warning("Could not load YOLO model from %s: %s (will use fallback mock classifier)", self.model_path, exc)
            self._is_loaded = False

    def detect(self, frame: np.ndarray) -> Tuple[List[DetectedIssue], np.ndarray, float]:
        """
        Run inference on frame.
        Returns:
            - issues: List of detected civic issues
            - annotated_frame: Frame with visual bounding boxes and HUD
            - latency_ms: Inference time in milliseconds
        """
        start_t = time.time()
        issues: List[DetectedIssue] = []

        if frame is None or frame.size == 0:
            return issues, frame, 0.0

        annotated_frame = frame.copy()

        h, w = frame.shape[:2]
        frame_area = float(w * h)

        if self._is_loaded and self._model is not None:
            try:
                results = self._model.predict(
                    source=frame,
                    conf=self.conf_threshold,
                    iou=self.iou_threshold,
                    device=self.device,
                    verbose=False,
                    imgsz=self.inference_size,
                    max_det=self.max_detections,
                    stream=False,
                )

                for r in results:
                    boxes = r.boxes
                    for box in boxes:
                        cls_id = int(box.cls[0])
                        cls_name = r.names.get(cls_id, str(cls_id)).lower()
                        conf = float(box.conf[0])
                        xyxy = box.xyxy[0].cpu().numpy().astype(int)
                        x1, y1, x2, y2 = int(xyxy[0]), int(xyxy[1]), int(xyxy[2]), int(xyxy[3])

                        # Check if class matches civic issue
                        mapping = self._match_civic_class(cls_name)
                        if mapping:
                            box_area = (x2 - x1) * (y2 - y1)
                            area_ratio = box_area / frame_area

                            # Determine severity based on area and confidence
                            severity = self._calculate_severity(mapping["default_severity"], area_ratio, conf)

                            issue = DetectedIssue(
                                category=mapping["category"],
                                title=mapping["title"],
                                description=f"{mapping['description']} (Confidence: {conf*100:.1f}%)",
                                department=mapping["department"],
                                severity=severity,
                                confidence=conf,
                                bbox=(x1, y1, x2, y2),
                                area_ratio=area_ratio,
                            )
                            issues.append(issue)
                            self._total_detections += 1

                # Draw YOLO bounding boxes on annotated_frame
                annotated_frame = self._draw_annotations(annotated_frame, issues)

            except Exception as exc:
                LOGGER.error("Inference execution error: %s", exc)

        latency_ms = (time.time() - start_t) * 1000.0
        self._last_latency_ms = latency_ms
        return issues, annotated_frame, latency_ms

    def _match_civic_class(self, class_name: str) -> Optional[Dict[str, Any]]:
        """Match class name or substring against civic dictionary."""
        cls_lower = class_name.lower().replace("-", "_").replace(" ", "_")
        for key, val in self.CLASS_MAPPINGS.items():
            normalized_key = key.lower().replace("-", "_").replace(" ", "_")
            if normalized_key in cls_lower or cls_lower in normalized_key:
                return val
        return None

    def _calculate_severity(self, default_sev: str, area_ratio: float, conf: float) -> str:
        """Calculate dynamic severity based on incident scale and detection certainty."""
        if default_sev == "critical":
            return "critical"
        if area_ratio > 0.15 and conf > 0.70:
            return "critical"
        if area_ratio > 0.05 or conf > 0.80:
            return "high"
        if area_ratio > 0.02:
            return "medium"
        return default_sev

    def _draw_annotations(self, frame: np.ndarray, issues: List[DetectedIssue]) -> np.ndarray:
        """Draw bounding boxes and status tags on frame."""
        for issue in issues:
            x1, y1, x2, y2 = issue.bbox

            # Color coding based on severity
            color_map = {
                "critical": (0, 0, 240),    # Bright Red
                "high": (0, 140, 255),       # Orange
                "medium": (0, 215, 255),     # Yellow
                "low": (50, 205, 50),        # Green
            }
            color = color_map.get(issue.severity, (0, 255, 0))

            # Draw outer box
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 3)

            # Draw corner accents for futuristic HUD look
            line_len = min(20, (x2 - x1) // 4)
            cv2.line(frame, (x1, y1), (x1 + line_len, y1), (255, 255, 255), 3)
            cv2.line(frame, (x1, y1), (x1, y1 + line_len), (255, 255, 255), 3)
            cv2.line(frame, (x2, y2), (x2 - line_len, y2), (255, 255, 255), 3)
            cv2.line(frame, (x2, y2), (x2, y2 - line_len), (255, 255, 255), 3)

            # Label badge
            label = f"{issue.title} | {issue.confidence * 100:.0f}% [{issue.severity.upper()}]"
            font = cv2.FONT_HERSHEY_SIMPLEX
            font_scale = 0.55
            thickness = 2
            (text_w, text_h), baseline = cv2.getTextSize(label, font, font_scale, thickness)

            badge_y1 = max(0, y1 - text_h - 10)
            badge_y2 = y1
            cv2.rectangle(frame, (x1, badge_y1), (x1 + text_w + 10, badge_y2), color, -1)
            cv2.putText(frame, label, (x1 + 5, y1 - 5), font, font_scale, (255, 255, 255), thickness)

        return frame

    def get_status(self) -> dict:
        """Return model metadata and inference metrics."""
        return {
            "model_loaded": self._is_loaded,
            "model_path": self.model_path,
            "inference_device": self.device,
            "confidence_threshold": self.conf_threshold,
            "iou_threshold": self.iou_threshold,
            "last_latency_ms": round(self._last_latency_ms, 1),
            "total_detections": self._total_detections,
        }
