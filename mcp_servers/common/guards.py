"""Security guards shared by all MCP servers: path jail, SSRF guard, redaction, logging."""
from __future__ import annotations

import fnmatch
import ipaddress
import logging
import os
import re
import socket
import sys
from pathlib import Path
from urllib.parse import urlsplit

from mcp.types import ToolAnnotations

READ = ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True)
WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False)
DESTRUCTIVE = ToolAnnotations(readOnlyHint=False, destructiveHint=True)


def configure_logging(name: str) -> logging.Logger:
    """Log to stderr only: stdout carries the JSON-RPC stream."""
    level = os.environ.get("DEVPILOT_MCP_LOG_LEVEL", "INFO").upper()
    logging.basicConfig(
        stream=sys.stderr, level=level, format=f"%(asctime)s {name} %(levelname)s %(message)s", force=True
    )
    return logging.getLogger(name)


# ---------------------------------------------------------------- redaction
_SECRET_PATTERNS = [
    re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"),
    re.compile(r"github_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"sk-[A-Za-z0-9_-]{20,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._~+/=-]{16,}"),
    re.compile(r"(?i)((?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*)[^\s'\"]{6,}"),
]


def redact(text: str) -> str:
    """Best-effort scrubbing of credentials from text returned to the platform/LLM."""
    for pat in _SECRET_PATTERNS:
        if pat.groups:
            text = pat.sub(lambda m: m.group(1) + "[REDACTED]", text)
        else:
            text = pat.sub("[REDACTED]", text)
    return text


# ---------------------------------------------------------------- filesystem jail
class PathViolation(ValueError):
    pass


def workspace_root() -> Path:
    raw = os.environ.get("DEVPILOT_WORKSPACE_ROOT")
    if not raw:
        raise RuntimeError("DEVPILOT_WORKSPACE_ROOT is not set")
    root = Path(raw).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def resolve_in_root(root: Path, rel: str | None) -> Path:
    """Resolve `rel` under `root`; reject absolute paths, NUL bytes, `..` escapes and symlink escapes."""
    rel = rel or "."
    if "\x00" in rel:
        raise PathViolation("invalid path")
    p = Path(rel)
    if p.is_absolute() or p.drive or rel.startswith(("/", "\\")):
        raise PathViolation("absolute paths are not allowed; use a path relative to the workspace")
    root = root.resolve()
    resolved = (root / p).resolve()  # follows symlinks
    try:
        resolved.relative_to(root)
    except ValueError:
        raise PathViolation("path escapes the workspace") from None
    return resolved


_SENSITIVE_GLOBS = [".env", ".env.*", "*.pem", "*.key", "id_rsa*", "id_ed25519*", "*.p12", "*.pfx",
                    ".npmrc", ".pypirc", "credentials", "credentials.json", ".netrc", "*.kdbx"]


def is_sensitive_path(path: Path) -> bool:
    name = path.name.lower()
    if ".git" in path.parts and name == "config":
        return True
    return any(fnmatch.fnmatch(name, g) for g in _SENSITIVE_GLOBS)


# ---------------------------------------------------------------- SSRF guard
class UrlViolation(ValueError):
    pass


def assert_public_url(url: str, *, allow_private: bool | None = None) -> str:
    """Reject non-http(s) URLs, embedded credentials and hosts resolving to non-public addresses.

    Residual risk: DNS rebinding between this check and the connection; callers re-validate on redirects.
    """
    if allow_private is None:
        allow_private = os.environ.get("DEVPILOT_ALLOW_PRIVATE_URLS", "").lower() in {"1", "true", "yes"}
    parts = urlsplit(url)
    if parts.scheme not in {"http", "https"}:
        raise UrlViolation("only http and https URLs are allowed")
    if not parts.hostname:
        raise UrlViolation("URL has no host")
    if parts.username or parts.password:
        raise UrlViolation("credentials in URLs are not allowed")
    host = parts.hostname
    try:
        infos = socket.getaddrinfo(host, parts.port or (443 if parts.scheme == "https" else 80),
                                   type=socket.SOCK_STREAM)
    except socket.gaierror as e:
        raise UrlViolation(f"cannot resolve host: {host}") from e
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if ip.is_global:
            continue
        if allow_private and (ip.is_loopback or ip.is_private):
            continue
        raise UrlViolation(f"host {host} resolves to a non-public address; blocked (SSRF protection)")
    return url
