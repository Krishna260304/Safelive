from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from app.auth import get_user_from_token
from app.services.ws_manager import manager

router = APIRouter()

@router.websocket("/ws/incidents")
async def ws_incidents(websocket: WebSocket):
    token = (websocket.query_params.get("token") or "").strip()
    if not token:
        await websocket.close(code=1008)
        return

    try:
        current_user = get_user_from_token(token)
    except HTTPException:
        await websocket.close(code=1008)
        return

    await manager.connect(websocket, current_user)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
