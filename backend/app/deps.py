"""FastAPI dependencies: JWT auth, RBAC guards, rate limiting, and global singletons."""
from __future__ import annotations

import time
from collections import defaultdict, deque

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db import get_session
from .models import User
from .security import decode_access_token
from .services.mcp_manager import McpManager
from .services.orchestrator import Orchestrator

bearer_scheme = HTTPBearer(auto_error=False)

_mcp_manager = McpManager()
_orchestrator = Orchestrator(_mcp_manager)


def get_mcp_manager() -> McpManager:
    return _mcp_manager


def get_orchestrator() -> Orchestrator:
    return _orchestrator


class SlidingWindowRateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str, limit: int, window_seconds: float = 60.0) -> None:
        now = time.monotonic()
        q = self._hits[key]
        while q and now - q[0] > window_seconds:
            q.popleft()
        if len(q) >= limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded; please slow down.",
            )
        q.append(now)

    def reset(self) -> None:
        self._hits.clear()


rate_limiter = SlidingWindowRateLimiter()


def enforce_auth_rate_limit(request: Request) -> None:
    ip = request.client.host if request.client else "local"
    rate_limiter.check(f"auth:{ip}", get_settings().auth_rate_limit_per_minute)


def enforce_api_rate_limit(request: Request) -> None:
    ip = request.client.host if request.client else "local"
    rate_limiter.check(f"api:{ip}", get_settings().rate_limit_per_minute)


async def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    session: AsyncSession = Depends(get_session),
) -> User:
    enforce_api_rate_limit(request)
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    try:
        payload = decode_access_token(creds.credentials)
        uid = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError) as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token") from e
    user = await session.get(User, uid)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


async def require_developer_or_admin(user: User = Depends(get_current_user)) -> User:
    if user.role not in {"admin", "developer"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Developer or admin role required")
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return user
