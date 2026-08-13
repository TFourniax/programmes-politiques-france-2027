from pathlib import Path
import sys

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from check_links import check_url, reachable_status  # noqa: E402


class Response:
    def __init__(self, status):
        self.status_code = status


class FakeSession:
    def __init__(self, values):
        self.values = list(values)
        self.calls = 0

    def get(self, *_args, **_kwargs):
        self.calls += 1
        value = self.values.pop(0)
        if isinstance(value, Exception):
            raise value
        return Response(value)


def test_waf_and_rate_limit_statuses_mean_source_still_exists():
    for status in (401, 403, 405, 429):
        assert reachable_status(status)


def test_404_is_retried_then_reported_dead():
    session = FakeSession([404, 404, 404])
    ok, detail, _ = check_url(session, "https://parti.fr/source", attempts=3, sleep=lambda *_: None)
    assert not ok
    assert detail == 404
    assert session.calls == 3


def test_transient_503_recovers_before_becoming_incident():
    session = FakeSession([503, 200])
    ok, detail, _ = check_url(session, "https://parti.fr/source", attempts=3, sleep=lambda *_: None)
    assert ok
    assert detail == 200
    assert session.calls == 2


def test_transient_dns_failure_recovers_before_becoming_incident():
    session = FakeSession([requests.ConnectionError("dns"), 200])
    ok, detail, _ = check_url(session, "https://parti.fr/source", attempts=3, sleep=lambda *_: None)
    assert ok
    assert detail == 200
    assert session.calls == 2
