from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from structured_primary_watch import fetch_wordpress_rows, visible_text, wordpress_chapters  # noqa: E402
from update_source_health import healthy_structured_primary_coverage, update_records  # noqa: E402


def test_visible_text_removes_markup_but_keeps_policy_content():
    text = visible_text("<h2>Chapitre 1</h2><p>Nous proposons <strong>une mesure</strong>.</p><script>ignore()</script>")
    assert text == "Chapitre 1 Nous proposons une mesure ."
    assert "ignore" not in text


def test_complete_structured_programme_covers_only_explicit_public_urls():
    state = {"structured_primary_health": {"lfi-programme-chapters": {
        "owner": "La France insoumise", "status": 200, "complete": True,
        "expected_items": 18, "item_count": 18, "full_content_items": 18,
        "checked_at": "2026-08-12T15:00:00+00:00",
        "api_endpoint": "https://melenchon2027.fr/wp-json/wp/v2/search -> details",
        "coverage_urls": ["https://programme.lafranceinsoumise.fr/", "https://melenchon2027.fr/programme2025/livre/"],
        "chapter_numbers": list(range(1, 19)),
    }}}
    coverage = healthy_structured_primary_coverage(state)
    assert set(coverage) == {"https://programme.lafranceinsoumise.fr/", "https://melenchon2027.fr/programme2025/livre/"}
    targets = [
        {"url": "https://programme.lafranceinsoumise.fr/", "owner": "La France insoumise", "kind": "registry_source"},
        {"url": "https://melenchon2027.fr/programme2025/livre/", "owner": "La France insoumise", "kind": "party_programme"},
    ]
    payload = update_records({}, targets, {item["url"] for item in targets}, "2026-08-12T15:01:00+00:00", structured_coverage=coverage)
    assert payload["uncovered_failure_count"] == 0
    assert payload["persistent_failure_count"] == 0
    assert payload["structured_primary_coverage_count"] == 2
    assert all(row["status"] == "ok_via_official_structured_primary" for row in payload["sources"].values())


def test_incomplete_structured_programme_never_masks_html_failure():
    state = {"structured_primary_health": {"lfi-programme-chapters": {
        "owner": "La France insoumise", "status": 206, "complete": False,
        "expected_items": 18, "item_count": 17, "full_content_items": 17,
        "coverage_urls": ["https://melenchon2027.fr/programme2025/livre/"],
    }}}
    coverage = healthy_structured_primary_coverage(state)
    assert coverage == {}
    target = [{"url": "https://melenchon2027.fr/programme2025/livre/", "owner": "La France insoumise", "kind": "party_programme"}]
    payload = update_records({}, target, {target[0]["url"]}, "2026-08-12T15:01:00+00:00", structured_coverage=coverage)
    assert payload["uncovered_failure_count"] == 1
    assert payload["sources"][target[0]["url"]]["status"] == "transient_failure"


class FakeResponse:
    def __init__(self, payload, *, status=200, url="https://melenchon2027.fr/wp-json/wp/v2/search"):
        self._payload = payload
        self.status_code = status
        self.url = url
        self.headers = {"content-type": "application/json; charset=UTF-8"}

    def json(self):
        return self._payload


class FakeSession:
    def __init__(self, *, searches=None, details=None, failed_terms=None, failed_detail_ids=None):
        self.searches = searches or {}
        self.details = details or {}
        self.failed_terms = set(failed_terms or [])
        self.failed_detail_ids = set(failed_detail_ids or [])
        self.calls = []

    def get(self, url, params=None, headers=None, timeout=30, allow_redirects=True):
        params = params or {}
        self.calls.append((url, dict(params)))
        if url.endswith("/wp-json/wp/v2/search"):
            term = str(params.get("search") or "")
            if term in self.failed_terms:
                return FakeResponse([], status=403, url=url)
            return FakeResponse(self.searches.get(term, []), url=url)
        if "/wp-json/wp/v2/posts/" in url:
            item_id = int(url.rstrip("/").rsplit("/", 1)[-1])
            if item_id in self.failed_detail_ids:
                return FakeResponse({}, status=403, url=url)
            if item_id in self.details:
                return FakeResponse(self.details[item_id], url=url)
        return FakeResponse({}, status=404, url=url)


def chapter_row(number, *, old_cycle=False, item_id=None):
    link = (
        f"https://melenchon2027.fr/programme-partage-nupes-2022/chapitre-{number}/"
        if old_cycle else f"https://melenchon2027.fr/chapitre-{number}-test/"
    )
    identifier = item_id or ((500 if old_cycle else 1000) + number)
    return {
        "id": identifier,
        "date": "2022-06-01T10:00:00" if old_cycle else "2026-08-12T10:00:00",
        "modified": "2026-08-12T11:00:00" if old_cycle else f"2026-08-12T10:{number % 60:02d}:00",
        "status": "publish",
        "link": link,
        "title": {"rendered": f"Chapitre {number} : Test {number}"},
        "content": {"rendered": f"<p>{'Mesure politique documentée. ' * 30}</p>"},
    }


def search_row(row):
    return {
        "id": row["id"],
        "title": row["title"]["rendered"],
        "url": row["link"],
        "type": "post",
        "subtype": "post",
    }


def structured_config(**extra):
    return {
        "id": "test",
        "owner": "Parti test",
        "api_base": "https://melenchon2027.fr",
        "search_terms": ["programme", "avenir en commun", "livre"],
        "minimum_expected_chapters": 18,
        "min_content_chars": 500,
        "detail_request_delay_seconds": 0,
        "link_pattern": r"^https://melenchon2027\.fr/chapitre-[0-9]+-",
        **extra,
    }


def complete_session(count=18, *, old_rows=None):
    rows = [chapter_row(number) for number in range(1, count + 1)]
    discovery = [search_row(row) for row in rows]
    if old_rows:
        discovery.extend(search_row(row) for row in old_rows)
        rows.extend(old_rows)
    return FakeSession(
        searches={
            "programme": discovery,
            "avenir en commun": discovery,
            "livre": discovery,
        },
        details={row["id"]: row for row in rows},
    )


def test_discovery_uses_public_terms_without_bulk_content_or_blocked_chapitre_query():
    session = complete_session()
    fetched, endpoint, searches, transport = fetch_wordpress_rows(
        session, "https://melenchon2027.fr", structured_config()
    )
    assert len(fetched) == 18
    assert searches == 3
    assert transport == "public_search_then_individual_full_rest"
    assert "individual /posts/{id}" in endpoint
    search_calls = [(url, query) for url, query in session.calls if url.endswith("/wp-json/wp/v2/search")]
    assert {query["search"] for _, query in search_calls} == {"programme", "avenir en commun", "livre"}
    assert all(query["per_page"] == 100 for _, query in search_calls)
    assert all("_fields" not in query for _, query in search_calls)
    assert all(query["search"].lower() != "chapitre" for _, query in search_calls)
    detail_calls = [url for url, query in session.calls if "/wp-json/wp/v2/posts/" in url]
    assert len(detail_calls) == 18


def test_one_failed_discovery_term_is_tolerated_when_other_official_searches_cover_all_chapters():
    session = complete_session()
    session.failed_terms.add("livre")
    fetched, _, searches, _ = fetch_wordpress_rows(
        session, "https://melenchon2027.fr", structured_config()
    )
    assert len(fetched) == 18
    assert searches == 2


def test_one_missing_full_detail_makes_structured_source_unhealthy_instead_of_silently_partial():
    session = complete_session()
    session.failed_detail_ids.add(1007)
    with pytest.raises(ValueError, match="incomplete WordPress detail retrieval"):
        wordpress_chapters(session, structured_config())


def test_archived_chapter_with_same_number_is_never_selected_as_current_cycle():
    old = chapter_row(7, old_cycle=True, item_id=5007)
    session = complete_session(old_rows=[old])
    chapters, health = wordpress_chapters(session, structured_config())
    assert health["complete"] is True
    assert len(chapters) == 18
    assert chapters[6]["link"] == "https://melenchon2027.fr/chapitre-7-test/"
    # The old URL is filtered during discovery, so its full detail is never fetched.
    assert not any(url.endswith("/posts/5007") for url, _ in session.calls)


def test_new_chapter_above_known_baseline_is_automatically_ingested():
    chapters, health = wordpress_chapters(complete_session(19), structured_config())
    assert len(chapters) == 19
    assert health["complete"] is True
    assert health["expected_items"] == 19
    assert health["minimum_expected_items"] == 18
    assert health["chapter_numbers"] == list(range(1, 20))
    assert chapters[-1]["number"] == 19


def test_gap_in_extended_chapter_sequence_is_unhealthy():
    rows = [chapter_row(number) for number in range(1, 20) if number != 18]
    discovery = [search_row(row) for row in rows]
    session = FakeSession(
        searches={term: discovery for term in ["programme", "avenir en commun", "livre"]},
        details={row["id"]: row for row in rows},
    )
    chapters, health = wordpress_chapters(session, structured_config())
    assert len(chapters) == 18
    assert health["highest_chapter_number"] == 19
    assert health["contiguous"] is False
    assert health["complete"] is False
    assert health["status"] == 206
