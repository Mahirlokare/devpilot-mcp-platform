"""Permission policy: role + tool-level rules + risk classification -> allow / require_approval / deny."""
from __future__ import annotations

from dataclasses import dataclass
from fnmatch import fnmatchcase
from typing import Any, Iterable, Literal

Risk = Literal["read", "write", "destructive"]
Decision = Literal["allow", "require_approval", "deny"]


@dataclass(frozen=True)
class PolicyResult:
    decision: Decision
    reason: str


def classify_risk(annotations: Any, *, trusted: bool) -> Risk:
    """Map MCP tool annotations to a risk level.

    Annotations are *hints* supplied by the server. Only built-in (first-party) servers are trusted to
    declare a tool read-only; for any other server every tool is treated as at least `write`.
    """
    if annotations is None:
        return "write"
    read_only = getattr(annotations, "readOnlyHint", None)
    destructive = getattr(annotations, "destructiveHint", None)
    if destructive is True:
        return "destructive"
    if read_only is True and trusted:
        return "read"
    return "write"


def _matches(rule: Any, role: str, server: str, tool: str) -> bool:
    return (rule.role in ("*", role)) and fnmatchcase(server, rule.server_pattern) and fnmatchcase(tool, rule.tool_pattern)


def evaluate(rules: Iterable[Any], role: str, server: str, tool: str, risk: Risk) -> PolicyResult:
    """Precedence: viewer write-floor > explicit deny > explicit require_approval > risk default.

    * `destructive` tools ALWAYS need human approval; allow-rules cannot waive that.
    * `write` tools need approval unless an admin created an explicit allow rule for them.
    * `read` tools are allowed unless denied.
    """
    matching = [r for r in rules if _matches(r, role, server, tool)]
    if role == "viewer" and risk != "read":
        return PolicyResult("deny", "viewers may only use read-only tools")
    if any(r.effect == "deny" for r in matching):
        return PolicyResult("deny", "blocked by an explicit permission rule")
    if any(r.effect == "require_approval" for r in matching):
        return PolicyResult("require_approval", "an explicit permission rule requires approval")
    if risk == "destructive":
        return PolicyResult("require_approval", "destructive operations always require human approval")
    if risk == "write":
        if any(r.effect == "allow" for r in matching):
            return PolicyResult("allow", "write tool pre-authorized by an explicit allow rule")
        return PolicyResult("require_approval", "write operations require human approval")
    return PolicyResult("allow", "read-only operation")
