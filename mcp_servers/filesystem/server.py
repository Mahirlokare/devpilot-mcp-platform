"""Filesystem + code-intelligence MCP server, jailed to DEVPILOT_WORKSPACE_ROOT.

Static analysis here is heuristic (AST for Python, regexes elsewhere). Findings are leads, not proof.
"""
from __future__ import annotations

import ast
import hashlib
import logging
import os
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError

from mcp_servers.common import (
    READ,
    WRITE,
    PathViolation,
    configure_logging,
    is_sensitive_path,
    redact,
    resolve_in_root,
    workspace_root,
)

log = logging.getLogger("devpilot.filesystem")

IGNORED_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next",
                ".mypy_cache", ".pytest_cache", ".ruff_cache", "target", ".idea", ".vscode"}
MAX_READ_BYTES = 256_000
MAX_WRITE_BYTES = 512_000
MAX_FILES_SCANNED = 5000
CODE_EXT = {".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".go", ".rb", ".php", ".rs", ".cs", ".c", ".cpp", ".h",
            ".sh", ".sql", ".yml", ".yaml", ".json", ".toml", ".md", ".html", ".css"}


def _root() -> Path:
    return workspace_root()


def _resolve(path: str | None) -> Path:
    try:
        return resolve_in_root(_root(), path)
    except PathViolation as e:
        raise ToolError(str(e)) from e


def _rel(p: Path) -> str:
    return p.relative_to(_root()).as_posix() or "."


def iter_files(base: Path, exts: set[str] | None = None):
    count = 0
    root = _root()
    for dirpath, dirnames, filenames in os.walk(base, followlinks=False):
        dirnames[:] = [d for d in dirnames if d not in IGNORED_DIRS]
        for fn in sorted(filenames):
            p = Path(dirpath) / fn
            if p.is_symlink() or is_sensitive_path(p):
                continue
            if exts is not None and p.suffix.lower() not in exts:
                continue
            try:
                p.resolve().relative_to(root)
            except ValueError:
                continue
            count += 1
            if count > MAX_FILES_SCANNED:
                return
            yield p


def _read_text(p: Path, limit: int = MAX_READ_BYTES) -> str:
    if is_sensitive_path(p):
        raise ToolError("refusing to read a file that looks like it holds secrets")
    if not p.is_file():
        raise ToolError("not a file")
    data = p.read_bytes()[:limit]
    if b"\x00" in data[:1024]:
        raise ToolError("binary file")
    return data.decode("utf-8", errors="replace")


# ------------------------------------------------------------------ pure analysis functions
def list_directory(path: str | None = None) -> dict[str, Any]:
    d = _resolve(path)
    if not d.is_dir():
        raise ToolError("not a directory")
    entries = []
    for p in sorted(d.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
        if p.name in IGNORED_DIRS or is_sensitive_path(p):
            continue
        entries.append({"name": p.name, "type": "dir" if p.is_dir() else "file",
                        "size": p.stat().st_size if p.is_file() else None})
    return {"path": _rel(d), "entries": entries[:1000], "truncated": len(entries) > 1000}


def read_file(path: str) -> dict[str, Any]:
    p = _resolve(path)
    text = _read_text(p)
    return {"path": _rel(p), "content": text, "truncated": p.stat().st_size > MAX_READ_BYTES}


def search_files(pattern: str, path: str | None = None) -> dict[str, Any]:
    """Case-insensitive regex search in text files; `pattern` max 200 chars."""
    if len(pattern) > 200:
        raise ToolError("pattern too long")
    try:
        rx = re.compile(pattern, re.I)
    except re.error as e:
        raise ToolError(f"invalid regex: {e}") from e
    matches: list[dict[str, Any]] = []
    for f in iter_files(_resolve(path), CODE_EXT):
        try:
            for i, line in enumerate(f.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
                if rx.search(line[:2000]):
                    matches.append({"file": _rel(f), "line": i, "text": redact(line.strip()[:300])})
                    if len(matches) >= 200:
                        return {"matches": matches, "truncated": True}
        except OSError:
            continue
    return {"matches": matches, "truncated": False}


def write_file(path: str, content: str) -> dict[str, Any]:
    if len(content.encode()) > MAX_WRITE_BYTES:
        raise ToolError("content too large")
    p = _resolve(path)
    if is_sensitive_path(p) or any(part in {".git"} for part in p.relative_to(_root()).parts):
        raise ToolError("writing to this location is not allowed")
    p.parent.mkdir(parents=True, exist_ok=True)
    existed = p.exists()
    p.write_text(content, encoding="utf-8")
    return {"path": _rel(p), "bytes_written": len(content.encode()), "created": not existed}


def analyze_structure(path: str | None = None) -> dict[str, Any]:
    base = _resolve(path)
    if not base.is_dir():
        raise ToolError("not a directory")
    by_ext: Counter[str] = Counter()
    loc: Counter[str] = Counter()
    markers = []
    marker_names = {"package.json", "pyproject.toml", "requirements.txt", "Dockerfile", "docker-compose.yml",
                    "go.mod", "Cargo.toml", "pom.xml", "Makefile", "main.py", "app.py", "index.js", "index.ts"}
    files = 0
    for f in iter_files(base):
        files += 1
        ext = f.suffix.lower() or "(none)"
        by_ext[ext] += 1
        if f.name in marker_names:
            markers.append(_rel(f))
        if ext in CODE_EXT:
            try:
                loc[ext] += sum(1 for ln in f.read_text(encoding="utf-8", errors="ignore").splitlines() if ln.strip())
            except OSError:
                pass
    tree = []
    for p in sorted(base.iterdir()):
        if p.name in IGNORED_DIRS or is_sensitive_path(p):
            continue
        tree.append(p.name + ("/" if p.is_dir() else ""))
    return {"path": _rel(base), "file_count": files, "files_by_extension": dict(by_ext.most_common(15)),
            "lines_of_code_by_extension": dict(loc.most_common(15)), "top_level": tree[:100],
            "project_markers": markers[:50], "scan_limit_hit": files >= MAX_FILES_SCANNED}


def _complexity(node: ast.AST) -> int:
    c = 1
    for n in ast.walk(node):
        if isinstance(n, (ast.If, ast.For, ast.While, ast.AsyncFor, ast.ExceptHandler, ast.With, ast.AsyncWith,
                          ast.IfExp, ast.comprehension, ast.Assert)):
            c += 1
        elif isinstance(n, ast.BoolOp):
            c += len(n.values) - 1
    return c


def analyze_python_source(source: str) -> dict[str, Any]:
    try:
        tree = ast.parse(source)
    except SyntaxError as e:
        return {"language": "python", "syntax_error": f"line {e.lineno}: {e.msg}"}
    functions, classes, issues = [], [], []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            length = (node.end_lineno or node.lineno) - node.lineno + 1
            cx = _complexity(node)
            functions.append({"name": node.name, "line": node.lineno, "args": [a.arg for a in node.args.args],
                              "length": length, "complexity": cx, "has_docstring": ast.get_docstring(node) is not None,
                              "async": isinstance(node, ast.AsyncFunctionDef)})
            if cx > 10:
                issues.append({"line": node.lineno, "kind": "high_complexity",
                               "message": f"{node.name} has cyclomatic complexity ~{cx}"})
            if length > 80:
                issues.append({"line": node.lineno, "kind": "long_function", "message": f"{node.name} is {length} lines"})
            for d in node.args.defaults + [d for d in node.args.kw_defaults if d is not None]:
                if isinstance(d, (ast.List, ast.Dict, ast.Set)):
                    issues.append({"line": node.lineno, "kind": "mutable_default_argument",
                                   "message": f"{node.name} uses a mutable default argument"})
        elif isinstance(node, ast.ClassDef):
            classes.append({"name": node.name, "line": node.lineno,
                            "methods": [n.name for n in node.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))],
                            "has_docstring": ast.get_docstring(node) is not None})
        elif isinstance(node, ast.ExceptHandler):
            if node.type is None:
                issues.append({"line": node.lineno, "kind": "bare_except", "message": "bare `except:` hides errors"})
            elif len(node.body) == 1 and isinstance(node.body[0], ast.Pass):
                issues.append({"line": node.lineno, "kind": "swallowed_exception", "message": "exception is silently ignored"})
        elif isinstance(node, ast.Compare):
            for op, comp in zip(node.ops, node.comparators):
                if isinstance(op, (ast.Eq, ast.NotEq)) and isinstance(comp, ast.Constant) and comp.value is None:
                    issues.append({"line": node.lineno, "kind": "none_comparison", "message": "use `is None` instead of `== None`"})
    imports = sorted({(n.module or "") if isinstance(n, ast.ImportFrom) else a.name
                      for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))
                      for a in (n.names if isinstance(n, ast.Import) else [None])} - {""})
    return {"language": "python", "functions": functions, "classes": classes, "imports": imports,
            "issues": sorted(issues, key=lambda i: i["line"]),
            "undocumented_functions": [f["name"] for f in functions if not f["has_docstring"]][:50]}


def analyze_file(path: str) -> dict[str, Any]:
    p = _resolve(path)
    text = _read_text(p)
    lines = text.splitlines()
    out: dict[str, Any] = {"path": _rel(p), "lines": len(lines), "non_blank_lines": sum(1 for x in lines if x.strip()),
                           "todo_markers": sum(1 for x in lines if re.search(r"\b(TODO|FIXME|HACK|XXX)\b", x)),
                           "max_line_length": max((len(x) for x in lines), default=0)}
    if p.suffix == ".py":
        out.update(analyze_python_source(text))
    else:
        out["language"] = p.suffix.lstrip(".") or "unknown"
        out["note"] = "Deep structural analysis is only implemented for Python; this is a shallow summary."
        decls = re.findall(r"^\s*(?:export\s+)?(?:async\s+)?(?:function|class|const|def|func|fn)\s+([A-Za-z_$][\w$]*)",
                           text, re.M)
        out["declarations"] = decls[:100]
    return out


def find_duplicates(path: str | None = None, min_lines: int = 6) -> dict[str, Any]:
    min_lines = max(4, min(int(min_lines), 30))
    blocks: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for f in iter_files(_resolve(path), {".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".go", ".rb", ".php", ".rs", ".cs"}):
        try:
            raw = f.read_text(encoding="utf-8", errors="ignore").splitlines()
        except OSError:
            continue
        norm = [(i + 1, ln.strip()) for i, ln in enumerate(raw)
                if ln.strip() and not ln.strip().startswith(("#", "//", "import ", "from ", "*", "/*"))]
        for i in range(len(norm) - min_lines + 1):
            window = norm[i:i + min_lines]
            if sum(len(t) for _, t in window) < 120:
                continue
            h = hashlib.sha1("\n".join(t for _, t in window).encode()).hexdigest()
            blocks[h].append((_rel(f), window[0][0]))
    groups = []
    seen_locations: set[tuple[str, int]] = set()
    for locs in blocks.values():
        if len(locs) < 2:
            continue
        locs = [loc for loc in locs if not any((loc[0], loc[1] + d) in seen_locations for d in range(-min_lines, 1))]
        if len(locs) < 2:
            continue
        seen_locations.update(locs)
        groups.append({"occurrences": [{"file": f, "start_line": ln} for f, ln in locs[:10]], "lines": min_lines})
    return {"duplicate_groups": groups[:50], "total_groups": len(groups),
            "note": "Detects exact (whitespace-normalized) repeated blocks only; not semantic clones."}


_SECURITY_RULES: list[tuple[str, str, str, re.Pattern[str]]] = [
    ("high", "code-exec", "Dynamic code execution (eval/exec)", re.compile(r"(?<![\w.])(eval|exec)\s*\(")),
    ("high", "shell-injection", "subprocess with shell=True", re.compile(r"shell\s*=\s*True")),
    ("high", "shell-injection", "os.system / popen call", re.compile(r"\bos\.(system|popen)\s*\(")),
    ("high", "shell-injection", "child_process.exec with possible string command", re.compile(r"child_process.*\bexec\(|\bexecSync\(")),
    ("high", "deserialization", "Unsafe deserialization (pickle/yaml.load/marshal)", re.compile(r"\b(pickle\.loads?|marshal\.loads?|yaml\.load\s*\((?!.*Loader\s*=\s*(yaml\.)?SafeLoader))")),
    ("high", "hardcoded-secret", "Possible hardcoded credential", re.compile(r"(?i)(password|passwd|secret|api[_-]?key|token)\s*[=:]\s*['\"][^'\"\s]{8,}['\"]")),
    ("high", "hardcoded-secret", "Private key material", re.compile(r"-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----")),
    ("high", "hardcoded-secret", "Known token format", re.compile(r"gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{32,}")),
    ("high", "sql-injection", "SQL built with string formatting/concatenation", re.compile(r"(?i)(select|insert|update|delete)\b[^\n]*(\+\s*\w|%s|\{\w+\}|\.format\()[^\n]*(from|where|into|set)?")),
    ("medium", "tls", "TLS verification disabled", re.compile(r"verify\s*=\s*False|rejectUnauthorized\s*:\s*false|InsecureSkipVerify")),
    ("medium", "crypto", "Weak hash (MD5/SHA1)", re.compile(r"\b(md5|sha1)\s*\(|hashlib\.(md5|sha1)\b|createHash\(['\"](md5|sha1)")),
    ("medium", "xss", "Raw HTML injection sink", re.compile(r"dangerouslySetInnerHTML|\.innerHTML\s*=|document\.write\(")),
    ("medium", "config", "Debug mode enabled", re.compile(r"(?i)debug\s*=\s*True|app\.run\([^)]*debug\s*=\s*True")),
    ("medium", "network", "Binding to all interfaces", re.compile(r"0\.0\.0\.0")),
    ("low", "randomness", "Non-cryptographic random used (check if for security)", re.compile(r"\brandom\.(random|randint|choice)\(|Math\.random\(")),
]


def scan_security(path: str | None = None) -> dict[str, Any]:
    findings: list[dict[str, Any]] = []
    for f in iter_files(_resolve(path), CODE_EXT - {".md"}):
        rel = _rel(f)
        if re.search(r"(^|/)(tests?|__tests__)/|test_|\.test\.|\.spec\.", rel):
            continue
        try:
            lines = f.read_text(encoding="utf-8", errors="ignore").splitlines()
        except OSError:
            continue
        for i, line in enumerate(lines, 1):
            if len(line) > 1000:
                continue
            for sev, rule, msg, rx in _SECURITY_RULES:
                if rx.search(line):
                    findings.append({"severity": sev, "rule": rule, "message": msg, "file": rel, "line": i,
                                     "snippet": redact(line.strip()[:200])})
    order = {"high": 0, "medium": 1, "low": 2}
    findings.sort(key=lambda x: (order[x["severity"]], x["file"], x["line"]))
    counts = Counter(f["severity"] for f in findings)
    return {"findings": findings[:300], "total": len(findings), "by_severity": dict(counts),
            "note": "Pattern-based scan (test files skipped). Expect false positives; verify each finding manually."}


def build_server() -> FastMCP:
    mcp = FastMCP("devpilot-filesystem",
                  instructions="Read/search/analyze files inside the project workspace. Paths are relative to the workspace root.")
    mcp.tool(annotations=READ, description="List entries of a directory (relative to workspace root).")(list_directory)
    mcp.tool(annotations=READ, description="Read a UTF-8 text file (max 256KB). Secret-looking files are refused.")(read_file)
    mcp.tool(annotations=READ, description="Regex search across text files under a directory.")(search_files)
    mcp.tool(annotations=WRITE, description="Create or overwrite a text file inside the workspace. Requires approval.")(write_file)
    mcp.tool(annotations=READ, description="Summarize repository structure: file counts, LOC by language, project markers.")(analyze_structure)
    mcp.tool(annotations=READ, description="Analyze one source file: functions, classes, complexity, bug-prone patterns (deep for Python).")(analyze_file)
    mcp.tool(annotations=READ, description="Find duplicated code blocks (exact, whitespace-normalized).")(find_duplicates)
    mcp.tool(annotations=READ, description="Heuristic scan for insecure coding patterns and hardcoded secrets.")(scan_security)
    return mcp


def main() -> None:
    configure_logging("devpilot.filesystem")
    workspace_root()  # fail fast if misconfigured
    build_server().run(transport="stdio")


if __name__ == "__main__":
    main()
