from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from update_watch_health import build_health  # noqa: E402

STAMP = "2026-08-13T20:00:00+00:00"


def base_state():
    return {"last_run_at": "2026-08-13T19:30:00+00:00"}


def test_quota_only_gemini_is_warning_not_degraded():
    health = build_health(base_state(), {}, {}, {}, False, generated_at=STAMP, source_health={}, gemini_reason="http_429_rate_limit_or_quota")
    assert health["status"] == "healthy"
    assert health["gemini_quota_only"] is True
    assert "gemini_quota_exhausted_promotion_deferred" in health["warnings"]
    assert health["reasons"] == []
