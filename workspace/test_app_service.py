from app_service import OrderProcessor, calculate_discount


def test_calculate_discount():
    assert calculate_discount(100.0, "gold") == 80.0
    assert calculate_discount(50.0, "unknown") == 50.0


def test_order_processor_total():
    proc = OrderProcessor(tax_rate=0.10)
    assert proc.total(100.0, "gold") == 88.0
