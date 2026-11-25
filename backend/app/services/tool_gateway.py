"""Built-in MCP server definitions, secret decryption, and tool execution gateway with approval enforcement."""
from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any

from mcp import types
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import REPO_ROOT, get_settings
from ..models import Approval, Credential, McpServer, PermissionRule, Project, ToolCallLog, User
from ..schemas import McpServerOut, ToolCallResult, ToolOut
from ..security import decrypt_secret, encrypt_secret
from . import audit
from .mcp_manager import LaunchSpec, McpError, McpManager
from .policy import Risk, classify_risk, evaluate

log = logging.getLogger("devpilot.tool_gateway")

BUILTIN_SERVERS: list[dict[str, str]] = [
    {
        "name": "filesystem",
        "module": "mcp_servers.filesystem.server",
        "description": "Workspace filesystem & code intelligence (jailed to workspace root)",
    },
    {
        "name": "github",
        "module": "mcp_servers.github.server",
        "description": "GitHub repositories, issues, pull requests, branches, and commits",
    },
    {
        "name": "database",
        "module": "mcp_servers.database.server",
        "description": "Read-only database schema inspection, query execution, EXPLAIN & static analysis",
    },
    {
        "name": "terminal",
        "module": "mcp_servers.terminal.server",
        "description": "Sandboxed developer command runner with executable allowlist",
    },
    {
        "name": "testing",
        "module": "mcp_servers.testing.server",
        "description": "Test framework detection, test suite runner, coverage & failure analyzer",
    },
    {
        "name": "deployment",
        "module": "mcp_servers.deployment.server",
        "description": "Deployment center for Render and Vercel services, logs, deploys & rollbacks",
    },
    {
        "name": "apidocs",
        "module": "mcp_servers.apidocs.server",
        "description": "OpenAPI spec analyzer, Markdown doc generator & SSRF-guarded endpoint tester",
    },
]


def encode_kv(data: dict[str, str] | None) -> str | None:
    if not data:
        return None
    return encrypt_secret(json.dumps(data))


def decode_kv(encrypted: str | None) -> dict[str, str]:
    if not encrypted:
        return {}
    try:
        val = json.loads(decrypt_secret(encrypted))
        return {str(k): str(v) for k, v in val.items()} if isinstance(val, dict) else {}
    except Exception:
        return {}


async def ensure_builtin_servers(session: AsyncSession) -> None:
    s = get_settings()
    if not s.builtin_servers_autoregister:
        return
    existing = {
        row.name: row
        for row in (await session.execute(select(McpServer))).scalars().all()
    }
    changed = False
    for spec in BUILTIN_SERVERS:
        if spec["name"] not in existing:
            session.add(
                McpServer(
                    name=spec["name"],
                    description=spec["description"],
                    transport="stdio",
                    command=s.python_executable,
                    args=["-m", spec["module"]],
                    enabled=True,
                    builtin=True,
                )
            )
            changed = True
    if changed:
        await session.commit()


async def build_launch_spec(
    session: AsyncSession,
    server: McpServer,
    user_id: int | None = None,
    project: Project | None = None,
) -> LaunchSpec:
    s = get_settings()
    env = dict(os.environ)
    env["PYTHONPATH"] = str(REPO_ROOT) + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
    env["DEVPILOT_WORKSPACE_ROOT"] = project.root_path if (project and project.root_path) else s.workspace_root
    if s.project_db_url:
        env["DEVPILOT_PROJECT_DB_URL"] = s.project_db_url
    env.update(decode_kv(server.env_encrypted))

    # Inject user's GitHub OAuth / PAT / Public credential if connecting the github server and GITHUB_TOKEN isn't already set
    if server.name == "github" and "GITHUB_TOKEN" not in env:
        cred = None
        if user_id is not None:
            cred = (
                await session.execute(
                    select(Credential).where(Credential.user_id == user_id, Credential.provider == "github")
                )
            ).scalars().first()
        if cred:
            try:
                env["GITHUB_TOKEN"] = decrypt_secret(cred.token_encrypted)
            except ValueError:
                env["GITHUB_TOKEN"] = "__PUBLIC__"
            if cred.account_login:
                env["DEVPILOT_GITHUB_PUBLIC_USER"] = cred.account_login
        else:
            env["GITHUB_TOKEN"] = "__PUBLIC__"
            env.setdefault("DEVPILOT_GITHUB_PUBLIC_USER", "Mahirlokare")

    headers = decode_kv(server.headers_encrypted)
    cmd = server.command or s.python_executable
    return LaunchSpec(
        transport=server.transport,
        command=cmd,
        args=list(server.args or []),
        env=env,
        cwd=str(REPO_ROOT),
        url=server.url,
        headers=headers,
    )


def server_to_out(server: McpServer, manager: McpManager) -> McpServerOut:
    status, live_err, tool_count = manager.status(server.id)
    env_keys = sorted(decode_kv(server.env_encrypted).keys())
    return McpServerOut(
        id=server.id,
        name=server.name,
        description=server.description,
        transport=server.transport,
        command=server.command,
        args=list(server.args or []),
        url=server.url,
        env_keys=env_keys,
        enabled=server.enabled,
        builtin=server.builtin,
        status=status,
        last_error=live_err or server.last_error,
        last_connected_at=server.last_connected_at,
        tool_count=tool_count,
        created_at=server.created_at,
    )


def format_tool(server: McpServer, tool: types.Tool, rules: list[PermissionRule], role: str) -> ToolOut:
    risk = classify_risk(tool.annotations, trusted=server.builtin)
    pol = evaluate(rules, role, server.name, tool.name, risk)
    return ToolOut(
        server_id=server.id,
        server_name=server.name,
        name=tool.name,
        description=tool.description or "",
        input_schema=tool.inputSchema or {"type": "object", "properties": {}},
        risk=risk,
        requires_approval=(pol.decision == "require_approval"),
    )


def unpack_call_result(res: types.CallToolResult, max_chars: int) -> tuple[bool, Any, str | None]:
    """Convert an MCP CallToolResult into (ok, payload, error_str) with size capping and redaction."""
    texts: list[str] = []
    for item in res.content or []:
        text = getattr(item, "text", None)
        if text is not None:
            texts.append(text)
        else:
            texts.append(str(item))
    joined = "\n".join(texts)
    if len(joined) > max_chars:
        joined = joined[:max_chars] + "…[truncated]"
    if getattr(res, "isError", False):
        return False, None, joined or "Tool reported an error"
    if len(texts) == 1:
        try:
            return True, audit.scrub(json.loads(texts[0])), None
        except Exception:
            pass
    return True, audit.scrub(joined), None


async def execute_raw_tool(
    session: AsyncSession,
    manager: McpManager,
    server: McpServer,
    tool_name: str,
    arguments: dict[str, Any],
    *,
    actor: str,
    run_id: int | None = None,
) -> tuple[bool, Any, str | None, int]:
    """Actually invoke the tool over MCP, log to ToolCallLog and AuditEvent, and return (ok, result, error, duration_ms)."""
    s = get_settings()
    t0 = time.monotonic()
    ok = False
    payload: Any = None
    err: str | None = None
    try:
        raw = await manager.call_tool(server.id, tool_name, arguments, timeout=float(s.tool_timeout_seconds))
        ok, payload, err = unpack_call_result(raw, s.max_tool_output_chars)
    except McpError as e:
        err = str(e)
    except Exception as e:  # noqa: BLE001
        err = f"{type(e).__name__}: {e}"
    duration_ms = max(1, int((time.monotonic() - t0) * 1000))
    session.add(
        ToolCallLog(
            server_name=server.name,
            tool_name=tool_name,
            ok=ok,
            duration_ms=duration_ms,
            error=err,
            run_id=run_id,
        )
    )
    await audit.record(
        session,
        "tool.call",
        actor=actor,
        server_name=server.name,
        tool_name=tool_name,
        detail={"arguments": arguments, "duration_ms": duration_ms, "error": err},
        outcome="ok" if ok else "error",
        commit=True,
    )
    return ok, payload, err, duration_ms


async def invoke_tool_with_policy(
    session: AsyncSession,
    manager: McpManager,
    user: User,
    server: McpServer,
    tool_name: str,
    arguments: dict[str, Any],
    *,
    run_id: int | None = None,
    step_id: int | None = None,
    auto_connect: bool = True,
    project: Project | None = None,
) -> tuple[ToolCallResult, Risk]:
    """Validate tool existence, check RBAC & policy, create Approval if needed, or execute via MCP."""
    status, _, _ = manager.status(server.id)
    if status != "connected":
        if not auto_connect or not server.enabled:
            return ToolCallResult(status="failed", error=f"MCP server '{server.name}' is not connected"), "write"
        try:
            spec = await build_launch_spec(session, server, user_id=user.id, project=project)
            await manager.connect(server.id, server.name, spec)
            server.last_connected_at = datetime.now(timezone.utc)
            server.last_error = None
            await session.commit()
        except Exception as e:  # noqa: BLE001
            server.last_error = str(e)
            await session.commit()
            return ToolCallResult(status="failed", error=f"Failed to connect '{server.name}': {e}"), "write"

    tools = {t.name: t for t in manager.tools(server.id)}
    mcp_tool = tools.get(tool_name)
    if mcp_tool is None:
        return ToolCallResult(status="failed", error=f"Unknown tool '{tool_name}' on server '{server.name}'"), "write"

    risk = classify_risk(mcp_tool.annotations, trusted=server.builtin)
    rules = list((await session.execute(select(PermissionRule))).scalars().all())
    pol = evaluate(rules, user.role, server.name, tool_name, risk)

    if pol.decision == "deny":
        await audit.record(
            session,
            "tool.denied",
            actor=user.username,
            server_name=server.name,
            tool_name=tool_name,
            detail={"reason": pol.reason, "arguments": arguments},
            outcome="denied",
        )
        return ToolCallResult(status="denied", error=f"Permission denied: {pol.reason}"), risk

    if pol.decision == "require_approval":
        approval = Approval(
            run_id=run_id,
            step_id=step_id,
            requested_by_id=user.id,
            server_id=server.id,
            server_name=server.name,
            tool_name=tool_name,
            arguments=audit.scrub(arguments),
            risk=risk,
            status="pending",
        )
        session.add(approval)
        await session.commit()
        await session.refresh(approval)
        await audit.record(
            session,
            "approval.requested",
            actor=user.username,
            server_name=server.name,
            tool_name=tool_name,
            detail={"approval_id": approval.id, "risk": risk, "arguments": arguments},
            outcome="pending",
        )
        return (
            ToolCallResult(
                status="awaiting_approval",
                approval_id=approval.id,
                error=f"Approval #{approval.id} required ({pol.reason})",
            ),
            risk,
        )

    ok, payload, err, duration_ms = await execute_raw_tool(
        session,
        manager,
        server,
        tool_name,
        arguments,
        actor=user.username,
        run_id=run_id,
    )
    return (
        ToolCallResult(
            status="succeeded" if ok else "failed",
            result=payload,
            error=err,
            duration_ms=duration_ms,
        ),
        risk,
    )
