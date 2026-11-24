"""Unit tests for the testing & QA MCP server."""
from __future__ import annotations

from pathlib import Path

import pytest
from mcp.server.fastmcp.exceptions import ToolError
from mcp_servers.testing import server as tst


@pytest.fixture(autouse=True)
def _ws(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("DEVPILOT_WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setenv("DEVPILOT_TERMINAL_SANDBOX", "process")
    return tmp_path


def test_detect_frameworks_and_parsers(_ws: Path) -> None:
    (_ws / "test_sample.py").write_text("def test_ok(): assert 1 == 1\n", encoding="utf-8")
    (_ws / "package.json").write_text('{"devDependencies":{"vitest":"^1.0.0"},"scripts":{"test":"vitest"}}', encoding="utf-8")
    det = tst.detect_frameworks()
    names = {f["framework"] for f in det["frameworks"]}
    assert {"pytest", "vitest", "npm"} <= names

    summary = tst.parse_summary("pytest", "=== 2 failed, 5 passed, 1 skipped in 0.42s ===")
    assert summary == {"passed": 5, "failed": 2, "skipped": 1, "errors": 0}

    cov = tst.parse_coverage("pytest", "app/mod.py  20  2  90%\nTOTAL  100  15  85%\n")
    assert cov["total_percent"] == 85.0
    assert cov["files"][0]["file"] == "app/mod.py"

    diag = tst.analyze_failures("FAILED tests/test_x.py::test_boom - AssertionError: expected 1 == 2\ntests/test_x.py:14: AssertionError")
    assert diag["failure_count"] == 1
    assert "AssertionError" in diag["error_types"]


@pytest.mark.asyncio
async def test_run_tests_executes_real_pytest(_ws: Path) -> None:
    (_ws / "test_math.py").write_text("def test_addition():\n    assert 2 + 2 == 4\n", encoding="utf-8")
    res = await tst.run_tests("pytest")
    assert res["passed"] is True
    assert res["summary"]["passed"] == 1


def test_dangerous_pytest_args_rejected() -> None:
    with pytest.raises(ToolError, match="not permitted"):
        tst._build_argv("pytest", None, ["-c", "/etc/passwd"], False)
