"""
What can go wrong when we call Gemini, sorted by WHOSE fault it is.
Shared by the picture reader (Stage 5b) and the chat (Stage 7): both talk to
the same API, so they must react to its errors the same way.

    429 PerDay      -> QuotaExceeded(daily=True)   switch model / pause until reset
    429 per minute  -> QuotaExceeded(daily=False)  wait a little
    401/403/404     -> GeminiConfigError           OUR setup (key, model name)
    5xx, timeout,   -> ServerBusy                  GOOGLE's problem: retry later,
    no network                                     maybe on the fallback model
    anything else   -> GeminiError                 this request's problem
"""

import re

import httpx
from google import genai
from google.genai import errors, types


class QuotaExceeded(Exception):
    """429 from Google. daily=True: the day's quota is used up (switch model,
    don't retry). daily=False: too many per minute (wait retry_after seconds)."""

    def __init__(self, daily: bool, retry_after: float, message: str):
        super().__init__(message)
        self.daily = daily
        self.retry_after = retry_after


class GeminiError(Exception):
    """Anything else (server error, unreadable answer): retry later."""


class ServerBusy(GeminiError):
    """5xx from Google (503 = overloaded), or no answer within the timeout,
    or no internet. Google's problem (or the network's), not the request's.
    (In the first real run, an overloaded model answered some requests with
    503 and simply never answered others: same cause.)"""


class GeminiConfigError(GeminiError):
    """Our setup is wrong (key rejected, model name unknown): nothing will
    work until someone fixes backend/.env."""


def parse_quota_error(err: errors.APIError) -> QuotaExceeded:
    """A 429 body looks like:
        {"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", "details": [
            {"@type": "...QuotaFailure", "violations": [
                {"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier", ...}]},
            {"@type": "...RetryInfo", "retryDelay": "31s"}]}}
    "PerDay" in the quota id = used up until tomorrow. Its retryDelay is
    misleading (often "1s"), so for a daily quota we ignore it."""
    details = (err.details or {}).get("error", {}).get("details", []) if isinstance(err.details, dict) else []
    quota_ids = [v.get("quotaId", "") for d in details for v in d.get("violations", []) or []]
    delay = 60.0
    for d in details:
        match = re.fullmatch(r"(\d+(?:\.\d+)?)s", str(d.get("retryDelay", "")))
        if match:
            delay = float(match.group(1))
    daily = any("PerDay" in q for q in quota_ids)
    return QuotaExceeded(daily=daily, retry_after=max(delay, 5.0), message=err.message or "quota exceeded")


def translate(err: Exception, timeout_s: float) -> Exception:
    """Turn whatever the SDK / network raised into one of the classes above.
    Use as:  except Exception as err: raise translate(err, ...) from err"""
    if isinstance(err, (QuotaExceeded, GeminiError)):
        return err  # already translated
    if isinstance(err, errors.ClientError):
        if err.code == 429:
            return parse_quota_error(err)
        if err.code in (401, 403, 404):
            # 401/403: key missing, wrong or revoked; 404: model name unknown.
            return GeminiConfigError(f"Gemini rejected our setup ({err.code}): {err.message}")
        # 400: something about this request (e.g. a picture it can't open).
        return GeminiError(f"Gemini refused the request ({err.code}): {err.message}")
    if isinstance(err, errors.ServerError):
        return ServerBusy(f"Gemini's servers are busy ({err.code})")
    if isinstance(err, httpx.TimeoutException):
        return ServerBusy(f"Gemini didn't answer within {timeout_s:.0f} s")
    if isinstance(err, TimeoutError):  # our own asyncio.wait_for limit (chat: first word)
        return ServerBusy("Gemini didn't start answering in time")
    if isinstance(err, httpx.TransportError):  # no internet, Wi-Fi dropped, DNS failed
        return ServerBusy(f"Couldn't reach Gemini ({type(err).__name__})")
    return GeminiError(f"Unexpected problem talking to Gemini ({type(err).__name__})")


def make_client(api_key: str, timeout_ms: int) -> genai.Client:
    # Without a timeout the SDK waits FOREVER (httpx timeout=None): one stalled
    # request froze the picture reader for 10+ minutes in its first real run.
    return genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=timeout_ms))
