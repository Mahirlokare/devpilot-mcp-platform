FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/pyproject.toml /app/backend/pyproject.toml
RUN pip install --no-cache-dir -e /app/backend

COPY backend /app/backend
COPY mcp_servers /app/mcp_servers
RUN mkdir -p /app/workspace && useradd -m -u 1000 devpilot && chown -R devpilot:devpilot /app

USER devpilot
WORKDIR /app/backend

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
