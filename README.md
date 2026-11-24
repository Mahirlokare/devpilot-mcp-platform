# DevPilot — AI Developer Platform Powered by Model Context Protocol (MCP)

**DevPilot** is a modular, production-oriented AI Developer Platform that connects developer workflows, repositories, databases, sandboxes, test suites, OpenAPI specs, and cloud deployment providers through the official **Model Context Protocol (MCP)**.

Every external operation is executed through an isolated MCP server, governed by Role-Based Access Control (RBAC), tool-level risk policies, human-in-the-loop approvals for write/destructive actions, secret scrubbing, and an immutable audit trail.

---

## Key Capabilities & Product Modules

1. **AI Workspace & Orchestration Engine** (`/workspace`)
   - Multi-step task planning and tool execution over connected MCP servers.
   - Works with **OpenAI tool-calling** (`gpt-4o` by default) when `DEVPILOT_OPENAI_API_KEY` is configured, and includes a **deterministic MCP intent planner fallback** when running offline or without an OpenAI key.
   - Displays live execution steps, selected MCP server & tool, JSON arguments, execution duration, token & cost metrics, and inline **Approve / Deny** controls when a step requires human approval.
2. **MCP Server Manager & Tool Explorer** (`/mcp`, `/tools`)
   - Auto-registers 7 built-in MCP servers (`filesystem`, `github`, `database`, `terminal`, `testing`, `deployment`, `apidocs`) and supports registering custom `stdio` or `streamable_http` MCP servers.
   - Live connection lifecycle (`connect`, `disconnect`, `send_ping` latency health checks), tool schema explorer, resource reader, and manual tool invocation with approval handling.
3. **GitHub Integration** (`/github`)
   - OAuth 2.0 connection flow (Fernet-encrypted token storage) + PAT support (`GITHUB_TOKEN`).
   - Repository browser, recursive git tree viewer, source file reader, commits, branches, issues, pull requests with patch diffs, branch creation, multi-file git data API commits (protected against direct default-branch commits), and PR creation.
4. **Code Intelligence & Filesystem Analysis** (`/analysis`)
   - Jailed to `DEVPILOT_WORKSPACE_ROOT` with symlink/path-traversal protection and sensitive-file blocking.
   - Repository structure & LOC analyzer, Python AST complexity & bug-pattern analyzer, duplicate code block finder, and heuristic security scanner.
5. **Database Assistant** (`/database`)
   - Read-only inspection of SQLite (`mode=ro` + `PRAGMA query_only=ON`) and PostgreSQL (`BEGIN READ ONLY`) databases.
   - Single-statement SQL tokenizer blocking mutation/admin keywords, interactive query runner, `EXPLAIN` plan viewer, static query performance analyzer, and Markdown + Mermaid ER schema documentation generator.
6. **Sandboxed Terminal & Testing Center** (`/testing`)
   - Allowlisted executable runner (`create_subprocess_exec`, no shell, blocked eval flags, timeout & output caps, Docker container isolation mode for production).
   - Automatic framework detection (`pytest`, `vitest`, `jest`, `npm`), test suite & coverage execution with approval gating, and failure diagnostics.
7. **Deployment Center** (`/deployments`)
   - Unified **Render** and **Vercel** integration: list services, inspect deployment history and build logs, trigger deployments (`write` approval), and roll back deployments (`destructive` approval).
8. **Security, Approvals & Analytics** (`/approvals`, `/settings`, `/usage`, `/history`)
   - `admin`, `developer`, and `viewer` roles + fnmatch permission rules (`allow`, `deny`, `require_approval`).
   - Full execution history, tool latency percentiles (avg & p95), token/cost tracking, error feeds, and scrubbed audit logs.

---

## Repository Structure

```text
devpilot/
├── backend/
│   ├── alembic/                  # Async Alembic migrations (0001_initial)
│   ├── app/
│   │   ├── api/routes.py         # FastAPI v1 REST endpoints
│   │   ├── services/
│   │   │   ├── audit.py          # Audit trail & recursive secret scrubbing
│   │   │   ├── mcp_manager.py    # Supervised stdio & Streamable HTTP MCP sessions
│   │   │   ├── orchestrator.py   # Bounded AI orchestration loop & approval resumption
│   │   │   ├── policy.py         # RBAC & tool risk classification engine
│   │   │   └── tool_gateway.py   # Built-in registry & policy-enforced tool gateway
│   │   ├── config.py             # Pydantic settings (DEVPILOT_* env vars)
│   │   ├── db.py                 # Async SQLAlchemy 2.0 engine & session factory
│   │   ├── deps.py               # JWT auth, RBAC dependencies, sliding-window rate limiter
│   │   ├── main.py               # FastAPI app factory & lifespan manager
│   │   ├── models.py             # SQLAlchemy ORM models
│   │   ├── schemas.py            # Strict Pydantic v2 request/response schemas
│   │   └── security.py           # scrypt password hashing, HS256 JWT, Fernet encryption
│   ├── tests/                    # Backend integration tests
│   ├── Dockerfile
│   └── pyproject.toml
├── mcp_servers/
│   ├── common/guards.py          # Path jail, SSRF guard, secret redaction, ToolAnnotations
│   ├── filesystem/               # Workspace file ops & code intelligence MCP server + tests
│   ├── github/                   # GitHub REST v3 MCP server + tests
│   ├── database/                 # Read-only SQL & query analyzer MCP server + tests
│   ├── terminal/                 # Sandboxed command runner MCP server + tests
│   ├── testing/                  # Test & coverage runner MCP server + tests
│   ├── deployment/               # Render & Vercel deployment MCP server + tests
│   └── apidocs/                  # OpenAPI doc generator & SSRF-safe endpoint tester + tests
├── frontend/
│   ├── src/
│   │   ├── api/                  # Typed fetch client, 401 handler, REST endpoints
│   │   ├── components/           # Layout, RunPanel, StepCard, SchemaForm, ApprovalActions, etc.
│   │   ├── hooks/                # useAuth, useAsync, useToolCall, useToolQuery
│   │   ├── pages/                # 15 developer UI pages
│   │   └── __tests__/            # Vitest unit tests
│   ├── Dockerfile
│   └── package.json
├── docs/
│   ├── API_CONTRACT.md           # Internal REST API & MCP tool contract
│   ├── ARCHITECTURE.md           # Mermaid system architecture, ER diagram & sequence flows
│   ├── MCP_TOOLS.md              # MCP server catalog, required env vars & risk tiers
│   ├── SECURITY.md               # Threat model & defense-in-depth controls
│   └── DEPLOYMENT.md             # Local setup, Docker Compose & Render/Vercel deployment guide
├── .github/workflows/ci.yml      # GitHub Actions CI pipeline
├── docker-compose.yml            # PostgreSQL 16 (pgvector), Redis, Backend, Frontend
└── .env.example
```

---

## Quick Start

```bash
# 1. Backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1   # or: source .venv/bin/activate
pip install -e "./backend[dev]"
cd backend && uvicorn app.main:app --reload --port 8000

# 2. Frontend (in a second terminal)
cd frontend
npm install
npm run dev
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for full setup and deployment instructions, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for system and ER diagrams, [docs/MCP_TOOLS.md](docs/MCP_TOOLS.md) for MCP tool documentation, and [docs/SECURITY.md](docs/SECURITY.md) for the security architecture.
