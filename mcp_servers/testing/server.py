"""Testing MCP server: detect frameworks, run test suites/coverage in the sandbox, analyze failures."""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Literal

from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError

from mcp_servers.common import READ, WRITE, PathViolation, configure_logging, resolve_in_root, workspace_root
from mcp_servers.terminal.runner import CommandRejected, enforce_sandbox_policy, run_sandboxed

log = logging.getLogger("devpilot.testing")

Framework = Literal["pytest", "jest", "vitest", "npm"]
_SAFE_ARG = re.compile(r"^(-x|-q|-v|-vv|--lf|--ff|--bail|--runInBand|--maxfail=\d{1,3}|-k|-m|--watch=false|[A-Za-z0-9_.:\[\]/ -]{1,120})$")


def detect_frameworks(path: str | None = None) -> dict[str, Any]:
    try:
        base = resolve_in_root(workspace_root(), path)
    except PathViolation as e:
        raise ToolError(str(e)) from e
    if not base.is_dir():
        raise ToolError("not a directory")
    found: list[dict[str, str]] = []
    pyproject, pkg = base / "pyproject.toml", base / "package.json"
    if (base / "pytest.ini").exists() or (base / "conftest.py").exists() or (base / "tox.ini").exists() or \
            (pyproject.exists() and "pytest" in pyproject.read_text(errors="ignore")) or \
            any(base.glob("test_*.py")) or any(base.glob("tests/test_*.py")):
        found.append({"framework": "pytest", "evidence": "pytest config or test_*.py files"})
    if pkg.exists():
        try:
            data = json.loads(pkg.read_text(errors="ignore"))
        except json.JSONDecodeError:
            data = {}
        deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
        for fw in ("vitest", "jest"):
            if fw in deps:
                found.append({"framework": fw, "evidence": f"{fw} in package.json dependencies"})
        if "test" in data.get("scripts", {}):
            found.append({"framework": "npm", "evidence": "package.json has a 'test' script"})
    return {"path": path or ".", "frameworks": found}


# --------------------------------------------------------------------------- output parsing
def parse_summary(framework: str, output: str) -> dict[str, Any]:
    counts = {"passed": 0, "failed": 0, "skipped": 0, "errors": 0}
    if framework == "pytest":
        for n, label in re.findall(r"(\d+) (passed|failed|skipped|error|errors|xfailed|xpassed|deselected)", output):
            key = {"error": "errors", "errors": "errors"}.get(label, label)
            if key in counts:
                counts[key] = int(n)
    else:
        m = re.search(r"Tests:\s+(?:(\d+) failed, )?(?:(\d+) skipped, )?(?:(\d+) passed, )?(\d+) total", output)  # jest
        if m:
            counts.update(failed=int(m.group(1) or 0), skipped=int(m.group(2) or 0), passed=int(m.group(3) or 0))
        else:  # vitest: "Tests  1 failed | 2 passed (3)"
            m = re.search(r"Tests\s+(.*?)\((\d+)\)", output)
            if m:
                for n, label in re.findall(r"(\d+) (failed|passed|skipped)", m.group(1)):
                    counts[label] = int(n)
    return counts


def parse_coverage(framework: str, output: str) -> dict[str, Any]:
    if framework == "pytest":
        m = re.search(r"^TOTAL\s+\d+\s+\d+(?:\s+\d+\s+\d+)?\s+(\d+(?:\.\d+)?)%", output, re.M)
        files = re.findall(r"^(\S+\.py)\s+\d+\s+\d+(?:\s+\d+\s+\d+)?\s+(\d+)%", output, re.M)
    else:
        m = re.search(r"All files\s*\|\s*([\d.]+)", output)
        files = [(f.strip(), p) for f, p in re.findall(r"^\s*([\w./-]+\.\w+)\s*\|\s*([\d.]+)", output, re.M)]
    return {"total_percent": float(m.group(1)) if m else None,
            "files": [{"file": f, "percent": float(p)} for f, p in files[:100]]}


def analyze_failures(output: str) -> dict[str, Any]:
    """Heuristic extraction of failing tests, locations and error types from raw test output."""
    failures = []
    for m in re.finditer(r"^(?:FAILED|ERROR)\s+(\S+?)(?:\s+-\s+(.*))?$", output, re.M):
        failures.append({"test": m.group(1), "reason": (m.group(2) or "")[:300]})
    for m in re.finditer(r"^\s*(?:●|FAIL)\s+(.+)$", output, re.M):  # jest/vitest
        failures.append({"test": m.group(1).strip()[:200], "reason": ""})
    locations = sorted({f"{f}:{ln}" for f, ln in re.findall(r"([\w./\\-]+\.(?:py|js|jsx|ts|tsx)):(\d+)", output)})[:30]
    error_types = {}
    for e in re.findall(r"\b([A-Z][A-Za-z]+(?:Error|Exception))\b", output):
        error_types[e] = error_types.get(e, 0) + 1
    hints = []
    if "ModuleNotFoundError" in output or "Cannot find module" in output:
        hints.append("A dependency or module import is missing; check installed packages and import paths.")
    if "AssertionError" in output or "expect(" in output:
        hints.append("Assertion failures: compare expected vs. actual in the failing test output above.")
    if "TimeoutError" in output or "timed out" in output:
        hints.append("Timeouts detected: look for hanging I/O, missing mocks or event-loop issues.")
    return {"failures": failures[:50], "failure_count": len(failures), "locations": locations,
            "error_types": dict(sorted(error_types.items(), key=lambda x: -x[1])[:10]), "hints": hints,
            "note": "Heuristic summary of text output; read the raw output for authoritative details."}


def _build_argv(framework: str, path: str | None, args: list[str] | None, coverage: bool) -> list[str]:
    args = args or []
    for a in args:
        if not _SAFE_ARG.match(a) or a.startswith(("--rootdir", "-c", "-p", "--co")):
            raise ToolError(f"test argument not permitted: {a!r}")
    target = [path] if path and path != "." else []
    if framework == "pytest":
        argv = ["python", "-m", "pytest", "-q", "--tb=short", "-p", "no:cacheprovider"]
        if coverage:
            argv += ["--cov", "--cov-report=term"]
        return argv + args + target
    if framework in {"jest", "vitest"}:
        argv = ["npx", "--no-install", framework] + (["run"] if framework == "vitest" else [])
        if coverage:
            argv += ["--coverage"]
        return argv + args + target
    if framework == "npm":
        if coverage:
            raise ToolError("coverage is only supported for pytest, jest and vitest")
        return ["npm", "test", "--silent"] + (["--"] + args if args else [])
    raise ToolError("unsupported framework")


async def _run(framework: str, path: str | None, args: list[str] | None, coverage: bool, timeout: int) -> dict[str, Any]:
    argv = _build_argv(framework, path if framework == "pytest" else None, args, coverage)
    cwd = "." if framework == "pytest" else (path or ".")  # node tooling must run inside the project dir
    try:
        res = await run_sandboxed(argv, cwd, timeout)
    except CommandRejected as e:
        raise ToolError(f"Rejected: {e}") from e
    combined = res.stdout + "\n" + res.stderr
    out: dict[str, Any] = {"framework": framework, "command": argv, "exit_code": res.exit_code, "timed_out": res.timed_out,
                           "passed": res.exit_code == 0 and not res.timed_out, "duration_ms": res.duration_ms,
                           "summary": parse_summary(framework, combined), "sandbox": res.sandbox,
                           "stdout": res.stdout[-30000:], "stderr": res.stderr[-10000:], "truncated": res.truncated}
    if coverage:
        out["coverage"] = parse_coverage(framework, combined)
        if out["coverage"]["total_percent"] is None:
            out["coverage_note"] = "No coverage totals found in output (is pytest-cov / @vitest/coverage installed?)."
    if not out["passed"]:
        out["analysis"] = analyze_failures(combined)
    return out


async def run_tests(framework: Framework, path: str | None = None, args: list[str] | None = None) -> dict[str, Any]:
    return await _run(framework, path, args, False, 300)


async def run_coverage(framework: Framework, path: str | None = None, args: list[str] | None = None) -> dict[str, Any]:
    return await _run(framework, path, args, True, 450)


def build_server() -> FastMCP:
    mcp = FastMCP("devpilot-testing", instructions="Detect and run project test suites in the workspace sandbox.")
    mcp.tool(annotations=READ, description="Detect test frameworks (pytest, jest, vitest, npm test) in a workspace directory.")(detect_frameworks)
    mcp.tool(annotations=WRITE, description="Run a test suite in the sandbox and return pass/fail counts plus failure analysis. Executes project code; requires approval.")(run_tests)
    mcp.tool(annotations=WRITE, description="Run tests with coverage and return total/per-file coverage. Executes project code; requires approval.")(run_coverage)
    mcp.tool(annotations=READ, description="Analyze raw test output text: failing tests, locations, error types, hints.")(analyze_failures)
    return mcp


def main() -> None:
    configure_logging("devpilot.testing")
    enforce_sandbox_policy()
    workspace_root()
    build_server().run(transport="stdio")


if __name__ == "__main__":
    main()
