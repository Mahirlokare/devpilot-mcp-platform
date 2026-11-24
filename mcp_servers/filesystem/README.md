# Filesystem & Code Intelligence MCP Server (`mcp_servers.filesystem`)

Provides workspace-jailed file operations and static code intelligence tools over MCP stdio transport.

## Environment Variables
- `DEVPILOT_WORKSPACE_ROOT` (required): Absolute path to the workspace directory jail.

## Tools
| Tool | Risk | Description |
|---|---|---|
| `list_directory` | read | List directory entries inside the workspace root |
| `read_file` | read | Read UTF-8 text file (refuses secret-looking files and paths outside workspace) |
| `search_files` | read | Regex search across code files |
| `write_file` | write | Create or overwrite a text file inside the workspace (requires approval) |
| `analyze_structure` | read | Summarize file counts, LOC by language, top-level tree, project markers |
| `analyze_file` | read | AST analysis for Python (functions, classes, complexity, bug patterns) and declaration summary for other languages |
| `find_duplicates` | read | Detect duplicate whitespace-normalized code blocks |
| `scan_security` | read | Heuristic scan for dangerous patterns (`eval`, `shell=True`, hardcoded secrets, weak hashes, XSS sinks) |
