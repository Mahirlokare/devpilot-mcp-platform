"""FastAPI application entrypoint with lifespan initialization and CORS."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api.routes import api_router
from .config import REPO_ROOT, get_settings
from .db import create_all, session_factory
from .deps import get_mcp_manager
from .seed_workspace import seed_workspace
from .services.tool_gateway import ensure_builtin_servers

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    s = get_settings()
    Path(s.workspace_root).mkdir(parents=True, exist_ok=True)
    if not (REPO_ROOT / "workspace" / "sample.db").exists():
        seed_workspace()
    await create_all()
    async with session_factory()() as session:
        await ensure_builtin_servers(session)
    try:
        yield
    finally:
        await get_mcp_manager().shutdown()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(
        title="DevPilot API",
        version="0.1.0",
        description="AI Developer Platform Powered by Model Context Protocol (MCP)",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(api_router)

    @app.get("/health")
    async def root_health() -> dict[str, str]:
        return {"status": "ok"}

    dist_dir = REPO_ROOT / "frontend" / "dist"
    index_html = dist_dir / "index.html"
    if index_html.is_file():
        assets_dir = dist_dir / "assets"
        if assets_dir.is_dir():
            app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="frontend-assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def serve_spa(full_path: str):
            candidate = (dist_dir / full_path).resolve()
            if full_path and candidate.is_file() and dist_dir.resolve() in candidate.parents:
                return FileResponse(str(candidate))
            return FileResponse(str(index_html))

    return app


app = create_app()
