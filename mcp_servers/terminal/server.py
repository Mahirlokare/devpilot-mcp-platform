"""Terminal MCP server: run allowlisted commands (no shell) in a sandbox. See runner.py for the threat model."""
from __future__ import annotations

import logging
from typing import Annotated, Any

from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from pydantic import Field

from mcp_servers.common import WRITE, configure_logging, workspace_root
from mcp_servers.terminal.runner import CommandRejected, enforce_sandbox_policy, run_sandboxed

log = logging.getLogger("devpilot.terminal")


async def run_command(
    argv: Annotated[list[str], Field(description="Command and arguments as a list, e.g. ['pytest','-q']. No shell syntax.")],
    cwd: Annotated[str, Field(description="Working directory relative to the workspace root")] = ".",
    timeout_seconds: Annotated[int, Field(ge=1, le=600)] = 60,
) -> dict[str, Any]:
    try:
        result = await run_sandboxed(argv, cwd, timeout_seconds)
    except CommandRejected as e:
        log.warning("rejected command %r: %s", argv, e)
        raise ToolError(f"Command rejected: {e}") from e
    return result.to_dict()


def build_server() -> FastMCP:
    mcp = FastMCP("devpilot-terminal",
                  instructions="Run allowlisted developer commands inside the workspace sandbox. No shell; pass argv as a list.")
    mcp.tool(
        annotations=WRITE,
        description="Run an allowlisted command (python/pytest/pip/node/npm/npx/git(read-only)/ruff/tsc) inside the "
                    "workspace sandbox with timeout and output caps. Captures stdout, stderr and exit code. Requires approval.",
    )(run_command)
    return mcp


def main() -> None:
    configure_logging("devpilot.terminal")
    enforce_sandbox_policy()
    workspace_root()
    build_server().run(transport="stdio")


if __name__ == "__main__":
    main()
