"""Seed script that creates a realistic sample SQLite project database and sample source files in devpilot/workspace."""
from __future__ import annotations

import sqlite3
from pathlib import Path

WORKSPACE = Path(__file__).resolve().parents[2] / "workspace"


def seed_workspace() -> Path:
    WORKSPACE.mkdir(parents=True, exist_ok=True)
    (WORKSPACE / "app_service.py").write_text(
        '''"""Sample microservice module inside the DevPilot workspace."""
from __future__ import annotations


def calculate_discount(price: float, tier: str) -> float:
    """Compute tiered discount price."""
    rates = {"gold": 0.20, "silver": 0.10, "bronze": 0.05}
    discount = rates.get(tier.lower(), 0.0)
    return round(price * (1.0 - discount), 2)


class OrderProcessor:
    """Processes customer orders."""

    def __init__(self, tax_rate: float = 0.08) -> None:
        self.tax_rate = tax_rate

    def total(self, subtotal: float, tier: str = "bronze") -> float:
        discounted = calculate_discount(subtotal, tier)
        return round(discounted * (1.0 + self.tax_rate), 2)
''',
        encoding="utf-8",
    )

    (WORKSPACE / "test_app_service.py").write_text(
        '''from app_service import OrderProcessor, calculate_discount


def test_calculate_discount():
    assert calculate_discount(100.0, "gold") == 80.0
    assert calculate_discount(50.0, "unknown") == 50.0


def test_order_processor_total():
    proc = OrderProcessor(tax_rate=0.10)
    assert proc.total(100.0, "gold") == 88.0
''',
        encoding="utf-8",
    )

    db_path = WORKSPACE / "sample.db"
    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS customers (
                id INTEGER PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                tier TEXT NOT NULL DEFAULT 'bronze',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY,
                customer_id INTEGER NOT NULL REFERENCES customers(id),
                total_usd REAL NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
            DELETE FROM orders;
            DELETE FROM customers;
            INSERT INTO customers (id, email, tier, created_at) VALUES
                (1, 'ada@example.com', 'gold', '2026-11-01T10:00:00Z'),
                (2, 'grace@example.com', 'silver', '2026-11-05T12:30:00Z'),
                (3, 'linus@example.com', 'bronze', '2026-11-10T09:15:00Z');
            INSERT INTO orders (id, customer_id, total_usd, status, created_at) VALUES
                (101, 1, 240.00, 'completed', '2026-11-12T14:00:00Z'),
                (102, 1, 88.00, 'completed', '2026-11-15T16:20:00Z'),
                (103, 2, 135.50, 'pending', '2026-11-20T11:10:00Z');
            """
        )
        conn.commit()
    finally:
        conn.close()
    return db_path


if __name__ == "__main__":
    p = seed_workspace()
    print(f"Seeded workspace and SQLite database at {p}")
