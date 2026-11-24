# DevPilot Deployment MCP Server (`mcp_servers.deployment`)

FastMCP stdio server for inspecting services, deployments, and logs, and for triggering or rolling back deployments across **Render** and **Vercel**.

## Configuration

| Environment Variable | Required | Description |
|---|---|---|
| `RENDER_API_KEY` | One of Render/Vercel | Render API bearer key (`https://api.render.com/v1`). |
| `VERCEL_TOKEN` | One of Render/Vercel | Vercel API bearer token (`https://api.vercel.com`). |
| `VERCEL_TEAM_ID` | No | Optional Vercel `teamId` query parameter attached to Vercel API requests. |
| `DEVPILOT_MCP_LOG_LEVEL` | No | Logging level emitted to `stderr` (default: `INFO`). |

If `provider` is omitted in a tool call, the server defaults to whichever provider has credentials configured (`render` first, then `vercel`).

## Tools

- **Read (`readOnlyHint=True`)**: `list_services`, `get_service`, `list_deployments`, `get_deployment`, `get_logs`
- **Write (`readOnlyHint=False`, requires approval)**: `trigger_deployment`
- **Destructive (`destructiveHint=True`, requires approval)**: `rollback`

## Running

```bash
python -m mcp_servers.deployment.server
```
