# DevPilot Deployment & Developer Setup Guide

## 1. Local Developer Setup

### Prerequisites
- **Python 3.11+**
- **Node.js 20+** and **npm**
- **Git**
- *(Optional)* **Docker & Docker Compose** for containerized deployment and PostgreSQL 16 + Redis

### Step 1 — Backend & MCP Servers
```bash
# From the repository root (devpilot/)
python -m venv .venv

# Windows PowerShell:
.\.venv\Scripts\Activate.ps1
# macOS / Linux:
# source .venv/bin/activate

pip install -e "./backend[dev]"

# Copy environment configuration
cp backend/.env.example backend/.env

# Run database migrations (optional in dev; lifespan also runs create_all)
cd backend
alembic upgrade head

# Start the FastAPI backend on http://localhost:8000
uvicorn app.main:app --reload --port 8000
```

### Step 2 — Frontend (Vite + React + TypeScript)
```bash
cd frontend
npm install
npm run dev
```
Open **http://localhost:5173**. The first user you register automatically becomes the platform **`admin`**.

---

## 2. Running the Automated Test Suites

```bash
# Run all Backend & MCP Server tests (from repository root)
pytest -c backend/pyproject.toml --rootdir . -q

# Run Frontend TypeScript check, Vitest unit tests, and production build
cd frontend
npx tsc --noEmit
npm test
npm run build
```

---

## 3. Docker Compose Deployment (PostgreSQL 16 + pgvector + Redis + Backend + Nginx Frontend)

```bash
cp .env.example .env
# Edit .env and set DEVPILOT_JWT_SECRET, DEVPILOT_ENCRYPTION_KEY, and optional API keys
docker compose up --build -d
```
- Frontend UI: **http://localhost:8080**
- Backend OpenAPI Docs: **http://localhost:8000/docs**

---

## 4. Production Deployment (Render + Vercel + Supabase)

### Database (Supabase / Managed PostgreSQL)
1. Provision a PostgreSQL 16 database on Supabase or Render.
2. Copy the connection string into `DEVPILOT_DATABASE_URL` (DevPilot automatically normalizes `postgres://` and `postgresql://` to `postgresql+asyncpg://`).

### Backend (Render Web Service)
1. Deploy `backend/Dockerfile` as a Render Docker Web Service (root directory: `.`).
2. Configure required production environment variables:
   - `DEVPILOT_ENVIRONMENT=production`
   - `DEVPILOT_DATABASE_URL=<your-postgres-url>`
   - `DEVPILOT_JWT_SECRET=<at least 32 random chars>`
   - `DEVPILOT_ENCRYPTION_KEY=<Fernet key>`
   - `DEVPILOT_CORS_ORIGINS=["https://your-frontend.vercel.app"]`
   - `DEVPILOT_OPENAI_API_KEY=<your-openai-key>`
   - `GITHUB_TOKEN`, `RENDER_API_KEY`, `VERCEL_TOKEN` (optional integration credentials)

### Frontend (Vercel)
1. Import the repository into Vercel with **Root Directory** set to `frontend`.
2. Build command: `npm run build`, Output directory: `dist`.
3. Set `VITE_API_BASE=https://your-backend.onrender.com/api/v1` (or configure a Vercel rewrite `/api/:path*` to your Render backend).
