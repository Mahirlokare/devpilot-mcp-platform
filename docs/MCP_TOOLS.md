# DevPilot MCP Server Ecosystem Specification

All 7 built-in MCP servers use the official Python `mcp` SDK (`FastMCP`), run as isolated child processes over `stdio` transport (or `streamable_http` for remote servers), validate inputs strictly, log exclusively to `stderr`, redact secrets from outputs, and attach `ToolAnnotations` (`readOnlyHint`, `destructiveHint`) so the backend Policy Engine can enforce human-in-the-loop approvals.

| Server Name | Module | Required Env Vars | Purpose |
|---|---|---|---|
| `filesystem` | `mcp_servers.filesystem.server` | `DEVPILOT_WORKSPACE_ROOT` | Workspace-jailed file operations & AST/heuristic code intelligence |
| `github` | `mcp_servers.github.server` | `GITHUB_TOKEN` (or connected GitHub OAuth credential) | GitHub repositories, trees, files, commits, branches, issues, PRs |
| `database` | `mcp_servers.database.server` | `DEVPILOT_PROJECT_DB_URL` | Read-only SQLite/PostgreSQL schema inspector, query runner, EXPLAIN & static analyzer |
| `terminal` | `mcp_servers.terminal.server` | `DEVPILOT_WORKSPACE_ROOT`, `DEVPILOT_TERMINAL_SANDBOX` | Sandboxed allowlisted command runner (`argv` list, no shell) |
| `testing` | `mcp_servers.testing.server` | `DEVPILOT_WORKSPACE_ROOT` | Test framework detection, test & coverage execution, failure parser |
| `deployment` | `mcp_servers.deployment.server` | `RENDER_API_KEY` and/or `VERCEL_TOKEN` | Render & Vercel service inspection, build logs, deploy trigger & rollback |
| `apidocs` | `mcp_servers.apidocs.server` | *(none)* | OpenAPI spec fetcher, summarizer, Markdown doc generator & SSRF-guarded endpoint tester |

---

## Tool Catalog & Risk Classification

- **`read`**: Auto-approved for `admin`, `developer`, and `viewer` roles unless overridden by an explicit `deny` or `require_approval` rule.
- **`write`**: Requires human approval by default (blocked for `viewer`).
- **`destructive`**: Always requires human approval (cannot be waived by an `allow` rule).

### 1. `filesystem`
- `list_directory{path?}` (`read`)
- `read_file{path}` (`read`) — refuses `.env`, private keys, binary files, and paths outside `DEVPILOT_WORKSPACE_ROOT`.
- `search_files{pattern, path?}` (`read`)
- `write_file{path, content}` (`write`) — requires approval; blocks sensitive filenames and `.git/`.
- `analyze_structure{path?}` (`read`)
- `analyze_file{path}` (`read`) — Python AST complexity, mutable default args, bare excepts, `== None`, undocumented functions.
- `find_duplicates{path?, min_lines?}` (`read`)
- `scan_security{path?}` (`read`) — detects `eval`/`exec`, `shell=True`, `pickle.loads`, weak hashes, hardcoded secrets, SQL string formatting, XSS sinks.

### 2. `github`
- `list_repositories{visibility?, limit?}` (`read`)
- `get_repository{repo}` (`read`)
- `get_repository_tree{repo, ref?}` (`read`)
- `read_file{repo, path, ref?}` (`read`)
- `list_commits{repo, branch?, limit?}` (`read`)
- `list_branches{repo}` (`read`)
- `list_issues{repo, state?}` (`read`)
- `list_pull_requests{repo, state?}` (`read`)
- `get_pull_request{repo, number}` (`read`)
- `get_repository_activity{repo}` (`read`)
- `create_branch{repo, branch, from_ref?}` (`write`)
- `commit_files{repo, branch, message, files}` (`write`) — refuses direct commits to the repository's default branch unless `DEVPILOT_GITHUB_ALLOW_DEFAULT_BRANCH_COMMITS=true`.
- `create_pull_request{repo, title, head, base, body?}` (`write`)

### 3. `database`
- `list_tables{}` (`read`)
- `describe_table{table}` (`read`)
- `run_readonly_query{sql, limit?}` (`read`) — single-statement tokenizer + read-only DB session/URI.
- `explain_query{sql}` (`read`)
- `analyze_query{sql}` (`read`)
- `generate_schema_docs{}` (`read`) — Markdown + Mermaid `erDiagram`.

### 4. `terminal`
- `run_command{argv, cwd?, timeout_seconds?}` (`write`) — allowlisted binaries (`python`, `pytest`, `pip`, `ruff`, `node`, `npm`, `npx`, `git` read-only subcommands, `tsc`), dangerous interpreter eval flags (`-c`, `-e`) blocked.

### 5. `testing`
- `detect_frameworks{path?}` (`read`)
- `run_tests{framework, path?, args?}` (`write`)
- `run_coverage{framework, path?, args?}` (`write`)
- `analyze_failures{output}` (`read`)

### 6. `deployment`
- `list_services{provider?}` (`read`)
- `get_service{provider?, service_id}` (`read`)
- `list_deployments{provider?, service_id}` (`read`)
- `get_deployment{provider?, service_id, deployment_id}` (`read`)
- `get_logs{provider?, service_id, deployment_id?}` (`read`)
- `trigger_deployment{provider?, service_id}` (`write`)
- `rollback{provider?, service_id, deployment_id}` (`destructive`)

### 7. `apidocs`
- `fetch_openapi{url}` (`read`)
- `summarize_openapi{url}` (`read`)
- `generate_api_docs{url}` (`read`)
- `test_endpoint{method, url, headers?, body?}` (`write`) — SSRF guard validates every redirect hop against private/loopback/link-local/metadata IPs.
