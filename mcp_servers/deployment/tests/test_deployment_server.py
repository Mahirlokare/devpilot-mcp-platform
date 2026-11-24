"""Tests for the Deployment MCP server (Render & Vercel) using httpx.MockTransport."""
from __future__ import annotations

import json

import httpx
import pytest
from mcp.server.fastmcp.exceptions import ToolError

from mcp_servers.deployment import server

RENDER_KEY = "rnd_secret_token_1234567890abcdef"
VERCEL_KEY = "vcel_secret_token_1234567890abcdef"


class MockProviderRouter:
    def __init__(self) -> None:
        self.routes: dict[tuple[str, str, str], list[tuple[int, object, dict[str, str]]]] = {}
        self.requests: list[httpx.Request] = []

    def add(self, host: str, method: str, path: str, status: int = 200, body: object = None, headers: dict | None = None) -> None:
        self.routes.setdefault((host, method, path), []).append((status, body, headers or {}))

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.raw_path.decode().split("?")[0]
        key = (request.url.host, request.method, path)
        specs = self.routes.get(key)
        if not specs:
            return httpx.Response(599, json={"message": f"unrouted {key}"})
        status, body, headers = specs.pop(0) if len(specs) > 1 else specs[0]
        return httpx.Response(status, json=body, headers=headers)


@pytest.fixture
def router(monkeypatch):
    monkeypatch.delenv("RENDER_API_KEY", raising=False)
    monkeypatch.delenv("VERCEL_TOKEN", raising=False)
    monkeypatch.delenv("VERCEL_TEAM_ID", raising=False)
    mock = MockProviderRouter()
    monkeypatch.setattr(
        server,
        "get_client",
        lambda: httpx.AsyncClient(transport=httpx.MockTransport(mock.handler)),
    )
    return mock


# ------------------------------------------------------------------ provider resolution & validation
async def test_no_credentials_configured_raises_error(router):
    with pytest.raises(ToolError, match="No deployment provider credentials configured"):
        await server.list_services()
    assert router.requests == []


async def test_explicit_provider_missing_key_raises_error(router, monkeypatch):
    monkeypatch.setenv("RENDER_API_KEY", RENDER_KEY)
    with pytest.raises(ToolError, match="VERCEL_TOKEN is not configured"):
        await server.list_services(provider="vercel")
    assert router.requests == []


async def test_invalid_provider_rejected(router, monkeypatch):
    monkeypatch.setenv("RENDER_API_KEY", RENDER_KEY)
    with pytest.raises(ToolError, match="Invalid provider"):
        await server.list_services(provider="heroku")  # type: ignore[arg-type]


@pytest.mark.parametrize("bad_id", ["", "../etc", "a/b", "id with space", "..", ".", "a" * 129, "srv?x=1"])
async def test_invalid_service_and_deployment_ids_rejected(router, monkeypatch, bad_id):
    monkeypatch.setenv("RENDER_API_KEY", RENDER_KEY)
    with pytest.raises(ToolError, match="Invalid service_id"):
        await server.get_service(bad_id)
    with pytest.raises(ToolError, match="Invalid deployment_id"):
        await server.get_deployment("srv-1", bad_id)
    with pytest.raises(ToolError, match="Invalid deployment_id"):
        await server.rollback("srv-1", bad_id)
    assert router.requests == []


# ------------------------------------------------------------------ Render flows
async def test_render_list_and_get_service(router, monkeypatch):
    monkeypatch.setenv("RENDER_API_KEY", RENDER_KEY)
    router.add(
        "api.render.com",
        "GET",
        "/v1/services",
        200,
        [
            {
                "service": {
                    "id": "srv-123",
                    "name": "api-backend",
                    "type": "web_service",
                    "status": "active",
                    "repo": "https://github.com/octo/api",
                    "branch": "main",
                    "updatedAt": "2025-02-01T00:00:00Z",
                    "serviceDetails": {"url": "https://api-backend.onrender.com"},
                }
            }
        ],
    )
    out = await server.list_services()
    assert out["provider"] == "render"
    assert out["count"] == 1
    assert out["services"][0]["id"] == "srv-123"
    assert out["services"][0]["url"] == "https://api-backend.onrender.com"
    assert router.requests[0].headers["authorization"] == f"Bearer {RENDER_KEY}"

    router.add(
        "api.render.com",
        "GET",
        "/v1/services/srv-123",
        200,
        {"id": "srv-123", "name": "api-backend", "type": "web_service", "status": "active"},
    )
    svc = await server.get_service("srv-123")
    assert svc["id"] == "srv-123" and svc["provider"] == "render"


async def test_render_deployments_logs_trigger_and_rollback(router, monkeypatch):
    monkeypatch.setenv("RENDER_API_KEY", RENDER_KEY)
    router.add(
        "api.render.com",
        "GET",
        "/v1/services/srv-1/deploys",
        200,
        [
            {
                "deploy": {
                    "id": "dep-1",
                    "status": "live",
                    "commit": {"id": "abc1234", "message": "ship it"},
                    "createdAt": "2025-02-01T00:00:00Z",
                    "finishedAt": "2025-02-01T00:02:00Z",
                }
            }
        ],
    )
    deps = await server.list_deployments("srv-1")
    assert deps["count"] == 1 and deps["deployments"][0]["id"] == "dep-1"
    assert deps["deployments"][0]["commit_sha"] == "abc1234"

    router.add(
        "api.render.com",
        "GET",
        "/v1/services/srv-1/deploys/dep-1",
        200,
        {"id": "dep-1", "status": "live", "commit": {"id": "abc1234", "message": "ship it"}},
    )
    dep = await server.get_deployment("srv-1", "dep-1")
    assert dep["id"] == "dep-1" and dep["status"] == "live"

    router.add(
        "api.render.com",
        "GET",
        "/v1/services/srv-1/logs",
        200,
        {
            "logs": [
                {
                    "timestamp": "2025-02-01T00:01:00Z",
                    "level": "info",
                    "message": f"Starting with key={RENDER_KEY} and password=supersecretvalue",
                }
            ]
        },
    )
    logs = await server.get_logs("srv-1", deployment_id="dep-1")
    assert logs["count"] == 1
    assert RENDER_KEY not in json.dumps(logs)
    assert "supersecretvalue" not in json.dumps(logs)

    router.add(
        "api.render.com",
        "POST",
        "/v1/services/srv-1/deploys",
        201,
        {"id": "dep-2", "status": "build_in_progress"},
    )
    trig = await server.trigger_deployment("srv-1")
    assert trig["triggered"] is True and trig["deployment"]["id"] == "dep-2"

    router.add(
        "api.render.com",
        "POST",
        "/v1/services/srv-1/rollback",
        200,
        {"id": "dep-1", "status": "live"},
    )
    rb = await server.rollback("srv-1", "dep-1")
    assert rb["rolled_back"] is True and rb["deployment_id"] == "dep-1"


# ------------------------------------------------------------------ Vercel flows
async def test_vercel_auto_selected_and_includes_team_id(router, monkeypatch):
    monkeypatch.setenv("VERCEL_TOKEN", VERCEL_KEY)
    monkeypatch.setenv("VERCEL_TEAM_ID", "team_xyz")
    router.add(
        "api.vercel.com",
        "GET",
        "/v9/projects",
        200,
        {
            "projects": [
                {
                    "id": "prj_1",
                    "name": "web-app",
                    "framework": "nextjs",
                    "link": {"repo": "octo/web", "productionBranch": "main"},
                    "targets": {"production": {"alias": ["web-app.vercel.app"]}},
                }
            ]
        },
    )
    out = await server.list_services()
    assert out["provider"] == "vercel"
    assert out["services"][0]["url"] == "https://web-app.vercel.app"
    assert router.requests[0].url.params["teamId"] == "team_xyz"

    router.add(
        "api.vercel.com",
        "GET",
        "/v6/deployments",
        200,
        {
            "deployments": [
                {
                    "uid": "dpl_99",
                    "state": "READY",
                    "url": "web-app-git-main.vercel.app",
                    "meta": {"githubCommitSha": "deadbeef", "githubCommitMessage": "feat: ui"},
                }
            ]
        },
    )
    router.add(
        "api.vercel.com",
        "GET",
        "/v2/deployments/dpl_99/events",
        200,
        [{"created": 1700000000, "type": "stdout", "payload": {"text": "Build completed"}}],
    )
    logs = await server.get_logs("prj_1")
    assert logs["deployment_id"] == "dpl_99"
    assert logs["logs"][0]["message"] == "Build completed"

    router.add(
        "api.vercel.com",
        "POST",
        "/v13/deployments",
        200,
        {"id": "dpl_100", "readyState": "QUEUED", "url": "web-app-100.vercel.app"},
    )
    trig = await server.trigger_deployment("prj_1")
    assert trig["triggered"] is True and trig["deployment"]["id"] == "dpl_100"

    router.add(
        "api.vercel.com",
        "POST",
        "/v9/projects/prj_1/rollback/dpl_99",
        200,
        {"id": "dpl_99", "state": "READY"},
    )
    rb = await server.rollback("prj_1", "dpl_99")
    assert rb["rolled_back"] is True and rb["provider"] == "vercel"


# ------------------------------------------------------------------ error handling & annotations
@pytest.mark.parametrize("code,expected", [(401, "401 Unauthorized"), (403, "403 Forbidden"), (404, "404"), (429, "429"), (502, "502")])
async def test_upstream_errors_mapped_and_scrubbed(router, monkeypatch, code, expected):
    monkeypatch.setenv("RENDER_API_KEY", RENDER_KEY)
    router.add("api.render.com", "GET", "/v1/services/srv-1", code, {"message": f"failed with {RENDER_KEY}"})
    with pytest.raises(ToolError) as exc:
        await server.get_service("srv-1")
    assert expected in str(exc.value)
    assert RENDER_KEY not in str(exc.value)


async def test_tools_registered_with_expected_annotations():
    tools = {t.name: t for t in await server.build_server().list_tools()}
    expected = {
        "list_services": (True, False),
        "get_service": (True, False),
        "list_deployments": (True, False),
        "get_deployment": (True, False),
        "get_logs": (True, False),
        "trigger_deployment": (False, False),
        "rollback": (False, True),
    }
    assert set(tools) == set(expected)
    for name, (ro, destr) in expected.items():
        ann = tools[name].annotations
        assert ann is not None
        assert ann.readOnlyHint is ro and ann.destructiveHint is destr
