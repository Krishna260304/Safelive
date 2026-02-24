from fastapi import APIRouter
from app.database import incidents
from app.utils import serialize_list

router = APIRouter(prefix="/api/public")

@router.get("/summary")
def summary():
    total = incidents.count_documents({})
    resolved = incidents.count_documents({"status": "resolved"})
    open_count = incidents.count_documents({"status": "open"})
    pending_count = incidents.count_documents({"status": "pending"})
    in_progress = incidents.count_documents({"status": "in_progress"})
    resolution_rate = round((resolved / total) * 100, 2) if total > 0 else 0
    recent = list(incidents.find({}, {
        "title": 1,
        "category": 1,
        "status": 1,
        "location": 1,
        "createdAt": 1
    }).sort("createdAt", -1).limit(5))
    return {
        "success": True,
        "data": {
            "total": total,
            "resolved": resolved,
            "open": open_count,
            "pending": pending_count,
            "inProgress": in_progress,
            "resolutionRate": resolution_rate,
            "recent": serialize_list(recent)
        }
    }
