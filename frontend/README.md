# DevPilot Frontend

React 18 + TypeScript + Vite + Tailwind CSS single-page application for the DevPilot MCP-powered AI developer platform.

## Features & Pages

- **Authentication (`/login`)**: Sign in or register against `/api/v1/auth/*`, with central HTTP 401 session expiration handling and role-aware (`admin`, `developer`, `viewer`) UI controls.
- **Dashboard (`/`)**: Live platform metrics, daily tool call chart, recent tool errors, recent agent runs, and API health indicator.
- **AI Workspace (`/workspace`, `/workspace/:conversationId`)**: Multi-conversation chat workspace with project scoping and real-time 1s polling of background agent runs (`pending`, `running`, `awaiting_approval`, `completed`, `failed`, `cancelled`), step cards, and inline approval actions.
- **Projects & Memory (`/projects`)**: Full CRUD for projects (`repo_full_name`, `root_path`) and persistent project memory notes.
- **GitHub Integration (`/github`)**: GitHub OAuth status/connect/disconnect and repository explorer (files, pull requests, issues, commits, branches, activity) powered by the `github` MCP server.
- **MCP Server Manager (`/mcp`)**: Register, edit, enable/disable, connect/disconnect, health-ping, and inspect tools, resources, and prompts across built-in and custom (`stdio` / `streamable_http`) MCP servers.
- **Tool Explorer (`/tools`)**: Search and filter all tools across connected MCP servers by server or risk level (`read`, `write`, `destructive`), inspect JSON schemas, and invoke tools manually with full `awaiting_approval` lifecycle polling.
- **Database Explorer (`/database`)**: Browse tables, inspect table columns, execute read-only SQL queries, run `EXPLAIN` / `ANALYZE`, and generate schema docs via the `database` MCP server.
- **Code Analysis (`/analysis`)**: Run `analyze_structure`, `scan_security`, `find_duplicates`, and `analyze_file` on the `filesystem` MCP server.
- **Testing Center (`/testing`)**: Detect test frameworks, run test suites or coverage with approval gating, and analyze test failure outputs via the `testing` MCP server.
- **Deployment Center (`/deployments`)**: List services and deployments, inspect deployment logs, trigger deployments, and roll back releases via the `deployment` MCP server.
- **Execution History (`/history`, `/history/:runId`)**: Filterable run history list with detailed step breakdown, token counts, and costs.
- **Approvals (`/approvals`)**: Filter pending/decided tool approvals, approve or deny with comments, and inspect post-approval execution results.
- **Usage & Analytics (`/usage`)**: Summary KPIs, per-server call/error/latency breakdown, daily calls/tokens/cost charts, recent errors, and filterable audit log table.
- **Settings (`/settings`)**: Runtime configuration viewer, admin user role management (`GET /users`, `PATCH /users/{id}`), and admin fnmatch permission rules CRUD (`GET /permissions`, `POST /permissions`, `DELETE /permissions/{id}`).

## Development

```bash
npm install
npm run dev
```

The Vite dev server runs on `http://localhost:5173` and proxies `/api` to `http://localhost:8000` (configurable via `VITE_API_BASE`).

## Verification

```bash
npx tsc --noEmit
npm test
npm run build
```
