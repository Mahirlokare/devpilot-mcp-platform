import { http, setToken } from "./client";
import type {
  AnalyticsSummary,
  AppSettings,
  Approval,
  AuditEvent,
  AuthConfig,
  Conversation,
  ConversationDetail,
  GithubStatus,
  HealthEntry,
  McpPrompt,
  McpResource,
  McpServer,
  McpServerInput,
  Memory,
  Project,
  ProjectInput,
  Role,
  Rule,
  RuleInput,
  Run,
  RunSummary,
  TokenResponse,
  Tool,
  ToolCallRequest,
  ToolCallResult,
  User,
} from "./types";

export const authApi = {
  login: async (username: string, password: string) => {
    const r = await http.post<TokenResponse>("/auth/login", { username, password }, { noAuthRedirect: true });
    setToken(r.access_token);
    return r;
  },
  register: async (username: string, password: string) => {
    const r = await http.post<TokenResponse>("/auth/register", { username, password }, { noAuthRedirect: true });
    setToken(r.access_token);
    return r;
  },
  me: () => http.get<User>("/auth/me"),
  config: () => http.get<AuthConfig>("/auth/config"),
};

export const usersApi = {
  list: () => http.get<User[]>("/users"),
  setRole: (id: number, role: Role) => http.patch<User>(`/users/${id}`, { role }),
};

export const githubApi = {
  authorize: () => http.get<{ authorize_url: string }>("/integrations/github/authorize"),
  status: () => http.get<GithubStatus>("/integrations/github/status"),
  disconnect: () => http.delete("/integrations/github"),
};

export const projectsApi = {
  list: () => http.get<Project[]>("/projects"),
  create: (b: ProjectInput) => http.post<Project>("/projects", b),
  update: (id: number, b: Partial<ProjectInput>) => http.patch<Project>(`/projects/${id}`, b),
  remove: (id: number) => http.delete(`/projects/${id}`),
  memory: (id: number) => http.get<Memory[]>(`/projects/${id}/memory`),
  addMemory: (id: number, content: string) => http.post<Memory>(`/projects/${id}/memory`, { content }),
  removeMemory: (id: number, mid: number) => http.delete(`/projects/${id}/memory/${mid}`),
};

export const mcpApi = {
  servers: () => http.get<McpServer[]>("/mcp/servers"),
  create: (b: McpServerInput) => http.post<McpServer>("/mcp/servers", b),
  update: (id: number, b: McpServerInput) => http.patch<McpServer>(`/mcp/servers/${id}`, b),
  remove: (id: number) => http.delete(`/mcp/servers/${id}`),
  connect: (id: number) => http.post<McpServer>(`/mcp/servers/${id}/connect`),
  disconnect: (id: number) => http.post<McpServer>(`/mcp/servers/${id}/disconnect`),
  serverTools: (id: number) => http.get<Tool[]>(`/mcp/servers/${id}/tools`),
  serverResources: (id: number) => http.get<McpResource[]>(`/mcp/servers/${id}/resources`),
  serverPrompts: (id: number) => http.get<McpPrompt[]>(`/mcp/servers/${id}/prompts`),
  tools: () => http.get<Tool[]>("/mcp/tools"),
  health: () => http.get<{ servers: HealthEntry[] }>("/mcp/health"),
  callTool: (b: ToolCallRequest) => http.post<ToolCallResult>("/mcp/tools/call", b),
};

export const conversationsApi = {
  list: (project_id?: number | null) => http.get<Conversation[]>("/conversations", { project_id }),
  create: (b: { project_id?: number | null; title?: string }) => http.post<Conversation>("/conversations", b),
  get: (id: number) => http.get<ConversationDetail>(`/conversations/${id}`),
  remove: (id: number) => http.delete(`/conversations/${id}`),
  send: (id: number, content: string) => http.post<Run>(`/conversations/${id}/messages`, { content }),
};

export const runsApi = {
  list: (params?: { limit?: number; status?: string }) => http.get<RunSummary[]>("/runs", params),
  get: (id: number, signal?: AbortSignal) => http.get<Run>(`/runs/${id}`, undefined, signal),
  cancel: (id: number) => http.post<Run>(`/runs/${id}/cancel`),
};

export const approvalsApi = {
  list: (status?: string) => http.get<Approval[]>("/approvals", { status }),
  get: (id: number) => http.get<Approval>(`/approvals/${id}`),
  decide: (id: number, approve: boolean, comment?: string) =>
    http.post<Approval>(`/approvals/${id}/decision`, comment ? { approve, comment } : { approve }),
};

export const permissionsApi = {
  list: () => http.get<Rule[]>("/permissions"),
  create: (b: RuleInput) => http.post<Rule>("/permissions", b),
  remove: (id: number) => http.delete(`/permissions/${id}`),
};

export const auditApi = {
  list: (params?: { limit?: number; event_type?: string }) => http.get<AuditEvent[]>("/audit", params),
};

export const analyticsApi = {
  summary: () => http.get<AnalyticsSummary>("/analytics/summary"),
};

export const settingsApi = {
  get: () => http.get<AppSettings>("/settings"),
};

export const healthApi = {
  get: () => http.get<{ status: string }>("/health"),
};
