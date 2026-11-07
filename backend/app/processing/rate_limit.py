"""
Counting requests so we stay inside Gemini's free-tier limits.

Each model has two limits (AI Studio > Rate limit):
    per minute  e.g. 5   -> wait until the oldest request is 60 s old
    per day     e.g. 20  -> stop using this model until the daily reset

Google resets the daily counter at MIDNIGHT PACIFIC TIME (12:30 PM in
India, 1:30 PM in winter when California changes its clocks), so we use the
"America/Los_Angeles" time zone, which handles that change for us.

The counter lives in memory: after a server restart it starts from zero.
That's fine because Google counts too: if we're over, it answers 429 with a
"PerDay" quota id, and the reader marks the model as used up (see
vision_worker). One wasted request per restart, at most.

Stage 7: Google's limits are per MODEL per PROJECT, so the picture reader and
the chat share ONE limiter per model (limiter_for). The reader runs in its own
thread and every chat answer in a web-request thread, so each limiter has a
LOCK, and "is there room? -> count it" is ONE locked step (try_acquire).
Without that, two threads could both see "1 request left" and both send.
"""

import threading
import time
from collections import deque
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

PACIFIC = ZoneInfo("America/Los_Angeles")


def next_daily_reset(now: float) -> float:
    """The next midnight in California, as a Unix timestamp."""
    local = datetime.fromtimestamp(now, PACIFIC)
    tomorrow = (local + timedelta(days=1)).date()
    return datetime(tomorrow.year, tomorrow.month, tomorrow.day, tzinfo=PACIFIC).timestamp()


class ModelLimiter:
    def __init__(self, model: str, per_minute: int, per_day: int, clock=time.time):
        self.model = model
        self.per_minute = per_minute
        self.per_day = per_day
        self.clock = clock                  # injectable, so tests don't wait real minutes
        self._recent: deque[float] = deque()  # times of requests in the last 60 s
        self._day_count = 0
        self._day_resets_at = next_daily_reset(clock())
        self._blocked_until = 0.0           # Google said: used up for TODAY
        self._slow_until = 0.0              # Google said: too many THIS MINUTE
        self._rest_until = 0.0              # Google kept saying: overloaded (503)
        self.busy_streak = 0                # 503s in a row on this model
        # RLock (re-entrant): a locked method may call another locked method.
        self._lock = threading.RLock()

    def _roll_over(self, now: float) -> None:
        if now >= self._day_resets_at:      # a new Pacific day began
            self._day_count = 0
            self._day_resets_at = next_daily_reset(now)
        while self._recent and now - self._recent[0] >= 60:
            self._recent.popleft()

    def used_up_until(self, reserve: int = 0) -> float | None:
        """When this model can be used again today, or None if it can now.
        reserve: leave this many of today's requests for someone else
        (the picture reader leaves some to the chat)."""
        with self._lock:
            now = self.clock()
            self._roll_over(now)
            if now < self._blocked_until:
                return self._blocked_until
            if self._day_count >= self.per_day - reserve:
                return self._day_resets_at
            if now < self._rest_until:
                return self._rest_until
            return None

    def resting(self) -> bool:
        """True if unusable only because Google is overloaded (not the daily quota)."""
        with self._lock:
            now = self.clock()
            return now < self._rest_until and now >= self._blocked_until and self._day_count < self.per_day

    def wait_seconds(self) -> float:
        """How long to wait before the next request fits in the per-minute limit.
        (Waiting a few seconds is better than switching to a weaker model.)"""
        with self._lock:
            now = self.clock()
            self._roll_over(now)
            slow = max(0.0, self._slow_until - now)
            if len(self._recent) < self.per_minute:
                return slow
            return max(slow, 60 - (now - self._recent[0]))

    def try_acquire(self, reserve: int = 0) -> bool:
        """Check AND count in one locked step: True = you may send now (it is
        already counted), False = not now (daily quota, resting, or this
        minute is full). Call right BEFORE sending: Google counts a request
        even if it fails."""
        with self._lock:
            if self.used_up_until(reserve) is not None or self.wait_seconds() > 0:
                return False
            self._recent.append(self.clock())
            self._day_count += 1
            return True

    def record(self) -> None:
        """Count a request without checking (tests, or a request already sent)."""
        with self._lock:
            now = self.clock()
            self._roll_over(now)
            self._recent.append(now)
            self._day_count += 1

    def block_for_today(self) -> None:
        """Google said the daily quota is used up (429 with a PerDay quota)."""
        with self._lock:
            self._blocked_until = next_daily_reset(self.clock())

    def slow_down(self, seconds: float) -> None:
        """Google said "too many requests right now" (per-minute quota):
        wait, but keep using this model."""
        with self._lock:
            self._slow_until = max(self._slow_until, self.clock() + seconds)

    def rest(self, seconds: float) -> None:
        """Google is overloaded on this model: don't use it for a while
        (the fallback model takes over, if there is one)."""
        with self._lock:
            self._rest_until = max(self._rest_until, self.clock() + seconds)

    @property
    def requests_today(self) -> int:
        with self._lock:
            self._roll_over(self.clock())
            return self._day_count


# ------------------------------------------------------------------
# One limiter per model, shared by everything that calls Gemini
# ------------------------------------------------------------------

_registry: dict[str, ModelLimiter] = {}
_registry_lock = threading.Lock()


def limiter_for(model: str, per_minute: int, per_day: int) -> ModelLimiter:
    """The ONE limiter for this model name (created on first use).
    The picture reader and the chat both call this, so they count together,
    exactly like Google does."""
    with _registry_lock:
        if model not in _registry:
            _registry[model] = ModelLimiter(model, per_minute, per_day)
        return _registry[model]
