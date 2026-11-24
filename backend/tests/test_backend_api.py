"""Comprehensive backend integration tests: auth, RBAC, projects, MCP stdio connection, approvals, orchestrator, analytics."""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import AsyncIterator

import httpx
import pytest
import pytest_asyncio
from app.config import get_settings
from app.db import create_all, init_engine
from app.deps import get_mcp_manager, rate_limiter
from app.main import create_app


@pytest_asyncio.fixture()
async def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[httpx.AsyncClient]:
    db_file = tmp_path / "test_devpilot.db"
    ws_dir = tmp_path / "workspace"
    ws_dir.mkdir(parents=True, exist_ok=True)
    (ws_dir / "sample.py").write_text("def greet(name: str) -> str:\n    return f'hi {name}'\n", encoding="utf-8")

    monkeypatch.setenv("DEVPILOT_DATABASE_URL", f"sqlite+aiosqlite:///{db_file.as_posix()}")
    monkeypatch.setenv("DEVPILOT_WORKSPACE_ROOT", str(ws_dir))
    monkeypatch.setenv("DEVPILOT_ALLOW_REGISTRATION", "true")
    monkeypatch.setenv("DEVPILOT_OPENAI_API_KEY", "")
    get_settings.cache_clear()
    rate_limiter.reset()

    init_engine(f"sqlite+aiosqlite:///{db_file.as_posix()}")
    await create_all()

    app = create_app()
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
    await get_mcp_manager().shutdown()


@pytest.mark.asyncio
async def test_auth_rbac_projects_mcp_approvals_and_orchestrator(client: httpx.AsyncClient, tmp_path: Path) -> None:
    # 1. Public health and auth config
    r = await client.get("/api/v1/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}

    cfg = (await client.get("/api/v1/auth/config")).json()
    assert cfg["registration_open"] is True

    # 2. First user registers -> becomes admin
    reg1 = await client.post("/api/v1/auth/register", json={"username": "alice_admin", "password": "StrongPassword123!"})
    assert reg1.status_code == 200, reg1.text
    admin_tok = reg1.json()["access_token"]
    assert reg1.json()["user"]["role"] == "admin"
    admin_headers = {"Authorization": f"Bearer {admin_tok}"}

    # 3. Second user registers -> becomes developer; admin can downgrade to viewer
    reg2 = await client.post("/api/v1/auth/register", json={"username": "bob_viewer", "password": "StrongPassword123!"})
    assert reg2.status_code == 200
    bob_id = reg2.json()["user"]["id"]
    bob_tok = reg2.json()["access_token"]
    bob_headers = {"Authorization": f"Bearer {bob_tok}"}

    patch_role = await client.patch(f"/api/v1/users/{bob_id}", json={"role": "viewer"}, headers=admin_headers)
    assert patch_role.status_code == 200 and patch_role.json()["role"] == "viewer"

    # Viewer cannot create a project
    v_proj = await client.post("/api/v1/projects", json={"name": "Blocked"}, headers=bob_headers)
    assert v_proj.status_code == 403

    # 4. Admin creates a project + project memory
    p_resp = await client.post(
        "/api/v1/projects",
        json={"name": "DevPilot Core", "description": "Test project", "repo_full_name": "acme/devpilot"},
        headers=admin_headers,
    )
    assert p_resp.status_code == 200
    proj_id = p_resp.json()["id"]

    m_resp = await client.post(
        f"/api/v1/projects/{proj_id}/memory",
        json={"content": "Use async SQLAlchemy 2.0 everywhere."},
        headers=admin_headers,
    )
    assert m_resp.status_code == 200
    mems = (await client.get(f"/api/v1/projects/{proj_id}/memory", headers=admin_headers)).json()
    assert len(mems) == 1

    # 5. Built-in MCP servers registered; connect filesystem server and call read + write tools
    servers = (await client.get("/api/v1/mcp/servers", headers=admin_headers)).json()
    names = {s["name"]: s for s in servers}
    assert {"filesystem", "github", "database", "terminal", "testing", "deployment", "apidocs"} <= set(names)

    fs_id = names["filesystem"]["id"]
    conn = await client.post(f"/api/v1/mcp/servers/{fs_id}/connect", headers=admin_headers)
    assert conn.status_code == 200, conn.text
    assert conn.json()["status"] == "connected"
    assert conn.json()["tool_count"] >= 8

    # Health check pings the live stdio server
    hlth = (await client.get("/api/v1/mcp/health", headers=admin_headers)).json()
    fs_health = next(s for s in hlth["servers"] if s["name"] == "filesystem")
    assert fs_health["status"] == "connected" and fs_health["latency_ms"] is not None

    # Read tool executes immediately without approval
    call_read = await client.post(
        "/api/v1/mcp/tools/call",
        json={"server_name": "filesystem", "tool": "read_file", "arguments": {"path": "sample.py"}},
        headers=admin_headers,
    )
    assert call_read.status_code == 200
    assert call_read.json()["status"] == "succeeded"
    assert "def greet" in call_read.json()["result"]["content"]

    # Viewer is denied write tools
    viewer_write = await client.post(
        "/api/v1/mcp/tools/call",
        json={"server_name": "filesystem", "tool": "write_file", "arguments": {"path": "x.txt", "content": "no"}},
        headers=bob_headers,
    )
    assert viewer_write.status_code == 200 and viewer_write.json()["status"] == "denied"

    # Admin calling a write tool gets awaiting_approval (nothing written yet!)
    ws_dir = Path(get_settings().workspace_root)
    call_write = await client.post(
        "/api/v1/mcp/tools/call",
        json={"server_name": "filesystem", "tool": "write_file", "arguments": {"path": "notes.txt", "content": "approved text"}},
        headers=admin_headers,
    )
    assert call_write.status_code == 200
    w_data = call_write.json()
    assert w_data["status"] == "awaiting_approval"
    approval_id = w_data["approval_id"]
    assert not (ws_dir / "notes.txt").exists()

    # Approve the pending request -> file is now written
    dec = await client.post(
        f"/api/v1/approvals/{approval_id}/decision",
        json={"approve": True, "comment": "Looks safe"},
        headers=admin_headers,
    )
    assert dec.status_code == 200, dec.text
    assert dec.json()["status"] == "executed"
    assert (ws_dir / "notes.txt").read_text(encoding="utf-8") == "approved text"

    # 6. AI Workspace conversation & orchestrator run
    conv = (
        await client.post(
            "/api/v1/conversations",
            json={"project_id": proj_id, "title": "Architecture check"},
            headers=admin_headers,
        )
    ).json()
    run_resp = await client.post(
        f"/api/v1/conversations/{conv['id']}/messages",
        json={"content": "Explain the project architecture and scan for security vulnerabilities"},
        headers=admin_headers,
    )
    assert run_resp.status_code == 200
    run_id = run_resp.json()["id"]

    # Poll run until completion
    for _ in range(40):
        r_state = (await client.get(f"/api/v1/runs/{run_id}", headers=admin_headers)).json()
        if r_state["status"] in {"completed", "failed"}:
            break
        await asyncio.sleep(0.15)
    assert r_state["status"] == "completed", r_state
    assert len(r_state["steps"]) >= 2
    assert r_state["final_summary"]

    # 7. Analytics and audit log reflect actual executions
    analytics = (await client.get("/api/v1/analytics/summary", headers=admin_headers)).json()
    assert analytics["tool_calls_total"] >= 4
    assert analytics["runs_total"] >= 1

    audits = (await client.get("/api/v1/audit", headers=admin_headers)).json()
    assert any(a["event_type"] == "tool.call" for a in audits)
