"""Application settings. All secrets come from environment variables (never hardcoded)."""
from __future__ import annotations

import secrets
import sys
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="DEVPILOT_", extra="ignore")

    environment: str = "development"  # development | production | test
    database_url: str = "sqlite+aiosqlite:///./devpilot.db"
    # Secrets: in production these MUST be provided; in dev/test a random per-process value is used
    jwt_secret: str = ""
    encryption_key: str = ""  # Fernet key (urlsafe base64, 32 bytes)
    access_token_minutes: int = 60
    allow_registration: bool = True  # allow users to register accounts directly from the login page
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])
    rate_limit_per_minute: int = 120
    auth_rate_limit_per_minute: int = 10

    # AI
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"
    openai_base_url: str = ""
    # USD per 1M tokens, used only for *estimated* cost
    price_input_per_mtok: float = 2.50
    price_output_per_mtok: float = 10.00

    # Orchestration bounds
    max_steps: int = 12
    max_same_call_repeats: int = 2
    max_step_retries: int = 1
    run_timeout_seconds: int = 300
    tool_timeout_seconds: int = 120
    approval_ttl_minutes: int = 60
    max_tool_output_chars: int = 20000

    # GitHub OAuth (optional)
    github_client_id: str = ""
    github_client_secret: str = ""
    github_redirect_uri: str = "http://localhost:8000/api/v1/integrations/github/callback"
    frontend_url: str = "http://localhost:5173"

    # Built-in MCP servers
    python_executable: str = sys.executable
    workspace_root: str = str(REPO_ROOT / "workspace")  # jail for filesystem/terminal/testing servers
    project_db_url: str = f"sqlite:///{(REPO_ROOT / 'workspace' / 'sample.db').as_posix()}"  # DB the Database MCP server may inspect (read-only)
    builtin_servers_autoregister: bool = True

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


_ephemeral_secrets: dict[str, str] = {}


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.is_production:
        missing = [n for n in ("jwt_secret", "encryption_key") if not getattr(s, n)]
        if missing:
            raise RuntimeError(f"Missing required production settings: {', '.join(missing)}")
        if len(s.jwt_secret) < 32:
            raise RuntimeError("DEVPILOT_JWT_SECRET must be at least 32 characters")
    else:
        if not s.jwt_secret:
            s.jwt_secret = _ephemeral_secrets.setdefault("jwt", secrets.token_urlsafe(48))
        if not s.encryption_key:
            from cryptography.fernet import Fernet

            s.encryption_key = _ephemeral_secrets.setdefault("enc", Fernet.generate_key().decode())
    return s
