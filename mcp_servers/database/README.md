# DevPilot Database MCP Server (`mcp_servers.database`)

Read-only FastMCP stdio server for inspecting SQLite and PostgreSQL databases, running guarded read-only queries, inspecting `EXPLAIN` plans, analyzing SQL performance anti-patterns, and generating Markdown + Mermaid `erDiagram` schema documentation.

## Configuration

| Environment Variable | Required | Description |
|---|---|---|
| `DEVPILOT_PROJECT_DB_URL` | Yes | `sqlite:///path/to/db.sqlite` or `postgresql://user:pass@host:port/dbname` |
| `DEVPILOT_MCP_LOG_LEVEL` | No | Logging level emitted to `stderr` (default: `INFO`). |

## Security Model

1. **Read-only driver enforcement**:
   - SQLite connections use `file:...?mode=ro` URI mode and `PRAGMA query_only = ON`.
   - PostgreSQL connections run inside `BEGIN READ ONLY` with `SET LOCAL statement_timeout = '5000ms'` and always `ROLLBACK`.
2. **Single-statement SQL tokenizer**:
   - Strips comments and string/identifier literals, rejects multiple statements (`;`), and verifies queries start with `SELECT`, `WITH`, `EXPLAIN`, or `VALUES` (plus `SHOW` on PostgreSQL).
   - Rejects mutating, DDL, administrative, locking, file-access, and sleep tokens anywhere in the query (including inside CTEs).

## Tools

All tools are read-only (`readOnlyHint=True`):
- `list_tables`
- `describe_table`
- `run_readonly_query`
- `explain_query`
- `analyze_query`
- `generate_schema_docs`

## Running

```bash
python -m mcp_servers.database.server
```
