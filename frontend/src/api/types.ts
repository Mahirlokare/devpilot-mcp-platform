// Types mirroring docs/API_CONTRACT.md (v1).

export type Role = "admin" | "developer" | "viewer";

export interface User {
  id: number;
  username: string;
  role: Role;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface AuthConfig {
  registration_open: boolean;
  github_oauth_configured: boolean;
}

export interface GithubStatus {
  connected: boolean;
  login: string | null;
}

export interface Project {
  id: number;
  name: string;
  description: string;
  repo_full_name: string | null;
  root_path: string | null;
  created_at: string;
}

export interface ProjectInput {
  name: string;
  description?: string;
  repo_full_name?: string | null;
  root_path?: string | null;
}

export interface Memory {
  id: number;
  project_id: number;
  content: string;
  created_at: string;
}

export type McpTransport = "stdio" | "streamable_http";
export type McpStatus = "disconnected" | "connecting" | "connected" | "error";

export interface McpServer {
  id: number;
  name: string;
  description: string;
  transport: McpTransport;
  command: string | null;
  args: string[];
  url: string | null;
  env_keys: string[];
  enabled: boolean;
  builtin: boolean;
  status: McpStatus;
  last_error: string | null;
  last_connected_at: string | null;
  tool_count: number;
  created_at: string;
}

export interface McpServerInput {
  name?: string;
  description?: string;
  transport?: McpTransport;
  command?: string | null;
  args?: string[];
  url?: string | null;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export type Risk = "read" | "write" | "destructive";

export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  default?: unknown;
  items?: JsonSchema;
  title?: string;
  [key: string]: unknown;
}

export interface Tool {
  server_id: number;
  server_name: string;
  name: string;
  description: string;
  input_schema: JsonSchema;
  risk: Risk;
  requires_approval: boolean;
}

export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mime_type: string;
}

export interface McpPrompt {
  name: string;
  description: string;
  arguments: { name: string; description: string; required: boolean }[];
}

export interface HealthEntry {
  id: number;
  name: string;
  status: McpStatus;
  latency_ms: number | null;
  checked_at: string;
  error: string | null;
}

export type ToolCallStatus = "succeeded" | "failed" | "awaiting_approval" | "denied";

export interface ToolCallRequest {
  server_id?: number;
  server_name?: string;
  tool: string;
  arguments: Record<string, unknown>;
  project_id?: number | null;
}

export interface ToolCallResult {
  status: ToolCallStatus;
  result: unknown;
  error: string | null;
  approval_id: number | null;
  duration_ms: number | null;
}

export interface Conversation {
  id: number;
  project_id: number | null;
  title: string;
  created_at: string;
}

export interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  run_id: number | null;
  created_at: string;
}

export interface ConversationDetail extends Conversation {
  messages: Message[];
}

export type RunStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export interface RunSummary {
  id: number;
  conversation_id: number | null;
  objective: string;
  status: RunStatus;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  step_count: number;
}

export type StepStatus = "running" | "awaiting_approval" | "succeeded" | "failed" | "denied";

export interface Step {
  id: number;
  index: number;
  kind: "tool_call" | "llm" | "summary";
  server_name: string | null;
  tool_name: string | null;
  arguments: unknown;
  status: StepStatus;
  result: unknown;
  error: string | null;
  duration_ms: number | null;
  approval_id: number | null;
  started_at: string | null;
}

export interface Run extends RunSummary {
  final_summary: string | null;
  error: string | null;
  steps: Step[];
}

export type ApprovalStatus = "pending" | "approved" | "denied" | "executed" | "failed" | "expired";

export interface Approval {
  id: number;
  run_id: number | null;
  server_name: string;
  tool_name: string;
  arguments: unknown;
  risk: Risk;
  status: ApprovalStatus;
  requested_by: string | null;
  decided_by: string | null;
  comment: string | null;
  result: unknown;
  error: string | null;
  created_at: string;
  decided_at: string | null;
}

export type RuleEffect = "allow" | "deny" | "require_approval";

export interface Rule {
  id: number;
  role: Role | "*";
  server_pattern: string;
  tool_pattern: string;
  effect: RuleEffect;
}

export interface RuleInput {
  role: Role | "*";
  server_pattern: string;
  tool_pattern: string;
  effect: RuleEffect;
}

export interface AuditEvent {
  id: number;
  created_at: string;
  actor: string | null;
  event_type: string;
  server_name: string | null;
  tool_name: string | null;
  detail: Record<string, unknown> | null;
  outcome: string | null;
}

export interface AnalyticsSummary {
  servers_total: number;
  servers_connected: number;
  tool_calls_total: number;
  tool_calls_failed: number;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  pending_approvals: number;
  runs_total: number;
  runs_failed: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  tools_by_server: { server: string; calls: number; errors: number; avg_ms: number | null }[];
  daily: { date: string; calls: number; errors: number; tokens: number; cost_usd: number }[];
  recent_errors: {
    created_at: string;
    server_name: string | null;
    tool_name: string | null;
    error: string | null;
  }[];
}

export interface AppSettings {
  openai_configured: boolean;
  model: string;
  max_steps: number;
  run_timeout_seconds: number;
  tool_timeout_seconds: number;
  environment: string;
  github_oauth_configured: boolean;
}
