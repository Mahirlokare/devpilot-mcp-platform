"""Sandboxed command runner shared by the terminal and testing MCP servers.

Two sandbox modes (DEVPILOT_TERMINAL_SANDBOX):
  * "docker"  - each command runs in a throwaway container: no network (except install commands when allowed),
                read-only root fs, dropped capabilities, CPU/memory/pids limits, only the workspace mounted.
                This is the mode intended for production.
  * "process" - local subprocess with executable allowlist, no shell, workspace-jailed cwd, scrubbed environment,
                timeout with process-tree kill, output caps, POSIX rlimits. This is NOT a security boundary against
                malicious project code (tests/scripts run arbitrary code as the server user). Use only for trusted
                local development. Production refuses to start in this mode unless explicitly overridden.
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

from mcp_servers.common import PathViolation, redact, resolve_in_root, workspace_root

log = logging.getLogger("devpilot.runner")

DEFAULT_ALLOWLIST = "python,python3,pip,pytest,ruff,node,npm,npx,git,tsc"
MAX_OUTPUT_BYTES = 100_000
MAX_TIMEOUT = 600
MAX_ARGS = 64
MAX_ARG_LEN = 2000

# Flags that turn an allowed interpreter into an arbitrary-code evaluator or load code from outside the workspace.
_BLOCKED_FLAGS: dict[str, set[str]] = {
    "python": {"-c", "-i"},
    "python3": {"-c", "-i"},
    "node": {"-e", "--eval", "-p", "--print", "-r", "--require", "--import", "--loader", "--experimental-loader"},
    "git": {"-c", "--upload-pack", "--receive-pack", "--exec-path", "--ext-cmd", "--config-env"},
}
_ALLOWED_PY_MODULES = {"pytest", "pip", "ruff", "unittest", "compileall", "mypy", "coverage", "json.tool"}
_INSTALL_SUBCOMMANDS = {"pip": {"install"}, "npm": {"install", "i", "ci", "add"}}
_BLOCKED_INSTALL_ARGS = ("--index-url", "-i", "--extra-index-url", "--trusted-host", "--find-links", "-f",
                         "--registry", "--prefix", "--target", "-t", "--user", "--global", "-g", "--ignore-scripts=false")
_GIT_READONLY = {"status", "log", "diff", "show", "branch", "rev-parse", "ls-files", "blame", "remote", "describe"}


class CommandRejected(ValueError):
    pass


@dataclass
class RunResult:
    exit_code: int | None
    stdout: str
    stderr: str
    timed_out: bool
    duration_ms: int
    truncated: bool
    sandbox: str
    argv: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"exit_code": self.exit_code, "stdout": self.stdout, "stderr": self.stderr, "timed_out": self.timed_out,
                "duration_ms": self.duration_ms, "truncated": self.truncated, "sandbox": self.sandbox,
                "argv": self.argv, "success": self.exit_code == 0 and not self.timed_out}


def sandbox_mode() -> str:
    return os.environ.get("DEVPILOT_TERMINAL_SANDBOX", "process").lower()


def enforce_sandbox_policy() -> None:
    mode = sandbox_mode()
    if mode not in {"process", "docker"}:
        raise RuntimeError("DEVPILOT_TERMINAL_SANDBOX must be 'process' or 'docker'")
    prod = os.environ.get("DEVPILOT_ENVIRONMENT", "development") == "production"
    if prod and mode != "docker" and os.environ.get("DEVPILOT_TERMINAL_ALLOW_UNSANDBOXED", "").lower() != "true":
        raise RuntimeError("Refusing to run terminal tools without a docker sandbox in production")


def allowlist() -> set[str]:
    return {x.strip() for x in os.environ.get("DEVPILOT_TERMINAL_ALLOWLIST", DEFAULT_ALLOWLIST).split(",") if x.strip()}


def validate_argv(argv: list[str]) -> list[str]:
    """Static validation. Returns normalized argv. Raises CommandRejected."""
    if not argv or not isinstance(argv, list) or not all(isinstance(a, str) for a in argv):
        raise CommandRejected("argv must be a non-empty list of strings (no shell syntax)")
    if len(argv) > MAX_ARGS or any(len(a) > MAX_ARG_LEN or "\x00" in a or "\n" in a for a in argv):
        raise CommandRejected("argument list too long or contains control characters")
    exe = argv[0]
    if "/" in exe or "\\" in exe:
        raise CommandRejected("executable must be a bare name from the allowlist")
    name = exe[:-4] if exe.lower().endswith(".exe") else exe
    if name not in allowlist():
        raise CommandRejected(f"executable '{exe}' is not in the allowlist: {sorted(allowlist())}")
    args = argv[1:]
    blocked = _BLOCKED_FLAGS.get(name, set())
    for a in args:
        if a in blocked or any(a.startswith(b + "=") for b in blocked if b.startswith("--")):
            raise CommandRejected(f"flag '{a}' is not permitted")
    if name in {"python", "python3"}:
        if args and args[0] == "-m":
            if len(args) < 2 or args[1] not in _ALLOWED_PY_MODULES:
                raise CommandRejected(f"python -m only supports: {sorted(_ALLOWED_PY_MODULES)}")
        elif args and args[0].startswith("-"):
            raise CommandRejected("only `python -m <module>` or `python <script.py>` are supported")
    if name == "git":
        sub = next((a for a in args if not a.startswith("-")), None)
        if sub not in _GIT_READONLY:
            raise CommandRejected(f"git is limited to read-only subcommands: {sorted(_GIT_READONLY)} "
                                  "(writes go through the GitHub server with approval)")
        if sub == "remote" and any(a in {"add", "set-url", "remove", "rm", "rename", "prune"} for a in args):
            raise CommandRejected("git remote modifications are not permitted")
        if sub == "branch" and any(a in {"-d", "-D", "-m", "-M", "-c", "-C", "--delete", "--move", "--copy"} for a in args):
            raise CommandRejected("git branch modifications are not permitted")
    if is_install([name] + args):
        for a in args:
            if a.split("=")[0] in _BLOCKED_INSTALL_ARGS or a.startswith(("git+", "http://", "https://", "file:", "/", "..", "~", "-r", "--requirement")):
                raise CommandRejected(f"install argument '{a}' is not permitted (custom indexes, URLs, paths and requirement files are blocked)")
    return argv


def is_install(argv: list[str]) -> bool:
    name = argv[0]
    rest = argv[1:]
    return bool(
        (name == "pip" and "install" in rest)
        or (name == "npm" and rest and rest[0] in _INSTALL_SUBCOMMANDS["npm"])
        or (name in {"python", "python3"} and rest[:2] == ["-m", "pip"] and "install" in rest)
    )


def _scrubbed_env(home: Path) -> dict[str, str]:
    keep = ["PATH", "SYSTEMROOT", "COMSPEC", "PATHEXT", "TEMP", "TMP", "LANG", "LC_ALL", "TERM"]
    env = {k: os.environ[k] for k in keep if k in os.environ}
    env.update({"HOME": str(home), "USERPROFILE": str(home), "PYTHONDONTWRITEBYTECODE": "1", "CI": "1",
                "NO_COLOR": "1", "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"})
    return env


def _posix_limits():  # pragma: no cover - POSIX only
    import resource

    mem = int(os.environ.get("DEVPILOT_TERMINAL_MEMORY_MB", "1024")) * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_CPU, (MAX_TIMEOUT, MAX_TIMEOUT))
    resource.setrlimit(resource.RLIMIT_AS, (mem * 4, mem * 4))  # AS is generous: node reserves virtual memory
    resource.setrlimit(resource.RLIMIT_FSIZE, (200 * 1024 * 1024, 200 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NPROC, (512, 512))


def build_docker_command(argv: list[str], cwd_rel: str, root: Path, network: bool) -> list[str]:
    image = os.environ.get("DEVPILOT_TERMINAL_IMAGE", "devpilot-sandbox:latest")
    cmd = ["docker", "run", "--rm", "--network", "bridge" if network else "none",
           "--memory", os.environ.get("DEVPILOT_TERMINAL_MEMORY", "512m"),
           "--cpus", os.environ.get("DEVPILOT_TERMINAL_CPUS", "1"), "--pids-limit", "256",
           "--read-only", "--tmpfs", "/tmp:rw,size=256m", "--cap-drop", "ALL",
           "--security-opt", "no-new-privileges", "--user", "1000:1000",
           "-e", "HOME=/tmp", "-e", "CI=1", "-e", "NO_COLOR=1",
           "-v", f"{root}:/workspace:rw", "-w", f"/workspace/{cwd_rel}".rstrip("/."), image]
    return cmd + argv


async def _kill_tree(proc: asyncio.subprocess.Process) -> None:
    try:
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True, timeout=10)
        else:
            import signal

            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except Exception:  # process may already be gone
        try:
            proc.kill()
        except ProcessLookupError:
            pass


async def _read_capped(stream: asyncio.StreamReader | None, cap: int) -> tuple[bytes, bool]:
    buf = bytearray()
    truncated = False
    if stream is None:
        return b"", False
    while True:
        chunk = await stream.read(8192)
        if not chunk:
            break
        if len(buf) < cap:
            buf += chunk[: cap - len(buf)]
        if len(buf) >= cap:
            truncated = True  # keep draining so the child does not block on a full pipe
    return bytes(buf), truncated


async def run_sandboxed(argv: list[str], cwd: str = ".", timeout_seconds: int = 60) -> RunResult:
    argv = validate_argv(list(argv))
    timeout = max(1, min(int(timeout_seconds), MAX_TIMEOUT))
    root = workspace_root()
    try:
        cwd_path = resolve_in_root(root, cwd)
    except PathViolation as e:
        raise CommandRejected(str(e)) from e
    if not cwd_path.is_dir():
        raise CommandRejected("cwd is not a directory")
    mode = sandbox_mode()
    start = time.monotonic()
    if mode == "docker":
        if shutil.which("docker") is None:
            raise CommandRejected("docker is required by the configured sandbox but was not found")
        net = is_install(argv) and os.environ.get("DEVPILOT_TERMINAL_INSTALL_NETWORK", "true").lower() == "true"
        final = build_docker_command(argv, cwd_path.relative_to(root).as_posix(), root, net)
        env, popen_cwd = None, None
    else:
        exe = sys.executable if argv[0] in {"python", "python3"} else shutil.which(argv[0])
        if exe is None:
            raise CommandRejected(f"executable '{argv[0]}' was not found on PATH")
        home = root / ".devpilot_home"
        home.mkdir(exist_ok=True)
        final = [exe] + argv[1:]
        env, popen_cwd = _scrubbed_env(home), str(cwd_path)
        if sys.platform == "win32" and exe.lower().endswith((".cmd", ".bat")):
            final = ["cmd.exe", "/c"] + final  # npm/npx are .cmd shims on Windows; args already validated, no shell metachar expansion of user text beyond cmd parsing
            if any(c in a for a in argv[1:] for c in '&|<>^%"'):
                raise CommandRejected("shell metacharacters are not allowed in arguments")
    kwargs: dict = {}
    if sys.platform != "win32":
        kwargs["start_new_session"] = True
        if mode == "process":
            kwargs["preexec_fn"] = _posix_limits
    log.info("run %s (cwd=%s, mode=%s, timeout=%ss)", argv, cwd_path.name, mode, timeout)
    proc = await asyncio.create_subprocess_exec(
        *final, cwd=popen_cwd, env=env, stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, **kwargs)
    timed_out = False
    out_t = asyncio.create_task(_read_capped(proc.stdout, MAX_OUTPUT_BYTES))
    err_t = asyncio.create_task(_read_capped(proc.stderr, MAX_OUTPUT_BYTES))
    try:
        await asyncio.wait_for(proc.wait(), timeout=timeout)
    except asyncio.TimeoutError:
        timed_out = True
        await _kill_tree(proc)
        await proc.wait()
    (out, t1), (err, t2) = await asyncio.gather(out_t, err_t)
    return RunResult(
        exit_code=proc.returncode, stdout=redact(out.decode("utf-8", "replace")), stderr=redact(err.decode("utf-8", "replace")),
        timed_out=timed_out, duration_ms=int((time.monotonic() - start) * 1000), truncated=t1 or t2, sandbox=mode, argv=argv)
