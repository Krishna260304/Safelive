from collections import defaultdict
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends
from app.database import incidents, tickets, users
from app.auth import get_official_user

router = APIRouter(prefix="/api/analytics")

def _parse_datetime(value):
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not isinstance(value, str):
        return None

    candidate = value.strip()
    if not candidate:
        return None

    if candidate.endswith("Z"):
        candidate = f"{candidate[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)

def _day_key(value, default_day: str):
    parsed = _parse_datetime(value)
    if parsed is not None:
        return parsed.date().isoformat()
    if isinstance(value, str) and len(value) >= 10:
        return value[:10]
    return default_day

def _safe_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None

def _status_breakdown(collection):
    total = collection.count_documents({})
    open_count = collection.count_documents({"status": "open"})
    pending_count = collection.count_documents({"status": "pending"})
    in_progress_count = collection.count_documents({"status": {"$in": ["in_progress", "verified"]}})
    resolved_count = collection.count_documents({"status": "resolved"})
    return {
        "total": total,
        "open": open_count,
        "pending": pending_count,
        "inProgress": in_progress_count,
        "resolved": resolved_count,
        "resolutionRate": round((resolved_count / total) * 100, 2) if total > 0 else 0,
    }

def _average_resolution_hours():
    cursor = tickets.find({"status": "resolved"}, {"createdAt": 1, "updatedAt": 1})
    durations = []
    for row in cursor:
        created_at = _parse_datetime(row.get("createdAt"))
        updated_at = _parse_datetime(row.get("updatedAt"))
        if not created_at or not updated_at:
            continue
        if updated_at < created_at:
            continue
        durations.append((updated_at - created_at).total_seconds() / 3600)

    if not durations:
        return 0
    return round(sum(durations) / len(durations), 2)

def _build_worker_productivity():
    productivity_pipeline = [
        {"$match": {"assignedTo": {"$exists": True, "$nin": [None, ""]}}},
        {
            "$group": {
                "_id": "$assignedTo",
                "total": {"$sum": 1},
                "resolved": {"$sum": {"$cond": [{"$eq": ["$status", "resolved"]}, 1, 0]}},
                "inProgress": {"$sum": {"$cond": [{"$in": ["$status", ["in_progress", "verified"]]}, 1, 0]}},
                "open": {"$sum": {"$cond": [{"$eq": ["$status", "open"]}, 1, 0]}},
                "pending": {"$sum": {"$cond": [{"$eq": ["$status", "pending"]}, 1, 0]}},
            }
        },
        {"$sort": {"resolved": -1, "total": -1}},
    ]
    worker_rows = list(tickets.aggregate(productivity_pipeline))

    user_lookup = {}
    for row in users.find({}, {"name": 1, "email": 1, "phone": 1}):
        key = str(row.get("_id"))
        label = row.get("name") or row.get("email") or row.get("phone") or key
        user_lookup[key] = label

    output = []
    for row in worker_rows:
        total = int(row.get("total", 0))
        resolved = int(row.get("resolved", 0))
        in_progress = int(row.get("inProgress", 0))
        open_count = int(row.get("open", 0))
        pending_count = int(row.get("pending", 0))
        raw_worker = row.get("_id")
        worker_key = str(raw_worker).strip() if raw_worker is not None else ""
        output.append(
            {
                "worker": user_lookup.get(worker_key) or worker_key or "Unknown",
                "total": total,
                "resolved": resolved,
                "open": open_count,
                "pending": pending_count,
                "inProgress": in_progress,
                "resolutionRate": round((resolved / total) * 100, 2) if total > 0 else 0,
            }
        )

    return output

@router.get("/dashboard")
def dashboard(current_user: dict = Depends(get_official_user)):
    incident_stats = _status_breakdown(incidents)
    ticket_stats = _status_breakdown(tickets)

    category_pipeline = [
        {"$group": {"_id": "$category", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}}
    ]
    category_totals = defaultdict(int)
    for item in incidents.aggregate(category_pipeline):
        key = str(item.get("_id") or "").strip().lower() or "unknown"
        category_totals[key] += int(item.get("count", 0))
    by_category = [
        {"category": key, "count": count}
        for key, count in sorted(category_totals.items(), key=lambda row: row[1], reverse=True)
    ]

    worker_productivity = _build_worker_productivity()

    total_incidents = incident_stats["total"]
    resolved_incidents = incident_stats["resolved"]
    city_cleanliness_score = incident_stats["resolutionRate"]
    safety_incident_count = incidents.count_documents({"category": {"$in": ["safety", "fire", "emergency", "crowd"]}})
    safety_index = 100.0
    if total_incidents > 0:
        safety_pressure = safety_incident_count / total_incidents
        safety_index = max(0.0, round(100 - (safety_pressure * 100), 2))

    return {
        "success": True,
        "data": {
            "incidents": incident_stats,
            "tickets": ticket_stats,
            "cityCleanlinessScore": city_cleanliness_score,
            "safetyIndex": safety_index,
            "avgResolutionHours": _average_resolution_hours(),
            "byCategory": by_category,
            "workerProductivity": worker_productivity
        }
    }

@router.get("/heatmap")
def heatmap(current_user: dict = Depends(get_official_user)):
    points = []
    cursor = incidents.find({"latitude": {"$ne": None}, "longitude": {"$ne": None}}, {
        "latitude": 1,
        "longitude": 1,
        "priority": 1,
        "status": 1,
        "category": 1
    })
    priority_weights = {"low": 0.5, "medium": 1.0, "high": 1.5}
    for row in cursor:
        lat = _safe_float(row.get("latitude"))
        lng = _safe_float(row.get("longitude"))
        if lat is None or lng is None:
            continue
        weight = priority_weights.get((row.get("priority") or "medium").lower(), 1.0)
        if row.get("status") == "resolved":
            weight = max(0.2, weight - 0.6)
        points.append({
            "lat": lat,
            "lng": lng,
            "weight": weight,
            "category": row.get("category"),
            "status": row.get("status")
        })
    return {"success": True, "data": points}

@router.get("/trends")
def trends(days: int = 14, current_user: dict = Depends(get_official_user)):
    days = min(max(days, 7), 60)
    now = datetime.utcnow().date()
    today_key = now.isoformat()
    labels = []
    stats_map = {}
    for i in range(days):
        day = now - timedelta(days=(days - i - 1))
        key = day.strftime("%Y-%m-%d")
        labels.append(key)
        stats_map[key] = {"date": key, "created": 0, "resolved": 0}
    cursor = incidents.find({}, {"createdAt": 1, "updatedAt": 1, "status": 1})
    for row in cursor:
        created_key = _day_key(row.get("createdAt"), today_key)
        if created_key in stats_map:
            stats_map[created_key]["created"] += 1
        if row.get("status") == "resolved":
            resolved_key = _day_key(row.get("updatedAt"), today_key)
            if resolved_key in stats_map:
                stats_map[resolved_key]["resolved"] += 1
    trend = [stats_map[key] for key in labels]
    return {"success": True, "data": trend}
