"""Audit trail + secret scrubbing for anything persisted in logs."""
from __future__ import annotations

import logging
import re
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AuditEvent

log = logging.getLogger("devpilot.audit")

_SENSITIVE_KEY = re.compile(r"(?i)(password|passwd|secret|token|api[_-]?key|authorization|credential|private[_-]?key|cookie)")
_SECRET_VALUE = re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|(?i:bearer)\s+[A-Za-z0-9._~+/=-]{16,}")


def scrub(value: Any, _depth: int = 0) -> Any:
    """Recursively mask sensitive keys and token-looking strings."""
    if _depth > 8:
        return "[truncated]"
    if isinstance(value, dict):
        return {k: "[REDACTED]" if _SENSITIVE_KEY.search(str(k)) else scrub(v, _depth + 1) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [scrub(v, _depth + 1) for v in value[:200]]
    if isinstance(value, str):
        v = _SECRET_VALUE.sub("[REDACTED]", value)
        return v if len(v) <= 2000 else v[:2000] + "…[truncated]"
    return value


async def record(
    session: AsyncSession,
    event_type: str,
    *,
    actor: str = "system",
    server_name: str | None = None,
    tool_name: str | None = None,
    detail: dict[str, Any] | None = None,
    outcome: str = "ok",
    commit: bool = True,
) -> None:
    session.add(AuditEvent(actor=actor, event_type=event_type, server_name=server_name, tool_name=tool_name,
                           detail=scrub(detail or {}), outcome=outcome))
    log.info("audit %s actor=%s server=%s tool=%s outcome=%s", event_type, actor, server_name, tool_name, outcome)
    if commit:
        await session.commit()
