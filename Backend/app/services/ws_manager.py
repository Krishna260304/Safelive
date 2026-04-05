import asyncio
from typing import Callable
from fastapi import WebSocket

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[dict] = []

    async def connect(self, websocket: WebSocket, user: dict | None = None, *, accept: bool = True):
        if accept:
            await websocket.accept()
        self.active_connections.append({"websocket": websocket, "user": user or {}})

    def disconnect(self, websocket: WebSocket) -> dict | None:
        disconnected_user: dict | None = None
        next_connections: list[dict] = []
        for entry in self.active_connections:
            if entry.get("websocket") is websocket:
                user = entry.get("user")
                if disconnected_user is None and isinstance(user, dict):
                    disconnected_user = user
                continue
            next_connections.append(entry)
        self.active_connections = next_connections
        return disconnected_user

    async def broadcast(
        self,
        message: dict | None = None,
        predicate: Callable[[dict | None], bool] | None = None,
        message_factory: Callable[[dict | None], dict | None] | None = None,
    ):
        target_connections: list[tuple[WebSocket, dict]] = []
        for entry in list(self.active_connections):
            connection = entry.get("websocket")
            user = entry.get("user")
            if not isinstance(connection, WebSocket):
                continue
            if predicate and not predicate(user if isinstance(user, dict) else None):
                continue
            if message_factory is not None:
                resolved_message = message_factory(user if isinstance(user, dict) else None)
                if not isinstance(resolved_message, dict):
                    continue
            else:
                resolved_message = message if isinstance(message, dict) else None
                if resolved_message is None:
                    continue
            target_connections.append((connection, resolved_message))

        if not target_connections:
            return

        results = await asyncio.gather(
            *(connection.send_json(payload) for connection, payload in target_connections),
            return_exceptions=True,
        )

        stale_connections = [
            connection
            for (connection, _payload), result in zip(target_connections, results)
            if isinstance(result, Exception)
        ]

        for connection in stale_connections:
            self.disconnect(connection)

manager = ConnectionManager()
