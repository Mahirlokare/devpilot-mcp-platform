"""Sample microservice module inside the DevPilot workspace."""
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
