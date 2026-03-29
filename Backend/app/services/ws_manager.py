from typing import Callable
from fastapi import WebSocket

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[dict] = []

    async def connect(self, websocket: WebSocket, user: dict | None = None):
        await websocket.accept()
        self.active_connections.append({"websocket": websocket, "user": user or {}})

    def disconnect(self, websocket: WebSocket):
        self.active_connections = [
            entry for entry in self.active_connections if entry.get("websocket") is not websocket
        ]

    async def broadcast(self, message: dict, predicate: Callable[[dict | None], bool] | None = None):
        stale_connections: list[WebSocket] = []
        for entry in list(self.active_connections):
            connection = entry.get("websocket")
            user = entry.get("user")
            if not isinstance(connection, WebSocket):
                continue
            if predicate and not predicate(user if isinstance(user, dict) else None):
                continue
            try:
                await connection.send_json(message)
            except Exception:
                stale_connections.append(connection)

        for connection in stale_connections:
            self.disconnect(connection)

manager = ConnectionManager()
