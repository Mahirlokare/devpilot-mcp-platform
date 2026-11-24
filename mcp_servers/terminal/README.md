# Terminal MCP Server (`mcp_servers.terminal`)

Executes allowlisted developer commands without a shell inside a sandboxed environment.

## Environment Variables
- `DEVPILOT_WORKSPACE_ROOT` (required): Working directory jail.
- `DEVPILOT_TERMINAL_SANDBOX`: `process` (default in dev) or `docker` (required in production).
- `DEVPILOT_TERMINAL_ALLOWLIST`: Comma-separated executable names (`python,python3,pip,pytest,ruff,node,npm,npx,git,tsc`).

## Tools
| Tool | Risk | Description |
|---|---|---|
| `run_command` | write | Run `argv` list inside workspace jail with timeout, output caps, secret redaction, and flag filtering (requires approval) |
