from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from gdelt_watch import chunks, gdelt_query, match_entities, request_batch  # noqa: E402


def test_chunks_reduces_request_count():
    items = list(range(34))
    batches = chunks(items, 6)
    assert len(batches) == 6
    assert sum(len(batch) for batch in batches) == 34


def test_gdelt_query_groups_candidate_names():
    query = gdelt_query([
        {"id": "a", "name": "Gabriel Attal"},
        {"id": "b", "name": "Édouard Philippe"},
    ])
    assert '"Gabriel Attal" OR "Édouard Philippe"' in query
    assert "présidentielle OR programme" in query


def test_match_entities_prefers_full_or_unique_last_name():
    entities = [
        {"id": "attal", "name": "Gabriel Attal"},
        {"id": "philippe", "name": "Édouard Philippe"},
    ]
    assert [e["id"] for e in match_entities("Gabriel Attal dévoile son projet", entities)] == ["attal"]
    assert [e["id"] for e in match_entities("Philippe précise sa position pour 2027", entities)] == ["philippe"]


def test_match_entities_does_not_use_ambiguous_last_name():
    entities = [
        {"id": "a", "name": "Jean Martin"},
        {"id": "b", "name": "Paul Martin"},
    ]
    assert match_entities("Martin réagit à la campagne", entities) == []


def test_request_batch_uses_configured_bounded_timeout():
    observed = {}

    class Response:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {"articles": []}

    class Session:
        def get(self, _url, *, params, timeout):
            observed["params"] = params
            observed["timeout"] = timeout
            return Response()

    articles, error = request_batch(
        Session(),
        [{"id": "attal", "name": "Gabriel Attal"}],
        {
            "request_timeout_seconds": 12,
            "max_retries": 0,
            "max_records_per_batch": 20,
            "timespan": "1d",
        },
    )
    assert articles == []
    assert error is None
    assert observed["timeout"] == 12


def test_request_timeout_is_clamped_to_safe_bounds():
    timeouts = []

    class Response:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {"articles": []}

    class Session:
        def get(self, _url, *, params, timeout):
            timeouts.append(timeout)
            return Response()

    batch = [{"id": "attal", "name": "Gabriel Attal"}]
    request_batch(Session(), batch, {"request_timeout_seconds": 1, "max_retries": 0})
    request_batch(Session(), batch, {"request_timeout_seconds": 99, "max_retries": 0})
    assert timeouts == [5.0, 35.0]
