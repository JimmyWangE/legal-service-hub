from collections import defaultdict, deque
from threading import Lock
from time import monotonic, time

from app.core.config import get_settings


class RateLimiter:
    def __init__(self):
        self.settings = get_settings()
        self._lock = Lock()
        self._windows: dict[str, deque[float]] = defaultdict(deque)
        self._redis = None
        if self.settings.redis_url:
            try:
                import redis

                self._redis = redis.Redis.from_url(self.settings.redis_url, decode_responses=True, socket_connect_timeout=0.5, socket_timeout=0.5)
            except Exception:
                self._redis = None

    def allow(self, key: str) -> bool:
        limit = self.settings.rate_limit_per_minute
        if limit <= 0:
            return True
        if self._redis:
            try:
                bucket = f"rate:{key}:{int(time() // 60)}"
                count = self._redis.eval("local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], 61) end; return count", 1, bucket)
                return count <= limit
            except Exception:
                if self.settings.app_env in {"staging", "production"} and not self.settings.allow_rate_limit_fallback:
                    from app.core.errors import DomainError

                    raise DomainError("共享限流暂不可用", 503, "rate_limit_unavailable")
        now = monotonic()
        with self._lock:
            window = self._windows[key]
            while window and window[0] <= now - 60:
                window.popleft()
            if len(window) >= limit:
                return False
            window.append(now)
            if len(self._windows) > 10000:
                self._windows = defaultdict(deque, {entry: values for entry, values in self._windows.items() if values and values[-1] > now - 60})
            return True


rate_limiter = RateLimiter()
