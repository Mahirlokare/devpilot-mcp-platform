"""API v1 routers matching docs/API_CONTRACT.md."""
from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_session
from ..deps import (
    enforce_auth_rate_limit,
    get_current_user,
    get_mcp_manager,
    get_orchestrator,
    require_admin,
    require_developer_or_admin,
)
from ..models import (
    Approval,
    AuditEvent,
    Conversation,
    Credential,
    McpServer,
    Message,
    OAuthState,
    PermissionRule,
    Project,
    ProjectMemory,
    Run,
    ToolCallLog,
    User,
)
from ..schemas import (
    ApprovalOut,
    AuditOut,
    ConversationDetail,
    ConversationIn,
    ConversationOut,
    Credentials,
    DecisionIn,
    McpServerIn,
    McpServerOut,
    McpServerPatch,
    MemoryIn,
    MemoryOut,
    MessageIn,
    ProjectIn,
    ProjectOut,
    ProjectPatch,
    PromptArgOut,
    PromptOut,
    RegisterRequest,
    ResourceOut,
    RuleIn,
    RuleOut,
    RunOut,
    RunSummary,
    StepOut,
    TokenResponse,
    ToolCallIn,
    ToolCallResult,
    ToolOut,
    UserOut,
    UserRoleUpdate,
)
from ..security import create_access_token, encrypt_secret, hash_password, verify_password
from ..services import audit
from ..services.mcp_manager import McpError, McpManager
from ..services.orchestrator import Orchestrator
from ..services.tool_gateway import (
    build_launch_spec,
    decode_kv,
    encode_kv,
    format_tool,
    invoke_tool_with_policy,
    server_to_out,
)

api_router = APIRouter(prefix="/api/v1")


# ===================================================================== AUTH
@api_router.get("/auth/config")
async def auth_config(session: AsyncSession = Depends(get_session)) -> dict[str, bool]:
    s = get_settings()
    user_count = (await session.execute(select(func.count(User.id)))).scalar_one()
    return {
        "registration_open": bool(user_count == 0 or s.allow_registration),
        "github_oauth_configured": bool(s.github_client_id and s.github_client_secret),
    }


@api_router.post("/auth/register", response_model=TokenResponse, dependencies=[Depends(enforce_auth_rate_limit)])
async def register(body: RegisterRequest, session: AsyncSession = Depends(get_session)) -> TokenResponse:
    s = get_settings()
    user_count = (await session.execute(select(func.count(User.id)))).scalar_one()
    if user_count > 0 and not s.allow_registration:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Public registration is closed. Ask an administrator to enable registration.",
        )
    existing = (await session.execute(select(User).where(User.username == body.username))).scalars().first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username is already taken")
    role = "admin" if user_count == 0 else "developer"
    user = User(username=body.username, password_hash=hash_password(body.password), role=role)
    session.add(user)
    await session.commit()
    await session.refresh(user)
    await audit.record(session, "auth.register", actor=user.username, detail={"role": role})
    token = create_access_token(user.id, user.role)
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


@api_router.post("/auth/login", response_model=TokenResponse, dependencies=[Depends(enforce_auth_rate_limit)])
async def login(body: Credentials, session: AsyncSession = Depends(get_session)) -> TokenResponse:
    user = (await session.execute(select(User).where(User.username == body.username))).scalars().first()
    if not user or not verify_password(body.password, user.password_hash):
        await audit.record(
            session,
            "auth.login_failed",
            actor=body.username,
            detail={"reason": "bad_credentials"},
            outcome="denied",
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
    await audit.record(session, "auth.login", actor=user.username)
    token = create_access_token(user.id, user.role)
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


@api_router.get("/auth/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)


# ===================================================================== USERS (ADMIN)
@api_router.get("/users", response_model=list[UserOut])
async def list_users(_: User = Depends(require_admin), session: AsyncSession = Depends(get_session)) -> list[UserOut]:
    rows = (await session.execute(select(User).order_by(User.id))).scalars().all()
    return [UserOut.model_validate(u) for u in rows]


@api_router.patch("/users/{user_id}", response_model=UserOut)
async def update_user_role(
    user_id: int,
    body: UserRoleUpdate,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> UserOut:
    target = await session.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    old_role = target.role
    target.role = body.role
    await session.commit()
    await session.refresh(target)
    await audit.record(
        session,
        "user.role_updated",
        actor=admin.username,
        detail={"target": target.username, "old_role": old_role, "new_role": body.role},
    )
    return UserOut.model_validate(target)


# ===================================================================== GITHUB OAUTH
@api_router.get("/integrations/github/authorize")
async def github_authorize(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    s = get_settings()
    if not s.github_client_id or not s.github_client_secret:
        raise HTTPException(
            status_code=400,
            detail="GitHub OAuth is not configured (set DEVPILOT_GITHUB_CLIENT_ID and DEVPILOT_GITHUB_CLIENT_SECRET)",
        )
    state = secrets.token_urlsafe(32)
    session.add(OAuthState(state=state, user_id=user.id))
    await session.commit()
    params = urlencode(
        {
            "client_id": s.github_client_id,
            "redirect_uri": s.github_redirect_uri,
            "scope": "repo read:user",
            "state": state,
        }
    )
    return {"authorize_url": f"https://github.com/login/oauth/authorize?{params}"}


@api_router.get("/integrations/github/callback")
async def github_callback(
    code: str,
    state: str,
    session: AsyncSession = Depends(get_session),
) -> RedirectResponse:
    s = get_settings()
    st_row = await session.get(OAuthState, state)
    if not st_row:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state")
    user_id = st_row.user_id
    await session.delete(st_row)
    await session.commit()

    async with httpx.AsyncClient(timeout=20.0) as client:
        tok_resp = await client.post(
            "https://github.com/login/oauth/access_token",
            headers={"Accept": "application/json"},
            data={
                "client_id": s.github_client_id,
                "client_secret": s.github_client_secret,
                "code": code,
                "redirect_uri": s.github_redirect_uri,
            },
        )
        tok_data = tok_resp.json()
        access_token = tok_data.get("access_token")
        if not access_token:
            raise HTTPException(status_code=400, detail="GitHub OAuth token exchange failed")
        u_resp = await client.get(
            "https://api.github.com/user",
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/vnd.github+json"},
        )
        login_name = u_resp.json().get("login") if u_resp.status_code == 200 else None

    existing = (
        await session.execute(select(Credential).where(Credential.user_id == user_id, Credential.provider == "github"))
    ).scalars().first()
    if existing:
        existing.token_encrypted = encrypt_secret(access_token)
        existing.account_login = login_name
    else:
        session.add(
            Credential(
                user_id=user_id,
                provider="github",
                account_login=login_name,
                token_encrypted=encrypt_secret(access_token),
                scopes=tok_data.get("scope"),
            )
        )
    await session.commit()
    return RedirectResponse(url=f"{s.frontend_url}/github")


@api_router.get("/integrations/github/status")
async def github_status(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    cred = (
        await session.execute(select(Credential).where(Credential.user_id == user.id, Credential.provider == "github"))
    ).scalars().first()
    return {"connected": cred is not None, "login": cred.account_login if cred else None}


@api_router.delete("/integrations/github", status_code=status.HTTP_204_NO_CONTENT)
async def github_disconnect(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    cred = (
        await session.execute(select(Credential).where(Credential.user_id == user.id, Credential.provider == "github"))
    ).scalars().first()
    if cred:
        await session.delete(cred)
        await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ===================================================================== PROJECTS & MEMORY
@api_router.get("/projects", response_model=list[ProjectOut])
async def list_projects(
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ProjectOut]:
    rows = (await session.execute(select(Project).order_by(Project.id.desc()))).scalars().all()
    return [ProjectOut.model_validate(p) for p in rows]


@api_router.post("/projects", response_model=ProjectOut)
async def create_project(
    body: ProjectIn,
    user: User = Depends(require_developer_or_admin),
    session: AsyncSession = Depends(get_session),
) -> ProjectOut:
    proj = Project(
        owner_id=user.id,
        name=body.name,
        description=body.description,
        repo_full_name=body.repo_full_name,
        root_path=body.root_path,
    )
    session.add(proj)
    await session.commit()
    await session.refresh(proj)
    await audit.record(session, "project.created", actor=user.username, detail={"project_id": proj.id, "name": proj.name})
    return ProjectOut.model_validate(proj)


@api_router.get("/projects/{project_id}", response_model=ProjectOut)
async def get_project(
    project_id: int,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ProjectOut:
    proj = await session.get(Project, project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    return ProjectOut.model_validate(proj)


@api_router.patch("/projects/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: int,
    body: ProjectPatch,
    user: User = Depends(require_developer_or_admin),
    session: AsyncSession = Depends(get_session),
) -> ProjectOut:
    proj = await session.get(Project, project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(proj, k, v)
    await session.commit()
    await session.refresh(proj)
    await audit.record(session, "project.updated", actor=user.username, detail={"project_id": proj.id})
    return ProjectOut.model_validate(proj)


@api_router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: int,
    user: User = Depends(require_developer_or_admin),
    session: AsyncSession = Depends(get_session),
) -> Response:
    proj = await session.get(Project, project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    await session.delete(proj)
    await session.commit()
    await audit.record(session, "project.deleted", actor=user.username, detail={"project_id": project_id})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@api_router.get("/projects/{project_id}/memory", response_model=list[MemoryOut])
async def list_project_memory(
    project_id: int,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[MemoryOut]:
    proj = await session.get(Project, project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    rows = (
        await session.execute(select(ProjectMemory).where(ProjectMemory.project_id == project_id).order_by(ProjectMemory.id))
    ).scalars().all()
    return [MemoryOut.model_validate(m) for m in rows]


@api_router.post("/projects/{project_id}/memory", response_model=MemoryOut)
async def add_project_memory(
    project_id: int,
    body: MemoryIn,
    _: User = Depends(require_developer_or_admin),
    session: AsyncSession = Depends(get_session),
) -> MemoryOut:
    proj = await session.get(Project, project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    mem = ProjectMemory(project_id=project_id, content=body.content)
    session.add(mem)
    await session.commit()
    await session.refresh(mem)
    return MemoryOut.model_validate(mem)


@api_router.delete("/projects/{project_id}/memory/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project_memory(
    project_id: int,
    memory_id: int,
    _: User = Depends(require_developer_or_admin),
    session: AsyncSession = Depends(get_session),
) -> Response:
    mem = await session.get(ProjectMemory, memory_id)
    if not mem or mem.project_id != project_id:
        raise HTTPException(status_code=404, detail="Memory entry not found")
    await session.delete(mem)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ===================================================================== MCP MANAGEMENT
@api_router.get("/mcp/servers", response_model=list[McpServerOut])
async def list_mcp_servers(
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    manager: McpManager = Depends(get_mcp_manager),
) -> list[McpServerOut]:
    rows = (await session.execute(select(McpServer).order_by(McpServer.id))).scalars().all()
    return [server_to_out(s, manager) for s in rows]


@api_router.post("/mcp/servers", response_model=McpServerOut)
async def create_mcp_server(
    body: McpServerIn,
    user: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
    manager: McpManager = Depends(get_mcp_manager),
) -> McpServerOut:
    if body.transport == "stdio" and not body.command:
        raise HTTPException(status_code=400, detail="stdio servers require a command")
    if body.transport == "streamable_http" and not body.url:
        raise HTTPException(status_code=400, detail="streamable_http servers require a url")
    existing = (await session.execute(select(McpServer).where(McpServer.name == body.name))).scalars().first()
    if existing:
        raise HTTPException(status_code=409, detail=f"MCP server '{body.name}' already exists")
    srv = McpServer(
        name=body.name,
        description=body.description,
        transport=body.transport,
        command=body.command,
        args=body.args,
        url=body.url,
        env_encrypted=encode_kv(body.env),
        headers_encrypted=encode_kv(body.headers),
        enabled=True,
        builtin=False,
    )
    session.add(srv)
    await session.commit()
    await session.refresh(srv)
    await audit.record(session, "mcp.server_registered", actor=user.username, server_name=srv.name)
    return server_to_out(srv, manager)


@api_router.get("/mcp/servers/{server_id}", response_model=McpServerOut)
async def get_mcp_server(
    server_id: int,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    manager: McpManager = Depends(get_mcp_manager),
) -> McpServerOut:
    srv = await session.get(McpServer, server_id)
    if not srv:
        raise HTTPException(status_code=404, detail="MCP server not found")
    return server_to_out(srv, manager)


@api_router.patch("/mcp/servers/{server_id}", response_model=McpServerOut)
async def update_mcp_server(
    server_id: int,
    body: McpServerPatch,
    user: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
    manager: McpManager = Depends(get_mcp_manager),
) -> McpServerOut:
    srv = await session.get(McpServer, server_id)
    if not srv:
        raise HTTPException(status_code=404, detail="MCP server not found")
    if body.description is not None:
        srv.description = body.description
    if body.command is not None and not srv.builtin:
        srv.command = body.command
    if body.args is not None and not srv.builtin:
        srv.args = body.args
    if body.url is not None and not srv.builtin:
        srv.url = body.url
    if body.enabled is not None:
        srv.enabled = body.enabled
    if body.env is not None:
        merged = decode_kv(srv.env_encrypted)
        merged.update({k: v for k, v in body.env.items() if v != ""})
        for k, v in body.env.items():
            if v == "":
                merged.pop(k, None)
        srv.env_encrypted = encode_kv(merged)
    if body.headers is not None:
        merged_h = decode_kv(srv.headers_encrypted)
        merged_h.update({k: v for k, v in body.headers.items() if v != ""})
        srv.headers_encrypted = encode_kv(merged_h)
    await session.commit()
    await session.refresh(srv)
    await audit.record(session, "mcp.server_updated", actor=user.username, server_name=srv.name)
    return server_to_out(srv, manager)


@api_router.delete("/mcp/servers/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_mcp_server(
    server_id: int,
    user: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
    manager: McpManager = Depends(get_mcp_manager),
) -> Response:
    srv = await session.get(McpServer, server_id)
    if not srv:
        raise HTTPException(status_code=404, detail="MCP server not found")
    if srv.builtin:
        raise HTTPException(status_code=400, detail="Built-in MCP servers cannot be deleted (disable instead)")
    await manager.disconnect(srv.id)
    name = srv.name
    await session.delete(srv)
    await session.commit()
    await audit.record(session, "mcp.server_deleted", actor=user.username, server_name=name)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@api_router.post("/mcp/servers/{server_id}/connect", response_model=McpServerOut)
async def connect_mcp_server(
    server_id: int,
    user: User = Depends(require_developer_or_admin),
    session: AsyncSession = Depends(get_session),
    manager: McpManager = Depends(get_mcp_manager),
) -> McpServerOut:
    srv = await session.get(McpServer, server_id)
    if not srv:
        raise HTTPException(status_code=404, detail="MCP server not found")
    spec = await build_launch_spec(session, srv, user_id=user.id)
    try:
        await manager.connect(srv.id, srv.name, spec)
        srv.last_connected_at = datetime.now(timezone.utc)
        srv.last_error = None
        await session.commit()
        await audit.record(session, "mcp.server_connected", actor=user.username, server_name=srv.name)
    except McpError as e:
        srv.last_error = str(e)
        await session.commit()
        await audit.record(
            session,
            "mcp.server_connect_failed",
            actor=user.username,
            server_name=srv.name,
            detail={"error": str(e)},
            outcome="error",
        )
        raise HTTPException(status_code=502, detail=f"MCP connection failed: {e}") from e
    return server_to_out(srv, manager)


@api_router.post("/mcp/servers/{server_id}/disconnect", response_model=McpServerOut)
async def disconnect_mcp_server(
    server_id: int,
    user: User = Depends(require_developer_or_admin),
    session: AsyncSession = Depends(get_session),
    manager: McpManager = Depends(get_mcp_manager),
) -> McpServerOut:
    srv = await session.get(McpServer, server_id)
    if not srv:
        raise HTTPException(status_code=404, detail="MCP server not found")
    await manager.disconnect(srv.id)
    await audit.record(session, "mcp.server_disconnected", actor=user.username, server_name=srv.name)
    return server_to_out(srv, manager)


@api_router.get("/mcp/servers/{server_id}/tools", response_model=list[ToolOut])
async def list_server_tools(
    server_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    manager: McpManager = Depends(get_mcp_manager),
) -> list[ToolOut]:
    srv = await session.get(McpServer, server_id)
    if not srv:
        raise HTTPException(status_code=404, detail="MCP server not found")
    st, _, _ = manager.status(srv.id)
    if st != "connected":
        return []
    rules = list((await session.execute(select(PermissionRule))).scalars().all())
    return [format_tool(srv, t, rules, user.role) for t in manager.tools(srv.id)]


@api_router.get("/mcp/servers/{server_id}/resources", response_model=list[ResourceOut])
async def list_server_resources(
    server_id: int,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    manager: McpManager = Depends(get_mcp_manager),
) -> list[ResourceOut]:
    srv = await session.get(McpServer, server_id)
    if not srv:
        raise HTTPException(status_code=404, detail="MCP server not found")
    st, _, _ = manager.status(srv.id)
    if st != "connected":
        return []
    res = await manager.list_resources(srv.id)
    return [
        ResourceOut(uri=str(r.uri), name=r.name or str(r.uri), description=r.description or "", mime_type=r.mimeType)
        for r in res
    ]


@api_router.get("/mcp/servers/{server_id}/prompts", response_model=list[PromptOut])
async def list_server_prompts(
    server_id: int,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    manager: McpManager = Depends(get_mcp_manager),
) -> list[PromptOut]:
    srv = await session.get(McpServer, server_id)
    if not srv:
        raise HTTPException(status_code=404, detail="MCP server not found")
    st, _, _ = manager.status(srv.id)
    if st != "connected":
        return []
    prompts = await manager.list_prompts(srv.id)
    return [
        PromptOut(
            name=p.name,
            description=p.description or "",
            arguments=[
                PromptArgOut(name=a.name, description=a.description or "", required=bool(a.required))
                for a in (p.arguments or [])
            ],
        )
        for p in prompts
    ]


@api_router.get("/mcp/tools", response_model=list[ToolOut])
async def list_all_mcp_tools(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    manager: McpManager = Depends(get_mcp_manager),
) -> list[ToolOut]:
    servers = (await session.execute(select(McpServer).order_by(McpServer.id))).scalars().all()
    rules = list((await session.execute(select(PermissionRule))).scalars().all())
    out: list[ToolOut] = []
    for srv in servers:
        st, _, _ = manager.status(srv.id)
        if st == "connected":
            for t in manager.tools(srv.id):
                out.append(format_tool(srv, t, rules, user.role))
    return out


@api_router.get("/mcp/health")
async def mcp_health(
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    manager: McpManager = Depends(get_mcp_manager),
) -> dict[str, Any]:
    servers = (await session.execute(select(McpServer).order_by(McpServer.id))).scalars().all()
    items = []
    now = datetime.now(timezone.utc).isoformat()
    for srv in servers:
        st, err, _ = manager.status(srv.id)
        latency: float | None = None
        if st == "connected":
            try:
                latency = round(await manager.ping(srv.id), 2)
            except Exception as e:  # noqa: BLE001
                st = "error"
                err = str(e)
        items.append(
            {
                "id": srv.id,
                "name": srv.name,
                "status": st,
                "latency_ms": latency,
                "checked_at": now,
                "error": err or srv.last_error,
            }
        )
    return {"servers": items}


@api_router.post("/mcp/tools/call", response_model=ToolCallResult)
async def call_mcp_tool(
    body: ToolCallIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    manager: McpManager = Depends(get_mcp_manager),
) -> ToolCallResult:
    srv: McpServer | None = None
    if body.server_id is not None:
        srv = await session.get(McpServer, body.server_id)
    elif body.server_name:
        srv = (await session.execute(select(McpServer).where(McpServer.name == body.server_name))).scalars().first()
    if not srv:
        raise HTTPException(status_code=404, detail="MCP server not found")
    project = await session.get(Project, body.project_id) if body.project_id else None
    result, _ = await invoke_tool_with_policy(
        session,
        manager,
        user,
        srv,
        body.tool,
        body.arguments,
        auto_connect=True,
        project=project,
    )
    return result


@api_router.get("/mcp/resources/read")
async def read_mcp_resource(
    server_id: int,
    uri: str,
    _: User = Depends(get_current_user),
    manager: McpManager = Depends(get_mcp_manager),
) -> dict[str, Any]:
    try:
        contents = await manager.read_resource(server_id, uri)
    except McpError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"contents": contents}


# ===================================================================== CONVERSATIONS & RUNS
def _run_to_summary(run: Run) -> RunSummary:
    dur: int | None = None
    if run.finished_at and run.started_at:
        dur = max(0, int((run.finished_at - run.started_at).total_seconds() * 1000))
    return RunSummary(
        id=run.id,
        conversation_id=run.conversation_id,
        objective=run.objective,
        status=run.status,
        prompt_tokens=run.prompt_tokens,
        completion_tokens=run.completion_tokens,
        cost_usd=run.cost_usd,
        started_at=run.started_at,
        finished_at=run.finished_at,
        duration_ms=dur,
        step_count=len(run.steps or []),
    )


def _run_to_out(run: Run) -> RunOut:
    base = _run_to_summary(run)
    return RunOut(
        **base.model_dump(),
        final_summary=run.final_summary,
        error=run.error,
        steps=[StepOut.model_validate(st) for st in (run.steps or [])],
    )


@api_router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(
    project_id: int | None = None,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ConversationOut]:
    stmt = select(Conversation).where(Conversation.owner_id == user.id)
    if project_id is not None:
        stmt = stmt.where(Conversation.project_id == project_id)
    rows = (await session.execute(stmt.order_by(Conversation.id.desc()))).scalars().all()
    return [ConversationOut.model_validate(c) for c in rows]


@api_router.post("/conversations", response_model=ConversationOut)
async def create_conversation(
    body: ConversationIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ConversationOut:
    conv = Conversation(owner_id=user.id, project_id=body.project_id, title=body.title or "New conversation")
    session.add(conv)
    await session.commit()
    await session.refresh(conv)
    return ConversationOut.model_validate(conv)


@api_router.get("/conversations/{conversation_id}", response_model=ConversationDetail)
async def get_conversation(
    conversation_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ConversationDetail:
    conv = await session.get(Conversation, conversation_id)
    if not conv or (conv.owner_id != user.id and user.role != "admin"):
        raise HTTPException(status_code=404, detail="Conversation not found")
    return ConversationDetail.model_validate(conv)


@api_router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    conversation_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    conv = await session.get(Conversation, conversation_id)
    if not conv or (conv.owner_id != user.id and user.role != "admin"):
        raise HTTPException(status_code=404, detail="Conversation not found")
    await session.delete(conv)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@api_router.post("/conversations/{conversation_id}/messages", response_model=RunOut)
async def post_message(
    conversation_id: int,
    body: MessageIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    orchestrator: Orchestrator = Depends(get_orchestrator),
) -> RunOut:
    conv = await session.get(Conversation, conversation_id)
    if not conv or (conv.owner_id != user.id and user.role != "admin"):
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conv.title == "New conversation":
        conv.title = body.content[:80]
    run = Run(conversation_id=conv.id, user_id=user.id, objective=body.content, status="pending")
    session.add(run)
    await session.commit()
    await session.refresh(run)
    session.add(Message(conversation_id=conv.id, role="user", content=body.content, run_id=run.id))
    await session.commit()
    orchestrator.spawn_run(run.id)
    return _run_to_out(run)


@api_router.get("/runs", response_model=list[RunSummary])
async def list_runs(
    limit: int = Query(default=50, ge=1, le=200),
    status_filter: str | None = Query(default=None, alias="status"),
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[RunSummary]:
    stmt = select(Run)
    if status_filter:
        stmt = stmt.where(Run.status == status_filter)
    rows = (await session.execute(stmt.order_by(Run.id.desc()).limit(limit))).scalars().all()
    return [_run_to_summary(r) for r in rows]


@api_router.get("/runs/{run_id}", response_model=RunOut)
async def get_run(
    run_id: int,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RunOut:
    run = await session.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return _run_to_out(run)


@api_router.post("/runs/{run_id}/cancel", response_model=RunOut)
async def cancel_run(
    run_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    orchestrator: Orchestrator = Depends(get_orchestrator),
) -> RunOut:
    run = await session.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    orchestrator.cancel_run_task(run.id)
    if run.status not in {"completed", "failed", "cancelled"}:
        run.status = "cancelled"
        run.error = f"Cancelled by {user.username}"
        run.finished_at = datetime.now(timezone.utc)
        await session.commit()
        await session.refresh(run)
    return _run_to_out(run)


# ===================================================================== APPROVALS
async def _approval_to_out(session: AsyncSession, a: Approval) -> ApprovalOut:
    req_user = await session.get(User, a.requested_by_id)
    dec_user = await session.get(User, a.decided_by_id) if a.decided_by_id else None
    return ApprovalOut(
        id=a.id,
        run_id=a.run_id,
        server_name=a.server_name,
        tool_name=a.tool_name,
        arguments=a.arguments or {},
        risk=a.risk,
        status=a.status,
        requested_by=req_user.username if req_user else str(a.requested_by_id),
        decided_by=dec_user.username if dec_user else None,
        comment=a.comment,
        result=a.result,
        error=a.error,
        created_at=a.created_at,
        decided_at=a.decided_at,
    )


@api_router.get("/approvals", response_model=list[ApprovalOut])
async def list_approvals(
    status_filter: str | None = Query(default=None, alias="status"),
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ApprovalOut]:
    stmt = select(Approval)
    if status_filter:
        stmt = stmt.where(Approval.status == status_filter)
    rows = (await session.execute(stmt.order_by(Approval.id.desc()).limit(200))).scalars().all()
    return [await _approval_to_out(session, a) for a in rows]


@api_router.get("/approvals/{approval_id}", response_model=ApprovalOut)
async def get_approval(
    approval_id: int,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ApprovalOut:
    a = await session.get(Approval, approval_id)
    if not a:
        raise HTTPException(status_code=404, detail="Approval not found")
    return await _approval_to_out(session, a)


@api_router.post("/approvals/{approval_id}/decision", response_model=ApprovalOut)
async def decide_approval(
    approval_id: int,
    body: DecisionIn,
    user: User = Depends(require_developer_or_admin),
    session: AsyncSession = Depends(get_session),
    orchestrator: Orchestrator = Depends(get_orchestrator),
) -> ApprovalOut:
    a = await session.get(Approval, approval_id)
    if not a:
        raise HTTPException(status_code=404, detail="Approval not found")
    try:
        updated = await orchestrator.process_approval_decision(session, a, user, body.approve, body.comment)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return await _approval_to_out(session, updated)


# ===================================================================== PERMISSIONS (ADMIN)
@api_router.get("/permissions", response_model=list[RuleOut])
async def list_permissions(
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[RuleOut]:
    rows = (await session.execute(select(PermissionRule).order_by(PermissionRule.id))).scalars().all()
    return [RuleOut.model_validate(r) for r in rows]


@api_router.post("/permissions", response_model=RuleOut)
async def create_permission(
    body: RuleIn,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> RuleOut:
    rule = PermissionRule(
        role=body.role,
        server_pattern=body.server_pattern,
        tool_pattern=body.tool_pattern,
        effect=body.effect,
    )
    session.add(rule)
    await session.commit()
    await session.refresh(rule)
    await audit.record(session, "permission.created", actor=admin.username, detail=body.model_dump())
    return RuleOut.model_validate(rule)


@api_router.delete("/permissions/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_permission(
    rule_id: int,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> Response:
    rule = await session.get(PermissionRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Permission rule not found")
    await session.delete(rule)
    await session.commit()
    await audit.record(session, "permission.deleted", actor=admin.username, detail={"rule_id": rule_id})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ===================================================================== AUDIT, ANALYTICS, SETTINGS
@api_router.get("/audit", response_model=list[AuditOut])
async def list_audit(
    limit: int = Query(default=100, ge=1, le=500),
    event_type: str | None = None,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[AuditOut]:
    stmt = select(AuditEvent)
    if event_type:
        stmt = stmt.where(AuditEvent.event_type == event_type)
    rows = (await session.execute(stmt.order_by(AuditEvent.id.desc()).limit(limit))).scalars().all()
    return [AuditOut.model_validate(a) for a in rows]


@api_router.get("/analytics/summary")
async def analytics_summary(
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    manager: McpManager = Depends(get_mcp_manager),
) -> dict[str, Any]:
    servers = (await session.execute(select(McpServer))).scalars().all()
    servers_connected = sum(1 for s in servers if manager.status(s.id)[0] == "connected")
    calls = (await session.execute(select(ToolCallLog).order_by(ToolCallLog.id.desc()).limit(2000))).scalars().all()
    runs = (await session.execute(select(Run))).scalars().all()
    pending_approvals = (
        await session.execute(select(func.count(Approval.id)).where(Approval.status == "pending"))
    ).scalar_one()

    durations = sorted(c.duration_ms for c in calls)
    avg_ms = round(sum(durations) / len(durations), 1) if durations else 0.0
    p95_ms = float(durations[min(len(durations) - 1, int(len(durations) * 0.95))]) if durations else 0.0

    by_srv: dict[str, list[ToolCallLog]] = {}
    daily_map: dict[str, dict[str, Any]] = {}
    for c in calls:
        by_srv.setdefault(c.server_name, []).append(c)
        day = c.created_at.strftime("%Y-%m-%d")
        d = daily_map.setdefault(day, {"date": day, "calls": 0, "errors": 0, "tokens": 0, "cost_usd": 0.0})
        d["calls"] += 1
        if not c.ok:
            d["errors"] += 1

    for r in runs:
        day = r.started_at.strftime("%Y-%m-%d")
        d = daily_map.setdefault(day, {"date": day, "calls": 0, "errors": 0, "tokens": 0, "cost_usd": 0.0})
        d["tokens"] += (r.prompt_tokens or 0) + (r.completion_tokens or 0)
        d["cost_usd"] = round(d["cost_usd"] + (r.cost_usd or 0.0), 6)

    tools_by_server = [
        {
            "server": sname,
            "calls": len(items),
            "errors": sum(1 for x in items if not x.ok),
            "avg_ms": round(sum(x.duration_ms for x in items) / len(items), 1),
        }
        for sname, items in sorted(by_srv.items())
    ]

    recent_errors = [
        {
            "created_at": c.created_at.isoformat(),
            "server_name": c.server_name,
            "tool_name": c.tool_name,
            "error": c.error or "Tool call failed",
        }
        for c in calls
        if not c.ok
    ][:20]

    return {
        "servers_total": len(servers),
        "servers_connected": servers_connected,
        "tool_calls_total": len(calls),
        "tool_calls_failed": sum(1 for c in calls if not c.ok),
        "avg_latency_ms": avg_ms,
        "p95_latency_ms": p95_ms,
        "pending_approvals": pending_approvals,
        "runs_total": len(runs),
        "runs_failed": sum(1 for r in runs if r.status == "failed"),
        "prompt_tokens": sum(r.prompt_tokens or 0 for r in runs),
        "completion_tokens": sum(r.completion_tokens or 0 for r in runs),
        "cost_usd": round(sum(r.cost_usd or 0.0 for r in runs), 6),
        "tools_by_server": tools_by_server,
        "daily": [daily_map[k] for k in sorted(daily_map.keys())[-14:]],
        "recent_errors": recent_errors,
    }


@api_router.get("/settings")
async def get_public_settings(_: User = Depends(get_current_user)) -> dict[str, Any]:
    s = get_settings()
    return {
        "openai_configured": bool(s.openai_api_key),
        "model": s.openai_model,
        "max_steps": s.max_steps,
        "run_timeout_seconds": s.run_timeout_seconds,
        "tool_timeout_seconds": s.tool_timeout_seconds,
        "environment": s.environment,
        "github_oauth_configured": bool(s.github_client_id and s.github_client_secret),
    }


@api_router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
