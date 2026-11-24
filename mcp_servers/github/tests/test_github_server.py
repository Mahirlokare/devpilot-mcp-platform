"""Tests for the GitHub MCP server. All HTTP is mocked with httpx.MockTransport; no network is used."""
from __future__ import annotations

import base64
import json

import httpx
import pytest
from mcp.server.fastmcp.exceptions import ToolError
from mcp_servers.github import server

TOKEN = "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"
SHA1 = "1" * 40
SHA2 = "2" * 40
SHA3 = "3" * 40
SHA4 = "4" * 40
SHA5 = "5" * 40


class MockGitHub:
    """Tiny router: (METHOD, exact raw path) -> response spec or list of specs (consumed in order)."""

    def __init__(self) -> None:
        self.routes: dict[tuple[str, str], list] = {}
        self.requests: list[httpx.Request] = []

    def add(self, method: str, path: str, status: int = 200, body=None, headers=None) -> None:
        self.routes.setdefault((method, path), []).append((status, body, headers or {}))

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.raw_path.decode().split("?")[0]
        specs = self.routes.get((request.method, path))
        if not specs:
            return httpx.Response(599, json={"message": f"unrouted {request.method} {path}"})
        spec = specs.pop(0) if len(specs) > 1 else specs[0]
        status, body, headers = spec
        return httpx.Response(status, json=body, headers=headers)

    def calls(self, method: str | None = None) -> list[httpx.Request]:
        return [r for r in self.requests if method is None or r.method == method]

    def payloads(self, method: str, path: str) -> list:
        return [json.loads(r.content) for r in self.requests
                if r.method == method and r.url.raw_path.decode().split("?")[0] == path]


@pytest.fixture
def gh(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", TOKEN)
    monkeypatch.delenv(server.ALLOW_DEFAULT_ENV, raising=False)
    monkeypatch.setattr(server, "BACKOFF_BASE", 0)
    mock = MockGitHub()
    monkeypatch.setattr(server, "get_client",
                        lambda: httpx.AsyncClient(transport=httpx.MockTransport(mock.handler)))
    return mock


def repo_json(default="main", **extra):
    return {"full_name": "octo/hello", "private": False, "default_branch": default, "description": "d",
            "html_url": "https://github.com/octo/hello", **extra}


# ------------------------------------------------------------------ token + headers
async def test_missing_token_raises_helpful_error(gh, monkeypatch):
    monkeypatch.delenv("GITHUB_TOKEN")
    with pytest.raises(ToolError, match="GITHUB_TOKEN is not configured. Connect GitHub in DevPilot."):
        await server.list_repositories()
    assert gh.requests == []


async def test_request_headers(gh):
    gh.add("GET", "/user/repos", 200, [])
    await server.list_repositories()
    req = gh.requests[0]
    assert req.headers["authorization"] == f"Bearer {TOKEN}"
    assert req.headers["accept"] == "application/vnd.github+json"
    assert req.headers["x-github-api-version"] == "2022-11-28"
    assert req.url.host == "api.github.com"


# ------------------------------------------------------------------ validation
@pytest.mark.parametrize("repo", ["", "noslash", "a/b/c", "../etc", "owner/..", "o wner/name", "owner/na me",
                                  "owner/name?x=1", "owner/name#", "a/" + "b" * 101, "./name", "owner/%2e"])
async def test_invalid_repo_rejected_before_any_request(gh, repo):
    for coro in (server.get_repository(repo), server.list_branches(repo), server.list_commits(repo),
                 server.get_repository_tree(repo), server.read_file(repo, "a.txt"),
                 server.create_branch(repo, "x"), server.get_pull_request(repo, 1)):
        with pytest.raises(ToolError, match="Invalid repository"):
            await coro
    assert gh.requests == []


@pytest.mark.parametrize("limit", [0, -1, 201, True, "5"])
async def test_invalid_limit_rejected(gh, limit):
    with pytest.raises(ToolError, match="limit"):
        await server.list_commits("octo/hello", limit=limit)
    assert gh.requests == []


async def test_invalid_state_and_visibility(gh):
    with pytest.raises(ToolError):
        await server.list_issues("octo/hello", state="weird")
    with pytest.raises(ToolError):
        await server.list_pull_requests("octo/hello", state="weird")
    with pytest.raises(ToolError):
        await server.list_repositories(visibility="secret")


@pytest.mark.parametrize("number", [0, -3, "1", True])
async def test_invalid_pr_number(gh, number):
    with pytest.raises(ToolError, match="number"):
        await server.get_pull_request("octo/hello", number)


@pytest.mark.parametrize("name", ["", "a..b", "-lead", "/lead", "trail/", "trail.", "x.lock", "a//b", ".hidden",
                                  "a/.b", "has space", "tilde~1", "caret^", "col:on", "q?", "star*", "br[ack", "a\\b"])
async def test_invalid_branch_names(gh, name):
    with pytest.raises(ToolError, match="Invalid branch name"):
        await server.create_branch("octo/hello", name)
    with pytest.raises(ToolError, match="Invalid branch name"):
        await server.commit_files("octo/hello", name, "m", [{"path": "a", "content": "b"}])
    assert gh.requests == []


async def test_invalid_from_ref(gh):
    with pytest.raises(ToolError, match="from_ref"):
        await server.create_branch("octo/hello", "ok", from_ref="bad ref")


@pytest.mark.parametrize("path", ["", "/abs", "C:/x", "a/../b", "../x", "a//b", "a/./b", "a\\b", "a\x00b", "a/"])
async def test_invalid_read_paths(gh, path):
    with pytest.raises(ToolError, match="Invalid path"):
        await server.read_file("octo/hello", path)
    assert gh.requests == []


@pytest.mark.parametrize("path", ["../x", "/etc/passwd", ".git/config", "a/.git/hooks/pre-commit", ".GIT/x",
                                  "C:\\win", "a/../../b", "", "a//b"])
async def test_commit_files_rejects_bad_paths_without_network(gh, path):
    with pytest.raises(ToolError, match="Invalid path"):
        await server.commit_files("octo/hello", "feat", "msg", [{"path": path, "content": "x"}])
    assert gh.requests == []


async def test_commit_files_rejects_bad_file_sets(gh):
    f = {"path": "a.txt", "content": "x"}
    with pytest.raises(ToolError, match="Too many"):
        await server.commit_files("octo/hello", "feat", "m", [{"path": f"f{i}.txt", "content": "x"} for i in range(21)])
    with pytest.raises(ToolError, match="exceeds"):
        await server.commit_files("octo/hello", "feat", "m", [{"path": "big", "content": "x" * (200 * 1024 + 1)}])
    with pytest.raises(ToolError, match="Duplicate"):
        await server.commit_files("octo/hello", "feat", "m", [f, f])
    with pytest.raises(ToolError, match="non-empty"):
        await server.commit_files("octo/hello", "feat", "m", [])
    with pytest.raises(ToolError, match="string 'path'"):
        await server.commit_files("octo/hello", "feat", "m", [{"path": "a", "content": 5}])
    with pytest.raises(ToolError, match="message"):
        await server.commit_files("octo/hello", "feat", "  ", [f])
    assert gh.requests == []


async def test_commit_files_accepts_exactly_limits(gh):
    files = [{"path": f"f{i}.txt", "content": "x"} for i in range(20)] 
    files[0]["content"] = "y" * (200 * 1024)
    assert len(server._validate_files(files)) == 20


async def test_create_pull_request_validation(gh):
    with pytest.raises(ToolError, match="title"):
        await server.create_pull_request("octo/hello", " ", "feat", "main")
    with pytest.raises(ToolError, match="Invalid head"):
        await server.create_pull_request("octo/hello", "t", "bad head", "main")
    with pytest.raises(ToolError, match="Invalid base"):
        await server.create_pull_request("octo/hello", "t", "feat", "../main")
    with pytest.raises(ToolError, match="owner"):
        await server.create_pull_request("octo/hello", "t", "bad owner!:feat", "main")
    assert gh.requests == []


# ------------------------------------------------------------------ read tools
async def test_list_repositories(gh):
    gh.add("GET", "/user/repos", 200, [
        repo_json(language="Python", description="A tool"),
        repo_json(description=f"token = {TOKEN}"),
    ])
    out = await server.list_repositories(visibility="private", limit=10)
    q = gh.requests[0].url.params
    assert q["visibility"] == "private" and q["per_page"] == "10" and q["sort"] == "updated"
    assert out["count"] == 2 and out["truncated"] is False
    assert out["repositories"][0]["full_name"] == "octo/hello"
    assert TOKEN not in json.dumps(out)


async def test_pagination_collects_pages_and_reports_truncation(gh):
    page = [repo_json() for _ in range(100)]
    link = '<https://api.github.com/user/repos?page=2>; rel="next"'
    gh.add("GET", "/user/repos", 200, page, {"link": link})
    out = await server.list_repositories(limit=50)
    assert out["count"] == 50 and out["truncated"] is True
    assert len(gh.requests) == 1  # stopped as soon as the limit was met


async def test_get_repository(gh):
    gh.add("GET", "/repos/octo/hello", 200, repo_json(stargazers_count=5, license={"spdx_id": "MIT"}, topics=["a"]))
    out = await server.get_repository("octo/hello")
    assert out["default_branch"] == "main" and out["license"] == "MIT" and out["stargazers_count"] == 5


async def test_get_repository_tree_default_branch_and_truncation(gh):
    gh.add("GET", "/repos/octo/hello", 200, repo_json("trunk"))
    tree = [{"path": f"f{i}.py", "type": "blob", "size": i} for i in range(1200)]
    gh.add("GET", "/repos/octo/hello/git/trees/trunk", 200, {"sha": SHA1, "tree": tree, "truncated": False})
    out = await server.get_repository_tree("octo/hello")
    assert out["ref"] == "trunk" and len(out["entries"]) == 1000 and out["total_entries"] == 1200
    assert out["truncated"] is True
    assert gh.requests[1].url.params["recursive"] == "1"
    assert out["entries"][0] == {"path": "f0.py", "type": "file", "size": 0}


async def test_get_repository_tree_slash_ref_is_encoded(gh):
    gh.add("GET", "/repos/octo/hello/git/trees/feat%2Fx", 200, {"sha": SHA1, "tree": [], "truncated": True})
    out = await server.get_repository_tree("octo/hello", ref="feat/x")
    assert out["truncated"] is True and out["entries"] == []


def contents(text: bytes, **extra):
    return {"type": "file", "path": "src/a b.py", "sha": SHA2, "size": len(text), "encoding": "base64",
            "content": base64.encodebytes(text).decode(), "html_url": "https://github.com/octo/hello/blob/x",
            **extra}


async def test_read_file_happy_path_url_encodes_path_and_ref(gh):
    gh.add("GET", "/repos/octo/hello/contents/src/a%20b.py", 200, contents(b"print('hi')\n"))
    out = await server.read_file("octo/hello", "src/a b.py", ref="feat/x")
    assert out["type"] == "file" and out["content"] == "print('hi')\n" and out["truncated"] is False
    assert gh.requests[0].url.params["ref"] == "feat/x"


async def test_read_file_redacts_secrets_in_content(gh):
    gh.add("GET", "/repos/octo/hello/contents/.env.example", 200,
           contents(f"GITHUB={TOKEN}\n".encode(), path=".env.example"))
    out = await server.read_file("octo/hello", ".env.example")
    assert TOKEN not in json.dumps(out) and out["redacted"] is True


async def test_read_file_directory_response(gh):
    gh.add("GET", "/repos/octo/hello/contents/src", 200,
           [{"name": "a.py", "path": "src/a.py", "type": "file", "size": 3},
            {"name": "pkg", "path": "src/pkg", "type": "dir", "size": 0}])
    out = await server.read_file("octo/hello", "src")
    assert out["type"] == "dir" and [e["name"] for e in out["entries"]] == ["a.py", "pkg"]


async def test_read_file_refuses_large_by_reported_size(gh):
    gh.add("GET", "/repos/octo/hello/contents/big.txt", 200,
           {"type": "file", "size": 100 * 1024 + 1, "encoding": "none", "content": ""})
    with pytest.raises(ToolError, match="refusing"):
        await server.read_file("octo/hello", "big.txt")


async def test_read_file_refuses_large_by_decoded_length(gh):
    gh.add("GET", "/repos/octo/hello/contents/big.txt", 200, contents(b"a" * (100 * 1024 + 1), size=10))
    with pytest.raises(ToolError, match="refusing"):
        await server.read_file("octo/hello", "big.txt")


async def test_read_file_accepts_exactly_100kb(gh):
    gh.add("GET", "/repos/octo/hello/contents/ok.txt", 200, contents(b"a" * (100 * 1024)))
    out = await server.read_file("octo/hello", "ok.txt")
    assert out["size"] == 100 * 1024


@pytest.mark.parametrize("raw", [b"\x89PNG\r\n\x1a\n\x00\x00data", b"\xff\xfe\xfa not utf8 \x80"])
async def test_read_file_refuses_binary(gh, raw):
    gh.add("GET", "/repos/octo/hello/contents/img.png", 200, contents(raw))
    with pytest.raises(ToolError, match="binary|UTF-8"):
        await server.read_file("octo/hello", "img.png")


async def test_read_file_symlink_and_submodule(gh):
    gh.add("GET", "/repos/octo/hello/contents/ln", 200, {"type": "symlink", "target": "../x"})
    gh.add("GET", "/repos/octo/hello/contents/sub", 200, {"type": "submodule", "submodule_git_url": "u", "sha": SHA1})
    assert (await server.read_file("octo/hello", "ln"))["type"] == "symlink"
    assert (await server.read_file("octo/hello", "sub"))["type"] == "submodule"


async def test_list_commits(gh):
    gh.add("GET", "/repos/octo/hello/commits", 200, [
        {"sha": SHA1, "html_url": "u", "author": {"login": "octo"},
         "commit": {"message": "fix: thing\n\nbody", "author": {"name": "Octo", "date": "2024-01-01T00:00:00Z"}}}])
    out = await server.list_commits("octo/hello", branch="feat/x", limit=5)
    assert out["commits"][0]["author_login"] == "octo" and out["commits"][0]["sha"] == SHA1
    assert gh.requests[0].url.params["sha"] == "feat/x"


async def test_list_branches(gh):
    gh.add("GET", "/repos/octo/hello/branches", 200, [{"name": "main", "commit": {"sha": SHA1}, "protected": True}])
    out = await server.list_branches("octo/hello")
    assert out["branches"] == [{"name": "main", "sha": SHA1, "protected": True}]


async def test_list_issues_excludes_pull_requests(gh):
    gh.add("GET", "/repos/octo/hello/issues", 200, [
        {"number": 1, "title": "bug", "state": "open", "user": {"login": "a"}, "labels": [{"name": "bug"}],
         "body": f"password = hunter2hunter2 {TOKEN}"},
        {"number": 2, "title": "a PR", "state": "open", "pull_request": {"url": "x"}},
        {"number": 3, "title": "feature", "state": "open", "labels": []},
    ])
    out = await server.list_issues("octo/hello", state="all", limit=10)
    assert [i["number"] for i in out["issues"]] == [1, 3]
    assert gh.requests[0].url.params["state"] == "all"
    assert TOKEN not in json.dumps(out) and "hunter2hunter2" not in json.dumps(out)


async def test_list_pull_requests(gh):
    gh.add("GET", "/repos/octo/hello/pulls", 200, [
        {"number": 7, "title": "t", "state": "open", "draft": False, "user": {"login": "a"},
         "head": {"ref": "feat"}, "base": {"ref": "main"}, "html_url": "u"}])
    out = await server.list_pull_requests("octo/hello")
    assert out["pull_requests"][0]["head"] == "feat" and out["pull_requests"][0]["base"] == "main"


async def test_get_pull_request_with_patch_truncation(gh):
    gh.add("GET", "/repos/octo/hello/pulls/5", 200,
           {"number": 5, "title": "t", "state": "open", "body": "b", "head": {"ref": "f"}, "base": {"ref": "main"},
            "changed_files": 2, "html_url": "u"})
    gh.add("GET", "/repos/octo/hello/pulls/5/files", 200, [
        {"filename": "a.py", "status": "modified", "additions": 1, "deletions": 0, "changes": 1, "patch": "@@ x\n" + "+" * 5000},
        {"filename": "b.png", "status": "added", "additions": 0, "deletions": 0, "changes": 0},
    ])
    out = await server.get_pull_request("octo/hello", 5)
    assert out["number"] == 5 and len(out["files"]) == 2
    assert len(out["files"][0]["patch"]) == 2000 and out["files"][0]["patch_truncated"] is True
    assert out["files"][1]["patch"] == "" and out["files"][1]["patch_truncated"] is False
    assert out["files_truncated"] is False


async def test_get_repository_activity_summarizes_events(gh):
    gh.add("GET", "/repos/octo/hello/events", 200, [
        {"type": "PushEvent", "actor": {"login": "a"}, "created_at": "t", "payload": {"size": 3, "ref": "refs/heads/x"}},
        {"type": "PullRequestEvent", "actor": {"login": "b"}, "created_at": "t",
         "payload": {"action": "opened", "pull_request": {"number": 9, "title": "Add x"}}},
        {"type": "WatchEvent", "actor": {"login": "c"}, "created_at": "t", "payload": {}},
    ])
    out = await server.get_repository_activity("octo/hello", limit=3)
    assert [e["summary"] for e in out["events"]] == [
        "pushed 3 commit(s) to refs/heads/x", "opened pull request #9: Add x", "watch"]


# ------------------------------------------------------------------ write tools
async def test_create_branch_defaults_to_default_branch_and_sends_exact_payload(gh):
    gh.add("GET", "/repos/octo/hello", 200, repo_json("main"))
    gh.add("GET", "/repos/octo/hello/git/ref/heads/main", 200, {"object": {"sha": SHA1, "type": "commit"}})
    gh.add("POST", "/repos/octo/hello/git/refs", 201, {"ref": "refs/heads/feat/x", "object": {"sha": SHA1}})
    out = await server.create_branch("octo/hello", "feat/x")
    assert gh.payloads("POST", "/repos/octo/hello/git/refs") == [{"ref": "refs/heads/feat/x", "sha": SHA1}]
    assert out == {"created": True, "repo": "octo/hello", "branch": "feat/x", "ref": "refs/heads/feat/x",
                   "sha": SHA1, "from_ref": "main"}


async def test_create_branch_from_sha_skips_ref_lookup(gh):
    gh.add("POST", "/repos/octo/hello/git/refs", 201, {"ref": "refs/heads/b", "object": {"sha": SHA2}})
    await server.create_branch("octo/hello", "b", from_ref=SHA2)
    assert [r.method for r in gh.requests] == ["POST"]


async def test_create_branch_falls_back_to_tag(gh):
    gh.add("GET", "/repos/octo/hello/git/ref/heads/v1", 404, {"message": "Not Found"})
    gh.add("GET", "/repos/octo/hello/git/ref/tags/v1", 200, {"object": {"sha": SHA3, "type": "commit"}})
    gh.add("POST", "/repos/octo/hello/git/refs", 201, {"ref": "refs/heads/hotfix", "object": {"sha": SHA3}})
    out = await server.create_branch("octo/hello", "hotfix", from_ref="v1")
    assert out["sha"] == SHA3


async def test_create_branch_unknown_from_ref(gh):
    gh.add("GET", "/repos/octo/hello/git/ref/heads/nope", 404, {"message": "Not Found"})
    gh.add("GET", "/repos/octo/hello/git/ref/tags/nope", 404, {"message": "Not Found"})
    with pytest.raises(ToolError, match="not found as a branch, tag or commit"):
        await server.create_branch("octo/hello", "x", from_ref="nope")
    assert not gh.calls("POST")


async def test_create_branch_never_claims_success_without_confirmation(gh):
    gh.add("POST", "/repos/octo/hello/git/refs", 201, {"unexpected": True})
    with pytest.raises(ToolError, match="did not confirm"):
        await server.create_branch("octo/hello", "b", from_ref=SHA1)


async def test_create_branch_already_exists_message(gh):
    gh.add("POST", "/repos/octo/hello/git/refs", 422, {"message": "Reference already exists"})
    with pytest.raises(ToolError, match="Reference already exists"):
        await server.create_branch("octo/hello", "b", from_ref=SHA1)


def setup_commit_flow(gh, *, default="main", branch="feat", patch_status=200):
    gh.add("GET", "/repos/octo/hello", 200, repo_json(default))
    gh.add("GET", f"/repos/octo/hello/git/ref/heads/{branch}", 200, {"object": {"sha": SHA1}})
    gh.add("GET", f"/repos/octo/hello/git/commits/{SHA1}", 200, {"sha": SHA1, "tree": {"sha": SHA2}})
    gh.add("POST", "/repos/octo/hello/git/blobs", 201, {"sha": SHA3})
    gh.add("POST", "/repos/octo/hello/git/trees", 201, {"sha": SHA4})
    gh.add("POST", "/repos/octo/hello/git/commits", 201, {"sha": SHA5, "html_url": "https://github.com/octo/hello/commit/" + SHA5})
    gh.add("PATCH", f"/repos/octo/hello/git/refs/heads/{branch}", patch_status,
           {"ref": f"refs/heads/{branch}", "object": {"sha": SHA5}} if patch_status == 200 else {"message": "Update is not a fast forward"})


async def test_commit_files_sends_exact_payloads(gh):
    setup_commit_flow(gh)
    out = await server.commit_files("octo/hello", "feat", "Add files", [
        {"path": "src/a.py", "content": "print(1)\n"}, {"path": "docs/é.md", "content": "héllo"}])
    assert gh.payloads("POST", "/repos/octo/hello/git/blobs") == [
        {"content": "print(1)\n", "encoding": "utf-8"}, {"content": "héllo", "encoding": "utf-8"}]
    assert gh.payloads("POST", "/repos/octo/hello/git/trees") == [{
        "base_tree": SHA2,
        "tree": [{"path": "src/a.py", "mode": "100644", "type": "blob", "sha": SHA3},
                 {"path": "docs/é.md", "mode": "100644", "type": "blob", "sha": SHA3}]}]
    assert gh.payloads("POST", "/repos/octo/hello/git/commits") == [
        {"message": "Add files", "tree": SHA4, "parents": [SHA1]}]
    assert gh.payloads("PATCH", "/repos/octo/hello/git/refs/heads/feat") == [{"sha": SHA5, "force": False}]
    assert out["committed"] is True and out["commit_sha"] == SHA5 and out["previous_sha"] == SHA1
    assert out["html_url"].endswith(SHA5) and out["files"] == ["src/a.py", "docs/é.md"]


async def test_commit_files_refuses_default_branch(gh):
    gh.add("GET", "/repos/octo/hello", 200, repo_json("main"))
    with pytest.raises(ToolError, match="default branch"):
        await server.commit_files("octo/hello", "main", "m", [{"path": "a", "content": "b"}])
    assert not gh.calls("POST") and not gh.calls("PATCH")


@pytest.mark.parametrize("value", ["", "false", "1", "yes"])
async def test_commit_files_default_branch_override_requires_exact_true(gh, monkeypatch, value):
    monkeypatch.setenv(server.ALLOW_DEFAULT_ENV, value)
    gh.add("GET", "/repos/octo/hello", 200, repo_json("main"))
    with pytest.raises(ToolError, match="default branch"):
        await server.commit_files("octo/hello", "main", "m", [{"path": "a", "content": "b"}])


async def test_commit_files_default_branch_allowed_with_env(gh, monkeypatch):
    monkeypatch.setenv(server.ALLOW_DEFAULT_ENV, "true")
    setup_commit_flow(gh, branch="main")
    out = await server.commit_files("octo/hello", "main", "m", [{"path": "a", "content": "b"}])
    assert out["committed"] is True


async def test_commit_files_missing_branch(gh):
    gh.add("GET", "/repos/octo/hello", 200, repo_json("main"))
    gh.add("GET", "/repos/octo/hello/git/ref/heads/ghost", 404, {"message": "Not Found"})
    with pytest.raises(ToolError, match="does not exist.*create_branch"):
        await server.commit_files("octo/hello", "ghost", "m", [{"path": "a", "content": "b"}])


async def test_commit_files_ref_update_failure_is_not_reported_as_success(gh):
    setup_commit_flow(gh, patch_status=422)
    with pytest.raises(ToolError, match="NOT updated.*fast forward"):
        await server.commit_files("octo/hello", "feat", "m", [{"path": "a", "content": "b"}])


async def test_commit_files_unconfirmed_blob_aborts(gh):
    setup_commit_flow(gh)
    gh.routes[("POST", "/repos/octo/hello/git/blobs")] = [(201, {"no": "sha"}, {})]
    with pytest.raises(ToolError, match="did not confirm"):
        await server.commit_files("octo/hello", "feat", "m", [{"path": "a", "content": "b"}])
    assert not gh.calls("PATCH")


async def test_commit_files_unconfirmed_ref_update(gh):
    setup_commit_flow(gh)
    gh.routes[("PATCH", "/repos/octo/hello/git/refs/heads/feat")] = [(200, {"object": {"sha": SHA1}}, {})]
    with pytest.raises(ToolError, match="did not confirm"):
        await server.commit_files("octo/hello", "feat", "m", [{"path": "a", "content": "b"}])


async def test_create_pull_request_exact_payload(gh):
    gh.add("POST", "/repos/octo/hello/pulls", 201, {"number": 12, "html_url": "https://github.com/octo/hello/pull/12",
                                                    "state": "open", "draft": False,
                                                    "head": {"ref": "feat"}, "base": {"ref": "main"}})
    out = await server.create_pull_request("octo/hello", "Add x", "feat", "main", body="Details")
    assert gh.payloads("POST", "/repos/octo/hello/pulls") == [
        {"title": "Add x", "head": "feat", "base": "main", "body": "Details"}]
    assert out["html_url"].endswith("/pull/12") and out["number"] == 12 and out["created"] is True


async def test_create_pull_request_omits_body_and_supports_fork_head_and_draft(gh):
    gh.add("POST", "/repos/octo/hello/pulls", 201, {"number": 1, "html_url": "u", "state": "open"})
    await server.create_pull_request("octo/hello", "T", "fork-owner:feat", "main", draft=True)
    assert gh.payloads("POST", "/repos/octo/hello/pulls") == [
        {"title": "T", "head": "fork-owner:feat", "base": "main", "draft": True}]


async def test_create_pull_request_unconfirmed(gh):
    gh.add("POST", "/repos/octo/hello/pulls", 201, {"number": 1})
    with pytest.raises(ToolError, match="did not confirm"):
        await server.create_pull_request("octo/hello", "T", "feat", "main")


async def test_create_pull_request_validation_error_from_github(gh):
    gh.add("POST", "/repos/octo/hello/pulls", 422, {"message": "Validation Failed",
                                                    "errors": [{"message": "No commits between main and feat"}]})
    with pytest.raises(ToolError, match="No commits between"):
        await server.create_pull_request("octo/hello", "T", "feat", "main")


# ------------------------------------------------------------------ error mapping, retries, secrets
@pytest.mark.parametrize("status,needle", [(401, "rejected the token"), (403, "denied access"),
                                           (404, "not found"), (429, "rate limit"), (500, "having problems")])
async def test_upstream_error_mapping(gh, status, needle):
    gh.add("GET", "/repos/octo/hello", status, {"message": "upstream says no"})
    with pytest.raises(ToolError) as exc:
        await server.get_repository("octo/hello")
    assert needle.lower() in str(exc.value).lower()
    assert TOKEN not in str(exc.value)


async def test_rate_limited_403_detected(gh):
    gh.add("GET", "/repos/octo/hello", 403, {"message": "API rate limit exceeded"},
           {"x-ratelimit-remaining": "0", "x-ratelimit-reset": "1700000000"})
    with pytest.raises(ToolError, match="rate limit.*1700000000"):
        await server.get_repository("octo/hello")


async def test_get_retries_429_and_5xx_then_succeeds(gh):
    gh.add("GET", "/repos/octo/hello", 429, {"message": "slow down"}, {"retry-after": "1"})
    gh.add("GET", "/repos/octo/hello", 502, {"message": "bad gateway"})
    gh.add("GET", "/repos/octo/hello", 200, repo_json())
    out = await server.get_repository("octo/hello")
    assert out["full_name"] == "octo/hello" and len(gh.requests) == 3


async def test_get_gives_up_after_limited_retries(gh):
    gh.add("GET", "/repos/octo/hello", 500, {"message": "boom"})
    with pytest.raises(ToolError, match="500"):
        await server.get_repository("octo/hello")
    assert len(gh.requests) == server.MAX_RETRIES + 1


async def test_post_is_never_retried(gh):
    gh.add("POST", "/repos/octo/hello/git/refs", 500, {"message": "boom"})
    with pytest.raises(ToolError, match="500"):
        await server.create_branch("octo/hello", "b", from_ref=SHA1)
    assert len(gh.requests) == 1


async def test_404_is_not_retried(gh):
    gh.add("GET", "/repos/octo/hello", 404, {"message": "Not Found"})
    with pytest.raises(ToolError, match="not found"):
        await server.get_repository("octo/hello")
    assert len(gh.requests) == 1


async def test_timeout_maps_to_tool_error(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", TOKEN)
    monkeypatch.setattr(server, "BACKOFF_BASE", 0)

    def boom(request):
        raise httpx.ReadTimeout("slow", request=request)

    monkeypatch.setattr(server, "get_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(boom)))
    with pytest.raises(ToolError, match="Timed out"):
        await server.get_repository("octo/hello")


async def test_connection_error_maps_to_tool_error(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", TOKEN)
    monkeypatch.setattr(server, "BACKOFF_BASE", 0)

    def boom(request):
        raise httpx.ConnectError(f"cannot connect with {TOKEN}", request=request)

    monkeypatch.setattr(server, "get_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(boom)))
    with pytest.raises(ToolError) as exc:
        await server.get_repository("octo/hello")
    assert "Could not reach GitHub" in str(exc.value) and TOKEN not in str(exc.value)


async def test_token_echoed_by_upstream_is_scrubbed_from_errors(gh):
    gh.add("GET", "/repos/octo/hello", 403, {"message": f"Bad credentials for {TOKEN} and Bearer {TOKEN}"})
    with pytest.raises(ToolError) as exc:
        await server.get_repository("octo/hello")
    assert TOKEN not in str(exc.value)


async def test_custom_token_format_is_scrubbed_from_errors(gh, monkeypatch):
    odd = "not-a-recognisable-token-format-123"
    monkeypatch.setenv("GITHUB_TOKEN", odd)
    gh.add("GET", "/repos/octo/hello", 403, {"message": f"nope {odd}"})
    with pytest.raises(ToolError) as exc:
        await server.get_repository("octo/hello")
    assert odd not in str(exc.value)


async def test_redirect_is_reported_not_followed(gh):
    gh.add("GET", "/repos/octo/hello", 301, {"message": "Moved Permanently"}, {"location": "https://api.github.com/x"})
    with pytest.raises(ToolError, match="renamed or moved"):
        await server.get_repository("octo/hello")


async def test_invalid_json_response(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", TOKEN)
    monkeypatch.setattr(server, "get_client", lambda: httpx.AsyncClient(
        transport=httpx.MockTransport(lambda r: httpx.Response(200, text="<html>nope</html>"))))
    with pytest.raises(ToolError, match="not valid JSON"):
        await server.get_repository("octo/hello")


# ------------------------------------------------------------------ server wiring / annotations
EXPECTED = {
    "list_repositories": "read", "get_repository": "read", "get_repository_tree": "read", "read_file": "read",
    "list_commits": "read", "list_branches": "read", "list_issues": "read", "list_pull_requests": "read",
    "get_pull_request": "read", "get_repository_activity": "read",
    "create_branch": "write", "commit_files": "write", "create_pull_request": "write",
}


async def test_tools_registered_with_correct_annotations():
    tools = {t.name: t for t in await server.build_server().list_tools()}
    assert set(tools) == set(EXPECTED)
    for name, risk in EXPECTED.items():
        ann = tools[name].annotations
        assert ann is not None, name
        if risk == "read":
            assert ann.readOnlyHint is True and ann.destructiveHint is False, name
        else:
            assert ann.readOnlyHint is False and ann.destructiveHint is False, name


async def test_tool_schemas_expose_contract_args():
    tools = {t.name: t for t in await server.build_server().list_tools()}
    props = lambda n: set(tools[n].inputSchema["properties"])  # noqa: E731
    assert {"repo", "path"} <= props("read_file") and "ref" in props("read_file")
    assert {"repo", "branch", "message", "files"} == props("commit_files")
    assert {"repo", "title", "head", "base"} <= props("create_pull_request")
    assert {"repo", "branch"} <= props("create_branch") and "from_ref" in props("create_branch")
    assert tools["commit_files"].inputSchema["required"] == ["repo", "branch", "message", "files"]


async def test_call_tool_through_fastmcp_validates_and_runs(gh):
    mcp = server.build_server()
    gh.add("GET", "/repos/octo/hello/branches", 200, [{"name": "main", "commit": {"sha": SHA1}, "protected": False}])
    result = await mcp.call_tool("list_branches", {"repo": "octo/hello"})
    assert "main" in json.dumps(result, default=str)
    with pytest.raises(ToolError):
        await mcp.call_tool("list_branches", {"repo": "not valid"})
    with pytest.raises(ToolError):
        await mcp.call_tool("list_commits", {"repo": "octo/hello", "limit": 5000})


def test_module_does_not_write_to_stdout(capsys, monkeypatch):
    import logging

    monkeypatch.setenv("GITHUB_TOKEN", TOKEN)
    server.log.info("hello")
    logging.getLogger("devpilot.github").warning("warn")
    assert capsys.readouterr().out == ""
