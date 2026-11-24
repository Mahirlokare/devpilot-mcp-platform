# Testing & Quality Assurance MCP Server (`mcp_servers.testing`)

Detects test frameworks, executes test suites and coverage inside the sandbox, and analyzes test failures.

## Environment Variables
- `DEVPILOT_WORKSPACE_ROOT` (required): Working directory jail.

## Tools
| Tool | Risk | Description |
|---|---|---|
| `detect_frameworks` | read | Detect `pytest`, `vitest`, `jest`, or `npm` test scripts |
| `run_tests` | write | Run tests in the sandbox and parse pass/fail summary + failure diagnostics (requires approval) |
| `run_coverage` | write | Run tests with coverage enabled and parse total/file coverage percentages (requires approval) |
| `analyze_failures` | read | Parse raw test output into structured failures, file:line locations, error types, and hints |
