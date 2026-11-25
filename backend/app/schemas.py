"""Pydantic request/response schemas (see docs/API_CONTRACT.md)."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Role = Literal["admin", "developer", "viewer"]
_USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,64}$")


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---- auth ----
class Credentials(BaseModel):
    username: str
    password: str = Field(min_length=1, max_length=256)

    @field_validator("username")
    @classmethod
    def _u(cls, v: str) -> str:
        if not _USERNAME_RE.match(v):
            raise ValueError("username must be 3-64 chars: letters, digits, _ . -")
        return v


class RegisterRequest(Credentials):
    password: str = Field(min_length=10, max_length=256)


class UserOut(ORM):
    id: int
    username: str
    role: Role
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class UserRoleUpdate(BaseModel):
    role: Role


# ---- projects ----
class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=5000)
    repo_full_name: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
    root_path: str | None = Field(default=None, max_length=500)


class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=5000)
    repo_full_name: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
    root_path: str | None = Field(default=None, max_length=500)


class ProjectOut(ORM):
    id: int
    name: str
    description: str
    repo_full_name: str | None
    root_path: str | None
    created_at: datetime


class MemoryIn(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


class MemoryOut(ORM):
    id: int
    project_id: int
    content: str
    created_at: datetime


# ---- MCP ----
_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


class McpServerIn(BaseModel):
    name: str
    description: str = Field(default="", max_length=2000)
    transport: Literal["stdio", "streamable_http"]
    command: str | None = Field(default=None, max_length=500)
    args: list[str] = Field(default_factory=list, max_length=50)
    url: str | None = Field(default=None, max_length=500)
    env: dict[str, str] = Field(default_factory=dict)
    headers: dict[str, str] = Field(default_factory=dict)

    @field_validator("name")
    @classmethod
    def _n(cls, v: str) -> str:
        if not _NAME_RE.match(v):
            raise ValueError("name must be lowercase letters/digits/-/_ (max 64)")
        return v


class McpServerPatch(BaseModel):
    description: str | None = None
    command: str | None = None
    args: list[str] | None = None
    url: str | None = None
    env: dict[str, str] | None = None
    headers: dict[str, str] | None = None
    enabled: bool | None = None


class McpServerOut(BaseModel):
    id: int
    name: str
    description: str
    transport: str
    command: str | None
    args: list[str]
    url: str | None
    env_keys: list[str]
    enabled: bool
    builtin: bool
    status: str
    last_error: str | None
    last_connected_at: datetime | None
    tool_count: int
    created_at: datetime


class ToolOut(BaseModel):
    server_id: int
    server_name: str
    name: str
    description: str
    input_schema: dict[str, Any]
    risk: Literal["read", "write", "destructive"]
    requires_approval: bool


class ResourceOut(BaseModel):
    uri: str
    name: str
    description: str
    mime_type: str | None


class PromptArgOut(BaseModel):
    name: str
    description: str
    required: bool


class PromptOut(BaseModel):
    name: str
    description: str
    arguments: list[PromptArgOut]


class ToolCallIn(BaseModel):
    server_id: int | None = None
    server_name: str | None = None
    tool: str = Field(min_length=1, max_length=128)
    arguments: dict[str, Any] = Field(default_factory=dict)
    project_id: int | None = None


class ToolCallResult(BaseModel):
    status: Literal["succeeded", "failed", "awaiting_approval", "denied"]
    result: Any | None = None
    error: str | None = None
    approval_id: int | None = None
    duration_ms: int | None = None


# ---- conversations / runs ----
class ConversationIn(BaseModel):
    project_id: int | None = None
    title: str | None = Field(default=None, max_length=200)


class MessageOut(ORM):
    id: int
    role: str
    content: str
    run_id: int | None
    created_at: datetime


class ConversationOut(ORM):
    id: int
    project_id: int | None
    title: str
    created_at: datetime


class ConversationDetail(ConversationOut):
    messages: list[MessageOut]


class MessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=20000)


class StepOut(ORM):
    id: int
    index: int
    kind: str
    server_name: str | None
    tool_name: str | None
    arguments: dict[str, Any]
    status: str
    result: Any | None
    error: str | None
    duration_ms: int | None
    approval_id: int | None
    started_at: datetime


class RunSummary(BaseModel):
    id: int
    conversation_id: int
    objective: str
    status: str
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float
    started_at: datetime
    finished_at: datetime | None
    duration_ms: int | None
    step_count: int


class RunOut(RunSummary):
    final_summary: str | None
    error: str | None
    steps: list[StepOut]


# ---- approvals / permissions / audit ----
class ApprovalOut(BaseModel):
    id: int
    run_id: int | None
    server_name: str
    tool_name: str
    arguments: dict[str, Any]
    risk: str
    status: str
    requested_by: str
    decided_by: str | None
    comment: str | None
    result: Any | None
    error: str | None
    created_at: datetime
    decided_at: datetime | None


class DecisionIn(BaseModel):
    approve: bool
    comment: str | None = Field(default=None, max_length=2000)


class RuleIn(BaseModel):
    role: Literal["admin", "developer", "viewer", "*"]
    server_pattern: str = Field(default="*", max_length=64)
    tool_pattern: str = Field(default="*", max_length=128)
    effect: Literal["allow", "deny", "require_approval"]


class RuleOut(ORM, RuleIn):
    id: int


class AuditOut(ORM):
    id: int
    created_at: datetime
    actor: str
    event_type: str
    server_name: str | None
    tool_name: str | None
    detail: dict[str, Any]
    outcome: str


# ---- external integrations (GitHub direct connect & external websites) ----
class GithubDirectConnectIn(BaseModel):
    token: str | None = Field(default=None, max_length=500)
    username_or_repo: str | None = Field(default=None, max_length=300)


class ConnectedWebsiteIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    url: str = Field(min_length=8, max_length=2000)
    kind: Literal["website", "openapi", "github", "rest_api", "docs"] = "website"
    auth_token: str | None = Field(default=None, max_length=1000)


class ConnectedWebsiteOut(BaseModel):
    id: int
    name: str
    url: str
    kind: str
    has_auth: bool
    created_at: datetime
