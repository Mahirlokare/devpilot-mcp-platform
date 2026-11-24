"""Tests for the read-only Database MCP server (SQLite & mocked PostgreSQL)."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest
from mcp.server.fastmcp.exceptions import ToolError

from mcp_servers.database import server


@pytest.fixture
def sample_sqlite_db(tmp_path: Path, monkeypatch) -> Path:
    db_file = tmp_path / "app.db"
    conn = sqlite3.connect(db_file)
    conn.executescript(
        """
        PRAGMA foreign_keys = ON;
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            api_secret TEXT
        );
        CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE INDEX idx_posts_user_id ON posts(user_id);
        INSERT INTO users (id, email, api_secret) VALUES
            (1, 'alice@example.com', 'password=supersecretvalue123'),
            (2, 'bob@example.com', 'normal_note');
        INSERT INTO posts (id, user_id, title) VALUES
            (10, 1, 'Hello MCP'),
            (11, 1, 'Database tools'),
            (12, 2, 'Query analysis');
        """
    )
    conn.commit()
    conn.close()
    monkeypatch.setenv("DEVPILOT_PROJECT_DB_URL", f"sqlite:///{db_file.as_posix()}")
    return db_file


# ------------------------------------------------------------------ SQLite inspection & queries
async def test_list_and_describe_tables_sqlite(sample_sqlite_db):
    listing = await server.list_tables()
    assert listing["dialect"] == "sqlite"
    assert [t["name"] for t in listing["tables"]] == ["posts", "users"]
    assert listing["tables"][0]["row_count"] == 3

    desc = await server.describe_table("posts")
    assert desc["table"] == "posts"
    assert [c["name"] for c in desc["columns"]] == ["id", "user_id", "title"]
    assert desc["columns"][0]["primary_key"] is True
    assert any(idx["name"] == "idx_posts_user_id" for idx in desc["indexes"])
    assert desc["foreign_keys"] == [
        {"column": "user_id", "references_table": "users", "references_column": "id"}
    ]


async def test_describe_table_rejects_unknown_or_injected_table(sample_sqlite_db):
    for bad in ("nonexistent", "users; DROP TABLE users", "sqlite_master"):
        with pytest.raises(ToolError, match="does not exist"):
            await server.describe_table(bad)


async def test_run_readonly_query_truncation_and_redaction(sample_sqlite_db):
    res = await server.run_readonly_query(
        "WITH p AS (SELECT id, title FROM posts ORDER BY id) SELECT * FROM p",
        limit=2,
    )
    assert res["row_count"] == 2
    assert res["truncated"] is True
    assert res["rows"][0]["title"] == "Hello MCP"

    # Literals containing SQL keywords/semicolons are allowed, and secrets in cell outputs are redacted
    res2 = await server.run_readonly_query(
        "SELECT email, api_secret, 'DROP TABLE users; --' AS note FROM users WHERE id = 1"
    )
    assert res2["row_count"] == 1
    assert "supersecretvalue123" not in json.dumps(res2)
    assert res2["rows"][0]["note"] == "DROP TABLE users; --"


# ------------------------------------------------------------------ SQL security validator
@pytest.mark.parametrize(
    "bad_sql",
    [
        "",
        "   ",
        "SELECT 1; SELECT 2",
        "SELECT * FROM users; DROP TABLE users",
        "INSERT INTO users(email) VALUES ('x@y.com')",
        "UPDATE users SET email = 'x@y.com'",
        "DELETE FROM users",
        "DROP TABLE users",
        "ALTER TABLE users ADD COLUMN age INT",
        "CREATE TABLE hacked(id INT)",
        "TRUNCATE TABLE users",
        "REPLACE INTO users(id, email) VALUES (1, 'a')",
        "WITH d AS (DELETE FROM users RETURNING *) SELECT * FROM d",
        "SELECT * INTO users_copy FROM users",
        "PRAGMA query_only = OFF",
        "ATTACH DATABASE 'other.db' AS other",
        "DETACH DATABASE main",
        "VACUUM",
        "REINDEX",
        "GRANT ALL ON users TO public",
        "REVOKE ALL ON users FROM public",
        "COPY users TO '/tmp/out'",
        "CALL some_proc()",
        "DO $$ BEGIN PERFORM 1; END $$",
        "EXECUTE stmt",
        "SELECT pg_sleep(10)",
        "SELECT pg_read_file('/etc/passwd')",
        "SELECT lo_import('/etc/passwd')",
        "SELECT load_extension('evil.so')",
        "SELECT * FROM users FOR UPDATE",
        "SELECT * FROM users /* unclosed comment",
        "SELECT 'unclosed literal FROM users",
    ],
)
async def test_validator_rejects_unsafe_or_multi_statement_sql(sample_sqlite_db, bad_sql):
    with pytest.raises(ToolError):
        await server.run_readonly_query(bad_sql)


# ------------------------------------------------------------------ explain, analyze, schema docs
async def test_explain_query_sqlite(sample_sqlite_db):
    plan_scan = await server.explain_query("SELECT * FROM posts WHERE title = 'Hello MCP'")
    assert plan_scan["dialect"] == "sqlite"
    assert plan_scan["has_full_scan"] is True

    plan_idx = await server.explain_query("SELECT id FROM posts WHERE user_id = 1")
    assert plan_idx["has_full_scan"] is False


async def test_analyze_query_heuristics_and_plan(sample_sqlite_db):
    sql = (
        "SELECT * FROM users "
        "WHERE LOWER(email) LIKE '%@example.com' OR id = 1 OR id = 2"
    )
    analysis = await server.analyze_query(sql)
    rules = {issue["rule"] for issue in analysis["issues"]}
    assert "select_star" in rules
    assert "missing_limit" in rules
    assert "leading_wildcard_like" in rules
    assert "function_on_column_in_where" in rules
    assert "or_chain" in rules
    assert "full_table_scan" in rules


async def test_generate_schema_docs_markdown_and_mermaid(sample_sqlite_db):
    docs = await server.generate_schema_docs()
    assert docs["table_count"] == 2
    assert "## `users`" in docs["markdown"]
    assert "## `posts`" in docs["markdown"]
    assert "erDiagram" in docs["mermaid"]
    assert "users ||--o{ posts : user_id" in docs["mermaid"]


# ------------------------------------------------------------------ PostgreSQL mocked flow
class FakePgConn:
    def __init__(self) -> None:
        self.executed: list[str] = []
        self.closed = False

    async def execute(self, sql: str) -> None:
        self.executed.append(sql)

    async def fetch(self, sql: str, *args):
        self.executed.append(sql)
        if "FROM pg_class c" in sql and not args:
            return [{"name": "accounts", "type": "table", "row_count": 42}]
        if sql.startswith("EXPLAIN "):
            return [("Seq Scan on accounts  (cost=0.00..1.42 rows=42 width=32)",)]
        return [{"id": 1, "name": "Acme"}]

    async def close(self) -> None:
        self.closed = True


async def test_postgres_readonly_transaction_and_queries(monkeypatch):
    monkeypatch.setenv("DEVPILOT_PROJECT_DB_URL", "postgresql://user:pass@localhost:5432/testdb")
    fake_conn = FakePgConn()

    async def fake_connect(dsn: str):
        assert dsn == "postgresql://user:pass@localhost:5432/testdb"
        return fake_conn

    monkeypatch.setattr(server, "_pg_connect", fake_connect)

    tables = await server.list_tables()
    assert tables["dialect"] == "postgres"
    assert tables["tables"][0]["name"] == "accounts"
    assert "BEGIN READ ONLY" in fake_conn.executed
    assert "ROLLBACK" in fake_conn.executed
    assert fake_conn.closed is True

    res = await server.run_readonly_query("SHOW server_version")
    assert res["dialect"] == "postgres" and res["row_count"] == 1

    exp = await server.explain_query("SELECT * FROM accounts")
    assert exp["has_full_scan"] is True


async def test_tools_registered_with_read_annotations():
    tools = {t.name: t for t in await server.build_server().list_tools()}
    expected = {
        "list_tables",
        "describe_table",
        "run_readonly_query",
        "explain_query",
        "analyze_query",
        "generate_schema_docs",
    }
    assert set(tools) == expected
    for name, tool in tools.items():
        assert tool.annotations is not None, name
        assert tool.annotations.readOnlyHint is True, name
        assert tool.annotations.destructiveHint is False, name
