from fastapi import APIRouter
from datetime import datetime
from app.issue_model import IssueIn
from app.database import issues_collection
from app.services.image_service import save_image
from app.services.email_service import send_alert_email
from app.services.ws_manager import manager

router = APIRouter()

@router.post("/report")
async def report_issue(issue: IssueIn):

    image_path = save_image(issue.image)

    data = {
        "description": issue.description,
        "latitude": issue.latitude,
        "longitude": issue.longitude,
        "severity": issue.severity,
        "image_path": image_path,
        "timestamp": datetime.utcnow(),
        "status": "OPEN"
    }

    issues_collection.insert_one(data)

    send_alert_email(issue.description, issue.latitude, issue.longitude)

                    
    await manager.broadcast({
        "description": issue.description,
        "latitude": issue.latitude,
        "longitude": issue.longitude,
        "severity": issue.severity,
        "status": "OPEN"
    })

    return {"status": "Issue Stored"}
