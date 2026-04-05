import asyncio
from datetime import datetime

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from app.auth import get_user_from_token
from app.routes_ticket_chat import purge_active_ticket_chats_for_user
from app.services.ws_manager import manager

router = APIRouter()
WS_AUTH_TIMEOUT_SECONDS = 10


def _message_type(payload: object) -> str:
    if isinstance(payload, dict):
        return str(payload.get("type") or "").strip().upper()
    return ""


def _message_token(payload: object) -> str:
    if isinstance(payload, dict):
        return str(payload.get("token") or "").strip()
    return ""

@router.websocket("/ws/incidents")
async def ws_incidents(websocket: WebSocket):
    await websocket.accept()

    try:
        auth_payload = await asyncio.wait_for(websocket.receive_json(), timeout=WS_AUTH_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        await websocket.close(code=1008, reason="Authentication timeout")
        return
    except Exception:
        await websocket.close(code=1008, reason="Authentication required")
        return

    token = _message_token(auth_payload)
    if _message_type(auth_payload) != "AUTH" or not token:
        await websocket.close(code=1008, reason="Authentication required")
        return

    try:
        current_user = get_user_from_token(token)
    except HTTPException:
        await websocket.close(code=1008)
        return

    await manager.connect(websocket, current_user, accept=False)
    await websocket.send_json(
        {
            "type": "AUTH_OK",
            "data": {
                "at": datetime.utcnow().isoformat(),
            },
        }
    )
    try:
        while True:
            payload = await websocket.receive_json()
            if _message_type(payload) == "PING":
                await websocket.send_json(
                    {
                        "type": "PONG",
                        "data": {
                            "at": datetime.utcnow().isoformat(),
                        },
                    }
                )
    except WebSocketDisconnect:
        disconnected_user = manager.disconnect(websocket)
        disconnected_user_id = str((disconnected_user or {}).get("id") or "").strip()
        if disconnected_user_id:
            await purge_active_ticket_chats_for_user(disconnected_user_id, reason="disconnected")
    except Exception:
        disconnected_user = manager.disconnect(websocket)
        disconnected_user_id = str((disconnected_user or {}).get("id") or "").strip()
        if disconnected_user_id:
            await purge_active_ticket_chats_for_user(disconnected_user_id, reason="disconnected")
        try:
            await websocket.close(code=1011)
        except Exception:
            return
