"""Tests for the OpenAPI & Endpoint Tester MCP server (SSRF guards, $ref cycle protection, MockTransport)."""
from __future__ import annotations

import json
import socket

import httpx
import pytest
from mcp.server.fastmcp.exceptions import ToolError

from mcp_servers.apidocs import server

SAMPLE_OPENAPI = {
    "openapi": "3.0.3",
    "info": {
        "title": "Widget Service",
        "version": "1.2.0",
        "description": "Manage widgets safely.",
    },
    "servers": [{"url": "https://api.example.com/v1"}],
    "security": [{"bearerAuth": []}],
    "paths": {
        "/widgets": {
            "get": {
                "operationId": "listWidgets",
                "summary": "List all widgets",
                "tags": ["widgets"],
                "parameters": [
                    {"name": "limit", "in": "query", "required": False, "schema": {"type": "integer"}}
                ],
                "responses": {
                    "200": {
                        "description": "Widget list",
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/Widget"}
                            }
                        },
                    }
                },
            },
            "post": {
                "operationId": "createWidget",
                "summary": "Create a widget",
                "tags": ["widgets"],
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/WidgetInput"}
                        }
                    },
                },
                "responses": {"201": {"description": "Created"}},
            },
        }
    },
    "components": {
        "securitySchemes": {
            "bearerAuth": {"type": "http", "scheme": "bearer"}
        },
        "schemas": {
            "WidgetInput": {
                "type": "object",
                "required": ["name"],
                "properties": {"name": {"type": "string"}},
            },
            "Widget": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                    "parent": {"$ref": "#/components/schemas/Widget"},
                },
            },
        },
    },
}


class MockHttpRouter:
    def __init__(self) -> None:
        self.routes: dict[tuple[str, str], tuple[int, object, dict[str, str]]] = {}
        self.requests: list[httpx.Request] = []

    def add(self, method: str, url: str, status: int = 200, body: object = None, headers: dict[str, str] | None = None) -> None:
        self.routes[(method.upper(), url)] = (status, body, headers or {})

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        spec = self.routes.get((request.method, str(request.url)))
        if not spec:
            return httpx.Response(404, json={"error": f"not found: {request.method} {request.url}"})
        status, body, headers = spec
        if isinstance(body, (dict, list)):
            return httpx.Response(status, json=body, headers=headers)
        return httpx.Response(status, text=str(body or ""), headers=headers)


@pytest.fixture
def http_mock(monkeypatch):
    monkeypatch.delenv("DEVPILOT_ALLOW_PRIVATE_URLS", raising=False)

    def fake_getaddrinfo(host, port, type=0):
        h = str(host).lower()
        if h in ("localhost", "127.0.0.1"):
            ip = "127.0.0.1"
        elif h.startswith("10.") or h == "internal.corp":
            ip = "10.0.0.5"
        elif h.startswith("169.254."):
            ip = h
        else:
            ip = "93.184.216.34"
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port))]

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)
    router = MockHttpRouter()
    monkeypatch.setattr(
        server,
        "get_client",
        lambda: httpx.AsyncClient(transport=httpx.MockTransport(router.handler), follow_redirects=False),
    )
    return router


# ------------------------------------------------------------------ SSRF & Redirect protection
@pytest.mark.parametrize(
    "blocked_url",
    [
        "http://169.254.169.254/latest/meta-data/iam",
        "http://metadata.google.internal/computeMetadata/v1/",
        "http://127.0.0.1:8000/openapi.json",
        "http://localhost:8000/openapi.json",
        "http://10.0.0.5/openapi.json",
        "http://internal.corp/openapi.json",
        "file:///etc/passwd",
        "ftp://api.example.com/openapi.json",
        "https://user:secret@api.example.com/openapi.json",
    ],
)
async def test_ssrf_blocks_private_and_metadata_urls(http_mock, blocked_url):
    with pytest.raises(ToolError):
        await server.fetch_openapi(blocked_url)
    with pytest.raises(ToolError):
        await server.test_endpoint("GET", blocked_url)
    assert http_mock.requests == []


async def test_metadata_blocked_even_when_allow_private_urls_is_true(http_mock, monkeypatch):
    monkeypatch.setenv("DEVPILOT_ALLOW_PRIVATE_URLS", "true")
    for meta_url in (
        "http://169.254.169.254/latest/meta-data/",
        "http://metadata.google.internal/computeMetadata/v1/",
    ):
        with pytest.raises(ToolError, match="SSRF"):
            await server.test_endpoint("GET", meta_url)
    assert http_mock.requests == []


async def test_redirect_to_private_or_metadata_host_is_blocked(http_mock):
    http_mock.add(
        "GET",
        "https://api.example.com/openapi.json",
        302,
        "",
        {"location": "http://169.254.169.254/latest/meta-data/"},
    )
    with pytest.raises(ToolError, match="SSRF"):
        await server.fetch_openapi("https://api.example.com/openapi.json")
    assert len(http_mock.requests) == 1


async def test_redirect_limit_enforced(http_mock):
    for i in range(5):
        http_mock.add(
            "GET",
            f"https://api.example.com/step{i}",
            302,
            "",
            {"location": f"https://api.example.com/step{i + 1}"},
        )
    with pytest.raises(ToolError, match="Too many redirects"):
        await server.test_endpoint("GET", "https://api.example.com/step0")
    assert len(http_mock.requests) == 4


# ------------------------------------------------------------------ OpenAPI tools
async def test_fetch_summarize_and_generate_api_docs_with_circular_refs(http_mock):
    url = "https://api.example.com/openapi.json"
    http_mock.add("GET", url, 200, SAMPLE_OPENAPI)

    fetched = await server.fetch_openapi(url)
    assert fetched["title"] == "Widget Service"
    assert fetched["path_count"] == 1
    assert fetched["operation_count"] == 2
    assert fetched["schema_count"] == 2

    summary = await server.summarize_openapi(url)
    assert summary["endpoint_count"] == 2
    assert summary["tags"] == ["widgets"]
    assert summary["schemas"] == ["Widget", "WidgetInput"]
    assert summary["security_schemes"] == [{"name": "bearerAuth", "type": "http", "scheme": "bearer"}]

    docs = await server.generate_api_docs(url)
    assert "# Widget Service (v1.2.0)" in docs["markdown"]
    assert "### `GET /widgets`" in docs["markdown"]
    assert "### `POST /widgets`" in docs["markdown"]
    # Verify circular $ref on Widget.parent was safely broken with $circular_ref
    widget_schema = docs["schemas"]["Widget"]
    assert widget_schema["properties"]["parent"] == {"$circular_ref": "#/components/schemas/Widget"}


# ------------------------------------------------------------------ test_endpoint
async def test_test_endpoint_redacts_secrets_and_follows_safe_redirect(http_mock):
    http_mock.add(
        "POST",
        "https://api.example.com/v1/login",
        200,
        {"ok": True, " leaked": "password=supersecret12345"},
        {"set-cookie": "session=xyz123", "x-request-id": "req-1"},
    )
    res = await server.test_endpoint(
        "post",
        "https://api.example.com/v1/login",
        headers={"X-Custom": "hello"},
        body={"username": "alice"},
    )
    assert res["status_code"] == 200
    assert res["headers"]["set-cookie"] == "[REDACTED]"
    assert res["headers"]["x-request-id"] == "req-1"
    assert "supersecret12345" not in res["body"]
    assert "supersecret12345" not in json.dumps(res["json"])


async def test_test_endpoint_rejects_bad_method_and_crlf_headers(http_mock):
    with pytest.raises(ToolError, match="Invalid HTTP method"):
        await server.test_endpoint("TRACE", "https://api.example.com/v1")
    with pytest.raises(ToolError, match="CR/LF"):
        await server.test_endpoint("GET", "https://api.example.com/v1", headers={"X-Evil": "a\r\nInjected: b"})
    assert http_mock.requests == []


async def test_tools_registered_with_expected_annotations():
    tools = {t.name: t for t in await server.build_server().list_tools()}
    expected = {
        "fetch_openapi": True,
        "summarize_openapi": True,
        "generate_api_docs": True,
        "test_endpoint": False,
    }
    assert set(tools) == set(expected)
    for name, ro in expected.items():
        ann = tools[name].annotations
        assert ann is not None
        assert ann.readOnlyHint is ro
        assert ann.destructiveHint is False
