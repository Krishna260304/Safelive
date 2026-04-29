from fastapi import APIRouter, HTTPException
from app.database import incidents
from app.services.pincode_service import get_pincode_index_info, get_pincode_record, normalize_pincode
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

@router.get("/pincode/{pincode}")
def verify_pincode(pincode: str):
    normalized = normalize_pincode(pincode)
    if not normalized:
        raise HTTPException(status_code=400, detail="pincode must be a valid 6-digit number")

    record = get_pincode_record(normalized)
    if not record:
        raise HTTPException(status_code=404, detail="pincode not found")

    info = get_pincode_index_info()
    return {
        "success": True,
        "data": {
            **record,
            "datasetCount": info.get("count"),
            "datasetSource": info.get("sourcePath"),
        },
    }
