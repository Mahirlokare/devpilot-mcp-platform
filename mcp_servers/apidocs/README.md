# DevPilot API Docs MCP Server (`mcp_servers.apidocs`)

FastMCP stdio server for fetching OpenAPI 3.x / Swagger 2.0 specifications, summarizing endpoints and schemas, generating Markdown documentation with cycle-safe `$ref` resolution, and testing live HTTP endpoints with full SSRF protection.

## Configuration

| Environment Variable | Required | Description |
|---|---|---|
| `DEVPILOT_ALLOW_PRIVATE_URLS` | No | Set to `true` to allow loopback/private network URLs for local development (cloud metadata hosts like `169.254.169.254` and `metadata.google.internal` remain unconditionally blocked). |
| `DEVPILOT_MCP_LOG_LEVEL` | No | Logging level emitted to `stderr` (default: `INFO`). |

## Security Model

- **SSRF Protection on Every Hop**: Every outbound URL and manual redirect hop (maximum 3 redirects) is validated with `assert_public_url` and checked against a strict cloud metadata blocklist (`169.254.169.254`, `metadata.google.internal`, link-local IPs).
- **Cycle-Safe `$ref` Resolution**: Local JSON pointers (`#/components/schemas/...`) track visited references per branch to prevent infinite recursion on self-referential schemas.
- **Credential Redaction**: Response bodies and headers pass through `redact()` and sensitive headers (`Set-Cookie`, `Authorization`, `Cookie`) are scrubbed.

## Tools

- **Read (`readOnlyHint=True`)**: `fetch_openapi`, `summarize_openapi`, `generate_api_docs`
- **Write (`readOnlyHint=False`, requires approval)**: `test_endpoint`

## Running

```bash
python -m mcp_servers.apidocs.server
```
