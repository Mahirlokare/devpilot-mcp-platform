"""Unit tests for the filesystem & code-intelligence MCP server."""
from __future__ import annotations

from pathlib import Path

import pytest
from mcp.server.fastmcp.exceptions import ToolError
from mcp_servers.filesystem import server as fs


@pytest.fixture(autouse=True)
def _ws(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("DEVPILOT_WORKSPACE_ROOT", str(tmp_path))
    return tmp_path


def test_list_and_read_and_write(_ws: Path) -> None:
    res = fs.write_file("src/app.py", "def add(a, b):\n    return a + b\n")
    assert res["created"] is True
    listing = fs.list_directory("src")
    assert any(e["name"] == "app.py" for e in listing["entries"])
    read = fs.read_file("src/app.py")
    assert "def add" in read["content"]


def test_path_traversal_and_sensitive_files_blocked(_ws: Path) -> None:
    (_ws / ".env").write_text("SECRET=123", encoding="utf-8")
    with pytest.raises(ToolError, match="escapes|not allowed"):
        fs.read_file("../outside.txt")
    with pytest.raises(ToolError, match="absolute"):
        fs.read_file("/etc/passwd")
    with pytest.raises(ToolError, match="secrets"):
        fs.read_file(".env")
    with pytest.raises(ToolError, match="not allowed"):
        fs.write_file(".env", "BAD=1")


def test_analyze_file_and_security_and_duplicates(_ws: Path) -> None:
    code = '''def risky(x=[]):
    try:
        if x == None:
            return eval("1+1")
    except:
        pass
'''
    fs.write_file("pkg/mod1.py", code)
    dup_block = "\n".join(f"    value_{i} = compute_something({i}) + extra_offset" for i in range(8))
    fs.write_file("pkg/a.py", f"def fa():\n{dup_block}\n")
    fs.write_file("pkg/b.py", f"def fb():\n{dup_block}\n")

    analysis = fs.analyze_file("pkg/mod1.py")
    kinds = {i["kind"] for i in analysis["issues"]}
    assert {"mutable_default_argument", "none_comparison", "bare_except"} <= kinds

    sec = fs.scan_security()
    assert sec["total"] >= 1
    assert any(f["rule"] == "code-exec" for f in sec["findings"])

    dups = fs.find_duplicates(min_lines=6)
    assert dups["total_groups"] >= 1

    struct = fs.analyze_structure()
    assert struct["file_count"] == 3


@pytest.mark.asyncio
async def test_fastmcp_tool_annotations() -> None:
    srv = fs.build_server()
    tools = {t.name: t for t in await srv.list_tools()}
    assert tools["read_file"].annotations.readOnlyHint is True
    assert tools["write_file"].annotations.readOnlyHint is False
