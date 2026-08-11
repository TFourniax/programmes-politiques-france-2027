from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from gdelt_watch import chunks, gdelt_query, match_entities  # noqa: E402


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
