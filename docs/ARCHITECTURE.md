# DevPilot System Architecture & Database ER Diagram

## 1. Layered System Architecture

DevPilot enforces strict separation between the React presentation layer, the FastAPI control plane, the AI Orchestration Engine, the MCP Client Manager, and the 7 isolated MCP servers. The AI model never receives raw external API keys and cannot bypass the MCP tool gateway or human-in-the-loop approval service.

```mermaid
flowchart TD
    User["Developer Browser (React 18 + TypeScript + Tailwind)"] -->|HTTPS / Bearer JWT| API["FastAPI Gateway & AuthN/AuthZ"]

    subgraph ControlPlane ["Backend Control Plane (backend/app)"]
        API --> Policy["RBAC & Tool Permission Policy Engine"]
        API --> Orch["AI Orchestration Engine"]
        Orch --> Gateway["Tool Execution Gateway"]
        Gateway --> Policy
        Gateway --> Approvals["Human-in-the-Loop Approval Service"]
        Gateway --> MCPMgr["MCP Client Manager (stdio & Streamable HTTP)"]
        Gateway --> Audit["Audit Trail & Secret Scrubber"]
    end

    subgraph DataLayer ["Persistence Layer"]
        PG[("PostgreSQL 16 / SQLite (Async SQLAlchemy + Alembic)")]
        API --> PG
        Orch --> PG
        Approvals --> PG
        Audit --> PG
    end

    subgraph AILayer ["External AI Provider"]
        OpenAI["OpenAI Chat Completions API (Tool Calling)"]
        Orch -->|Bounded Tool-Calling Loop| OpenAI
    end

    subgraph MCPEcosystem ["Isolated MCP Server Ecosystem (mcp_servers/*)"]
        MCPMgr -->|JSON-RPC stdio| S_FS["filesystem MCP Server (Workspace Jail & AST Code Intel)"]
        MCPMgr -->|JSON-RPC stdio| S_GH["github MCP Server (GitHub REST API v3)"]
        MCPMgr -->|JSON-RPC stdio| S_DB["database MCP Server (Read-Only SQL & Query Analyzer)"]
        MCPMgr -->|JSON-RPC stdio| S_TRM["terminal MCP Server (Allowlisted Sandbox Runner)"]
        MCPMgr -->|JSON-RPC stdio| S_TST["testing MCP Server (Pytest/Vitest/Jest & Coverage)"]
        MCPMgr -->|JSON-RPC stdio| S_DEP["deployment MCP Server (Render & Vercel APIs)"]
        MCPMgr -->|JSON-RPC stdio| S_API["apidocs MCP Server (OpenAPI Docs & SSRF-Safe Tester)"]
    end
```

---

## 2. Database Entity-Relationship (ER) Diagram

```mermaid
erDiagram
    USERS ||--o{ CREDENTIALS : owns
    USERS ||--o{ PROJECTS : owns
    USERS ||--o{ CONVERSATIONS : owns
    USERS ||--o{ RUNS : triggers
    USERS ||--o{ APPROVALS : requests_or_decides
    PROJECTS ||--o{ PROJECT_MEMORY : stores
    PROJECTS ||--o{ CONVERSATIONS : scopes
    CONVERSATIONS ||--o{ MESSAGES : contains
    CONVERSATIONS ||--o{ RUNS : executes
    RUNS ||--o{ RUN_STEPS : records
    MCP_SERVERS ||--o{ APPROVALS : targets

    USERS {
        int id PK
        string username UK
        string password_hash
        string role "admin | developer | viewer"
        datetime created_at
    }
    CREDENTIALS {
        int id PK
        int user_id FK
        string provider "github"
        string account_login
        text token_encrypted "Fernet AES"
        string scopes
        datetime created_at
    }
    PROJECTS {
        int id PK
        int owner_id FK
        string name
        text description
        string repo_full_name
        string root_path
        datetime created_at
    }
    PROJECT_MEMORY {
        int id PK
        int project_id FK
        text content
        datetime created_at
    }
    MCP_SERVERS {
        int id PK
        string name UK
        text description
        string transport "stdio | streamable_http"
        string command
        json args
        string url
        text env_encrypted "Fernet JSON"
        text headers_encrypted "Fernet JSON"
        bool enabled
        bool builtin
        text last_error
        datetime last_connected_at
        datetime created_at
    }
    CONVERSATIONS {
        int id PK
        int owner_id FK
        int project_id FK
        string title
        datetime created_at
    }
    MESSAGES {
        int id PK
        int conversation_id FK
        string role "user | assistant"
        text content
        int run_id
        datetime created_at
    }
    RUNS {
        int id PK
        int conversation_id FK
        int user_id FK
        text objective
        string status "pending|running|awaiting_approval|completed|failed|cancelled"
        text final_summary
        text error
        int prompt_tokens
        int completion_tokens
        float cost_usd
        datetime started_at
        datetime finished_at
    }
    RUN_STEPS {
        int id PK
        int run_id FK
        int index
        string kind "tool_call"
        string server_name
        string tool_name
        json arguments
        string status "running|awaiting_approval|succeeded|failed|denied"
        json result
        text error
        int duration_ms
        int approval_id
        datetime started_at
    }
    APPROVALS {
        int id PK
        int run_id
        int step_id
        int requested_by_id FK
        int server_id
        string server_name
        string tool_name
        json arguments
        string risk "read | write | destructive"
        string status "pending | denied | executed | failed"
        int decided_by_id
        text comment
        json result
        text error
        datetime created_at
        datetime decided_at
    }
    PERMISSION_RULES {
        int id PK
        string role
        string server_pattern
        string tool_pattern
        string effect "allow | deny | require_approval"
    }
    AUDIT_EVENTS {
        int id PK
        datetime created_at
        string actor
        string event_type
        string server_name
        string tool_name
        json detail
        string outcome
    }
    TOOL_CALLS {
        int id PK
        datetime created_at
        string server_name
        string tool_name
        bool ok
        int duration_ms
        text error
        int run_id
    }
```

---

## 3. Approval & Tool Execution Sequence

```mermaid
sequenceDiagram
    participant Dev as Developer UI
    participant API as FastAPI / Orchestrator
    participant Policy as Policy & Approval Service
    participant MCP as MCP Client Manager
    participant Srv as Isolated MCP Server

    Dev->>API: POST /conversations/{id}/messages ("Run tests and commit fix")
    API->>Policy: evaluate(role, server, tool, risk)
    alt Read-only tool (risk == "read")
        Policy-->>API: allow
        API->>MCP: call_tool(server_id, tool, args)
        MCP->>Srv: JSON-RPC tools/call
        Srv-->>MCP: CallToolResult
        MCP-->>API: Scrubbed result
    else Write or Destructive tool (risk in ["write", "destructive"])
        Policy-->>API: require_approval
        API->>Policy: Create Approval(status="pending")
        API-->>Dev: Run status = "awaiting_approval"
        Dev->>API: POST /approvals/{id}/decision {approve: true}
        API->>MCP: call_tool(server_id, tool, args)
        MCP->>Srv: JSON-RPC tools/call
        Srv-->>MCP: CallToolResult
        MCP-->>API: Scrubbed result -> Approval(status="executed")
        API->>API: Resume paused Run to completion
    end
```
