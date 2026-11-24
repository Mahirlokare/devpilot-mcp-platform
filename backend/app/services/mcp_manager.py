"""MCP client manager: owns one supervised connection (stdio subprocess or Streamable HTTP) per server.

Each connection lives inside a dedicated asyncio task because the SDK's transports use anyio cancel scopes that
must be entered and exited from the same task. Callers talk to the live ClientSession from any task.
"""
from __future__ import annotations

import asyncio
import logging
import time
from contextlib import AsyncExitStack
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from mcp import ClientSession, StdioServerParameters, types
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamablehttp_client

log = logging.getLogger("devpilot.mcp")

CONNECT_TIMEOUT = 30.0


class McpError(RuntimeError):
    pass


@dataclass
class LaunchSpec:
    transport: str  # stdio | streamable_http
    command: str | None = None
    args: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)
    cwd: str | None = None
    url: str | None = None
    headers: dict[str, str] = field(default_factory=dict)


def _describe_exception(e: BaseException) -> str:
    if isinstance(e, BaseExceptionGroup):
        return "; ".join(_describe_exception(x) for x in e.exceptions)
    return f"{type(e).__name__}: {e}"


class ManagedConnection:
    def __init__(self, server_id: int, name: str, spec: LaunchSpec):
        self.server_id, self.name, self.spec = server_id, name, spec
        self.session: ClientSession | None = None
        self.tools: list[types.Tool] = []
        self.status = "connecting"
        self.error: str | None = None
        self.connected_at: datetime | None = None
        self._task: asyncio.Task | None = None
        self._ready = asyncio.Event()
        self._stop = asyncio.Event()

    async def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name=f"mcp-{self.name}")
        try:
            await asyncio.wait_for(self._ready.wait(), CONNECT_TIMEOUT)
        except asyncio.TimeoutError:
            self.error = f"timed out after {CONNECT_TIMEOUT:.0f}s while connecting"
            self.status = "error"
            await self.stop()
        if self.status != "connected":
            raise McpError(self.error or "connection failed")

    async def _run(self) -> None:
        try:
            async with AsyncExitStack() as stack:
                if self.spec.transport == "stdio":
                    params = StdioServerParameters(command=self.spec.command or "", args=self.spec.args,
                                                   env=self.spec.env or None, cwd=self.spec.cwd)
                    read, write = await stack.enter_async_context(stdio_client(params))
                else:
                    read, write, _ = await stack.enter_async_context(
                        streamablehttp_client(self.spec.url or "", headers=self.spec.headers or None))
                session = await stack.enter_async_context(ClientSession(read, write))
                await session.initialize()
                self.tools = await _list_all_tools(session)
                self.session = session
                self.status, self.connected_at = "connected", datetime.now(timezone.utc)
                log.info("connected to MCP server %s (%d tools)", self.name, len(self.tools))
                self._ready.set()
                await self._stop.wait()
        except asyncio.CancelledError:
            raise
        except BaseException as e:  # noqa: BLE001 - report any transport failure
            self.error = _describe_exception(e)
            self.status = "error"
            log.error("MCP server %s failed: %s", self.name, self.error)
        finally:
            self.session = None
            if self.status == "connected":
                self.status = "disconnected"
            self._ready.set()

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            try:
                await asyncio.wait_for(asyncio.shield(self._task), 10)
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception):  # noqa: BLE001
                self._task.cancel()
                try:
                    await self._task
                except BaseException:  # noqa: BLE001
                    pass
        self.session = None
        if self.status != "error":
            self.status = "disconnected"

    @property
    def alive(self) -> bool:
        return self.status == "connected" and self.session is not None and self._task is not None and not self._task.done()


async def _list_all_tools(session: ClientSession) -> list[types.Tool]:
    tools: list[types.Tool] = []
    cursor = None
    for _ in range(20):  # pagination bound
        res = await session.list_tools(cursor)
        tools.extend(res.tools)
        cursor = res.nextCursor
        if not cursor:
            break
    return tools


class McpManager:
    def __init__(self) -> None:
        self._conns: dict[int, ManagedConnection] = {}
        self._locks: dict[int, asyncio.Lock] = {}

    def _lock(self, server_id: int) -> asyncio.Lock:
        return self._locks.setdefault(server_id, asyncio.Lock())

    def get(self, server_id: int) -> ManagedConnection | None:
        return self._conns.get(server_id)

    def status(self, server_id: int) -> tuple[str, str | None, int]:
        c = self._conns.get(server_id)
        if c is None:
            return "disconnected", None, 0
        if c.status == "connected" and not c.alive:
            c.status, c.error = "error", c.error or "connection lost"
        return c.status, c.error, len(c.tools) if c.status == "connected" else 0

    async def connect(self, server_id: int, name: str, spec: LaunchSpec) -> ManagedConnection:
        async with self._lock(server_id):
            old = self._conns.pop(server_id, None)
            if old:
                await old.stop()
            conn = ManagedConnection(server_id, name, spec)
            self._conns[server_id] = conn  # keep it so the error state is visible
            await conn.start()
            return conn

    async def disconnect(self, server_id: int) -> None:
        async with self._lock(server_id):
            conn = self._conns.pop(server_id, None)
            if conn:
                await conn.stop()

    async def shutdown(self) -> None:
        await asyncio.gather(*(self.disconnect(i) for i in list(self._conns)), return_exceptions=True)

    def _require(self, server_id: int) -> ManagedConnection:
        c = self._conns.get(server_id)
        if c is None or not c.alive:
            raise McpError("server is not connected")
        return c

    def tools(self, server_id: int) -> list[types.Tool]:
        return list(self._require(server_id).tools)

    async def refresh_tools(self, server_id: int) -> list[types.Tool]:
        c = self._require(server_id)
        assert c.session is not None
        c.tools = await _list_all_tools(c.session)
        return list(c.tools)

    async def call_tool(self, server_id: int, tool: str, arguments: dict[str, Any], timeout: float) -> types.CallToolResult:
        c = self._require(server_id)
        assert c.session is not None
        try:
            return await asyncio.wait_for(c.session.call_tool(tool, arguments, read_timeout_seconds=None), timeout)
        except asyncio.TimeoutError as e:
            raise McpError(f"tool call timed out after {timeout:.0f}s") from e

    async def list_resources(self, server_id: int) -> list[types.Resource]:
        c = self._require(server_id)
        assert c.session is not None
        if c.session.get_server_capabilities() is None or not c.session.get_server_capabilities().resources:
            return []
        return list((await c.session.list_resources()).resources)

    async def list_prompts(self, server_id: int) -> list[types.Prompt]:
        c = self._require(server_id)
        assert c.session is not None
        caps = c.session.get_server_capabilities()
        if caps is None or not caps.prompts:
            return []
        return list((await c.session.list_prompts()).prompts)

    async def read_resource(self, server_id: int, uri: str) -> list[dict[str, str]]:
        c = self._require(server_id)
        assert c.session is not None
        res = await c.session.read_resource(uri)  # type: ignore[arg-type]
        out = []
        for item in res.contents:
            text = getattr(item, "text", None)
            out.append({"uri": str(item.uri), "text": text if text is not None else "[binary content omitted]"})
        return out

    async def ping(self, server_id: int) -> float:
        c = self._require(server_id)
        assert c.session is not None
        t0 = time.monotonic()
        await asyncio.wait_for(c.session.send_ping(), 10)
        return (time.monotonic() - t0) * 1000
