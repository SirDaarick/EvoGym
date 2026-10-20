from app.observability.metrics import RequestMetrics


def test_metrics_bound_method_route_and_status_dimensions():
    metrics = RequestMetrics()
    for index in range(1000):
        metrics.observe("GET", f"/members/{index}?token=secret", 200, 1.5)
    metrics.observe("TRACE-EVIL", "unmatched", 500, 2.0)
    snapshot = metrics.snapshot()
    assert len(snapshot) == 2
    assert all("secret" not in str(key) and "members/" not in str(key) for key in snapshot)
    assert snapshot[("GET", "unmatched", "2xx")]["count"] == 1000
    assert snapshot[("OTHER", "unmatched", "5xx")]["count"] == 1


def test_metrics_cap_valid_route_series_and_use_overflow_bucket():
    metrics = RequestMetrics(max_series=8)
    for index in range(100):
        metrics.observe("GET", f"/members/{index}", 200, 1)
    snapshot = metrics.snapshot()
    assert len(snapshot) <= 8
    assert snapshot[("OTHER", "series_limit", "other")]["count"] == 93
