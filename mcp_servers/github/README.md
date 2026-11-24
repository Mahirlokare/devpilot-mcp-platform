# DevPilot GitHub MCP Server (`mcp_servers.github`)

FastMCP stdio server providing read-only repository, tree, file, commit, branch, issue, pull-request, and activity inspection tools, plus approval-gated write tools (`create_branch`, `commit_files`, `create_pull_request`).

## Configuration

| Environment Variable | Required | Description |
|---|---|---|
| `GITHUB_TOKEN` | Yes | GitHub personal access token or OAuth token (`Bearer` auth). Never accepted as a tool argument or echoed in errors/outputs. |
| `DEVPILOT_GITHUB_ALLOW_DEFAULT_BRANCH_COMMITS` | No | Set to `true` to allow `commit_files` on the repository's default branch (refused by default). |
| `DEVPILOT_MCP_LOG_LEVEL` | No | Logging level emitted to `stderr` (default: `INFO`). |

## Tools

- **Read (`readOnlyHint=True`)**: `list_repositories`, `get_repository`, `get_repository_tree`, `read_file`, `list_commits`, `list_branches`, `list_issues`, `list_pull_requests`, `get_pull_request`, `get_repository_activity`
- **Write (`readOnlyHint=False`, requires approval)**: `create_branch`, `commit_files`, `create_pull_request`

## Running

```bash
python -m mcp_servers.github.server
```
