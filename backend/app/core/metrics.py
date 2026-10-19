import os
import time

from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Counter, Histogram, generate_latest, multiprocess
from prometheus_client.core import GaugeMetricFamily
from sqlalchemy import func

from app.core.database import SessionLocal
from app.models import PaymentWebhookInbox, Refund


requests = Counter("legal_http_requests_total", "API responses by route and status", ["method", "route", "status"])
latency = Histogram("legal_http_duration_seconds", "API response duration", ["method", "route"], buckets=(0.01, 0.05, 0.1, 0.3, 1, 3, 10, 30, 90, 120))


def observe(request, status, started):
    route = getattr(request.scope.get("route"), "path", "unmatched")
    requests.labels(request.method, route, str(status)).inc()
    latency.labels(request.method, route).observe(time.perf_counter() - started)


def export_metrics(monitor):
    if os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
        registry = CollectorRegistry()
        multiprocess.MultiProcessCollector(registry)
    else:
        registry = CollectorRegistry()
        for metric in (requests, latency):
            registry.register(metric)
    ready = GaugeMetricFamily("legal_component_ready", "Cached component readiness", labels=["component"])
    for name, status in monitor.snapshot()[1]["components"].items():
        ready.add_metric([name], int(status["status"] == "ok"))
    pending = GaugeMetricFamily("legal_payment_inbox", "Durable payment inbox events", labels=["status"])
    refunds = GaugeMetricFamily("legal_refunds", "Refund tasks", labels=["status"])
    try:
        with SessionLocal() as db:
            for status, count in db.query(PaymentWebhookInbox.status, func.count()).group_by(PaymentWebhookInbox.status):
                pending.add_metric([status], count)
            for status, count in db.query(Refund.status, func.count()).group_by(Refund.status):
                refunds.add_metric([status], count)
    except Exception:
        ready.add_metric(["metrics_database"], 0)

    class SnapshotCollector:
        def collect(self):
            yield ready
            yield pending
            yield refunds

    registry.register(SnapshotCollector())
    return generate_latest(registry), CONTENT_TYPE_LATEST
