# DevPilot Internal API Contract (v1)

Base URL: `/api/v1`. JSON everywhere. Auth: `Authorization: Bearer <access_token>` on everything except
`/auth/login`, `/auth/register`, `/health`. Errors: HTTP 4xx/5xx with `{"detail": "..."}` (422 -> `detail` is a list).
All timestamps are ISO-8601 UTC strings. IDs are integers.

## Auth
| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/register` | `{username, password}` (password >= 10 chars) | `TokenResponse` (first user becomes `admin`; later registrations only if enabled) |
| POST | `/auth/login` | `{username, password}` | `TokenResponse` |
| GET | `/auth/me` | | `User` |
| GET | `/auth/config` (public) | | `{registration_open: bool, github_oauth_configured: bool}` |

`TokenResponse = {access_token, token_type: "bearer", user: User}`
`User = {id, username, role: "admin"|"developer"|"viewer", created_at}`

## Users (admin)
`GET /users` -> `User[]`; `PATCH /users/{id}` `{role}` -> `User`.

## GitHub OAuth
`GET /integrations/github/authorize` -> `{authorize_url}`; `GET /integrations/github/callback?code&state` (browser redirect, stores encrypted token);
`GET /integrations/github/status` -> `{connected: bool, login: string|null}`; `DELETE /integrations/github` -> 204.

## Projects
`Project = {id, name, description, repo_full_name: string|null, root_path: string|null, created_at}`
`GET /projects`, `POST /projects` `{name, description?, repo_full_name?, root_path?}`, `GET|PATCH|DELETE /projects/{id}`.
Memory: `GET /projects/{id}/memory` -> `Memory[]`; `POST /projects/{id}/memory` `{content}` -> `Memory`; `DELETE /projects/{id}/memory/{mid}`.
`Memory = {id, project_id, content, created_at}`

## MCP management
`McpServer = {id, name, description, transport: "stdio"|"streamable_http", command: string|null, args: string[], url: string|null,
 env_keys: string[] (names only, values never returned), enabled, builtin, status: "disconnected"|"connecting"|"connected"|"error",
 last_error: string|null, last_connected_at, tool_count, created_at}`
- `GET /mcp/servers`, `POST /mcp/servers` `{name, description?, transport, command?, args?, url?, env?: {K:V}, headers?: {K:V}}`
- `GET|PATCH|DELETE /mcp/servers/{id}`
- `POST /mcp/servers/{id}/connect` -> `McpServer`; `POST /mcp/servers/{id}/disconnect` -> `McpServer`
- `GET /mcp/servers/{id}/tools` -> `Tool[]`; `/resources` -> `Resource[]`; `/prompts` -> `Prompt[]`
- `GET /mcp/tools` -> `Tool[]` across connected servers.
- `GET /mcp/health` -> `{servers: [{id, name, status, latency_ms: number|null, checked_at, error}]}` (performs live ping)
- `POST /mcp/tools/call` `{server_id? , server_name?, tool, arguments, project_id?}` -> `ToolCallResult`
- `GET /mcp/resources/read?server_id&uri` -> `{contents: [{uri, text}]}`

`Tool = {server_id, server_name, name, description, input_schema (JSON Schema), risk: "read"|"write"|"destructive", requires_approval: bool}`
`Resource = {uri, name, description, mime_type}`; `Prompt = {name, description, arguments: [{name, description, required}]}`
`ToolCallResult = {status: "succeeded"|"failed"|"awaiting_approval"|"denied", result: any|null, error: string|null,
 approval_id: number|null, duration_ms: number|null}` — when `awaiting_approval`, nothing executed; the user must approve in the Approvals page,
 after which the call is executed and the result is stored on the approval (`Approval.result`).

## Conversations and runs (AI workspace)
`Conversation = {id, project_id, title, created_at}`; `Message = {id, role: "user"|"assistant", content, run_id, created_at}`
- `GET /conversations?project_id=`; `POST /conversations` `{project_id?, title?}`; `GET /conversations/{id}` -> `Conversation & {messages: Message[]}`; `DELETE /conversations/{id}`
- `POST /conversations/{id}/messages` `{content}` -> `Run` (status `pending`; executes in background — **poll** `GET /runs/{id}` every ~1s while status in pending/running/awaiting_approval)
- `GET /runs?limit=&status=` -> `RunSummary[]`; `GET /runs/{id}` -> `Run`; `POST /runs/{id}/cancel` -> `Run`

`RunSummary = {id, conversation_id, objective, status, prompt_tokens, completion_tokens, cost_usd, started_at, finished_at, duration_ms, step_count}`
`Run = RunSummary & {final_summary: string|null, error: string|null, steps: Step[]}`
`status: "pending"|"running"|"awaiting_approval"|"completed"|"failed"|"cancelled"`
`Step = {id, index, kind: "tool_call"|"llm"|"summary", server_name, tool_name, arguments, status: "running"|"awaiting_approval"|"succeeded"|"failed"|"denied",
 result: any|null, error: string|null, duration_ms, approval_id: number|null, started_at}`

## Approvals
`Approval = {id, run_id: number|null, server_name, tool_name, arguments, risk, status: "pending"|"approved"|"denied"|"executed"|"failed"|"expired",
 requested_by, decided_by, comment, result: any|null, error: string|null, created_at, decided_at}`
`GET /approvals?status=` ; `GET /approvals/{id}`; `POST /approvals/{id}/decision` `{approve: bool, comment?}` -> `Approval` (admin or developer; viewers read-only).

## Permissions (admin)
`Rule = {id, role: "admin"|"developer"|"viewer"|"*", server_pattern, tool_pattern, effect: "allow"|"deny"|"require_approval"}` (fnmatch patterns)
`GET /permissions`, `POST /permissions`, `DELETE /permissions/{id}`.

## Audit / analytics / settings
- `GET /audit?limit=&event_type=` -> `AuditEvent[]` = `{id, created_at, actor, event_type, server_name, tool_name, detail (object), outcome}`
- `GET /analytics/summary` -> `{servers_total, servers_connected, tool_calls_total, tool_calls_failed, avg_latency_ms, p95_latency_ms, pending_approvals,
   runs_total, runs_failed, prompt_tokens, completion_tokens, cost_usd, tools_by_server: [{server, calls, errors, avg_ms}],
   daily: [{date, calls, errors, tokens, cost_usd}], recent_errors: [{created_at, server_name, tool_name, error}]}`
- `GET /settings` -> `{openai_configured, model, max_steps, run_timeout_seconds, tool_timeout_seconds, environment, github_oauth_configured}`
- `GET /health` -> `{status: "ok"}`

## Built-in MCP server names and tools (frontend explorers call these via `/mcp/tools/call` with `server_name`)
- `github`: `list_repositories{visibility?,limit?}`, `get_repository{repo}`, `get_repository_tree{repo,ref?}`, `read_file{repo,path,ref?}`, `list_commits{repo,branch?,limit?}`,
  `list_branches{repo}`, `list_issues{repo,state?}`, `list_pull_requests{repo,state?}`, `get_pull_request{repo,number}`, `get_repository_activity{repo}`,
  `create_branch{repo,branch,from_ref?}`*, `commit_files{repo,branch,message,files:[{path,content}]}`*, `create_pull_request{repo,title,head,base,body?}`*
- `filesystem` (jailed to project root): `list_directory{path?}`, `read_file{path}`, `search_files{pattern,path?}`, `write_file{path,content}`*,
  `analyze_structure{path?}`, `analyze_file{path}`, `find_duplicates{path?}`, `scan_security{path?}`
- `database`: `list_tables{}`, `describe_table{table}`, `run_readonly_query{sql,limit?}`, `explain_query{sql}`, `analyze_query{sql}`, `generate_schema_docs{}`
- `terminal`: `run_command{argv: string[], cwd?, timeout_seconds?}`*  (allowlisted executables; no shell)
- `testing`: `detect_frameworks{path?}`, `run_tests{framework,path?,args?}`*, `run_coverage{framework,path?}`*, `analyze_failures{output}`
- `deployment`: `list_services{provider?}`, `get_service{provider?,service_id}`, `list_deployments{provider?,service_id}`, `get_deployment{provider?,service_id,deployment_id}`,
  `get_logs{provider?,service_id,deployment_id?}`, `trigger_deployment{provider?,service_id}`*, `rollback{provider?,service_id,deployment_id}`** (provider: "render"|"vercel")
- `apidocs`: `fetch_openapi{url}`, `summarize_openapi{url}`, `generate_api_docs{url}`, `test_endpoint{method,url,headers?,body?}`
(* = write, requires approval; ** = destructive)
