from typing import Any
from pydantic import BaseModel


class IssueIn(BaseModel):
    description: str
    latitude: float
    longitude: float
    image: str | None = None
    images: list[str] | None = None
    severity: str | None = "high"
    deviceId: str | None = None
    source: str | None = None
    scope: str | None = None
    category: str | None = None
    location: str | None = None
    eventId: str | None = None
    sensorType: str | None = None
    confidence: float | None = None
    capturedAt: str | None = None
    reportedBy: str | None = None
    metadata: dict[str, Any] | None = None
