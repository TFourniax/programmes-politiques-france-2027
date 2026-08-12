from pathlib import Path
import sys
from urllib.parse import parse_qs, urlsplit

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
        "api_endpoint": "https://melenchon2027.fr/wp-json/wp/v2/posts?...",
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
    def __init__(self, payload, *, status=200, pages=1, url="https://melenchon2027.fr/wp-json/wp/v2/posts"):
        self._payload = payload
        self.status_code = status
        self.url = url
        self.headers = {"X-WP-TotalPages": str(pages), "content-type": "application/json; charset=UTF-8"}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


class FakeSession:
    def __init__(self, rows, *, direct_status=200, search_rows=None, details=None):
        self.rows = rows
        self.direct_status = direct_status
        self.search_rows = search_rows or []
        self.details = details or {}
        self.urls = []
        self.calls = []

    def get(self, url, params=None, headers=None, timeout=30, allow_redirects=True):
        self.urls.append(url + ("?" + "&".join(f"{k}={v}" for k, v in (params or {}).items()) if params else ""))
        self.calls.append((url, params or {}))
        if url.endswith("/wp-json/wp/v2/posts"):
            return FakeResponse(self.rows if self.direct_status == 200 else [], status=self.direct_status, url=url)
        if url.endswith("/wp-json/wp/v2/search"):
            return FakeResponse(self.search_rows, url=url)
        for item_id, payload in self.details.items():
            if url.endswith(f"/wp-json/wp/v2/posts/{item_id}"):
                return FakeResponse(payload, url=url)
        return FakeResponse({}, status=404, url=url)


def chapter_row(number, *, old_cycle=False):
    link = (
        f"https://melenchon2027.fr/programme-partage-nupes-2022/chapitre-{number}/"
        if old_cycle else f"https://melenchon2027.fr/programme2025/livre/chapitre{number}/"
    )
    return {
        "id": (500 if old_cycle else 1000) + number,
        "date": "2022-06-01T10:00:00" if old_cycle else "2026-08-12T10:00:00",
        "modified": "2026-08-12T11:00:00" if old_cycle else f"2026-08-12T10:{number:02d}:00",
        "status": "publish", "link": link,
        "title": {"rendered": f"Chapitre {number} : Test {number}"},
        "content": {"rendered": f"<p>{'Mesure politique documentée. ' * 30}</p>"},
    }


def search_row(number):
    row = chapter_row(number)
    return {"id": row["id"], "title": row["title"]["rendered"], "url": row["link"], "type": "post", "subtype": "post"}


def structured_config(**extra):
    return {
        "id": "test", "owner": "Parti test", "api_base": "https://melenchon2027.fr",
        "minimum_expected_chapters": 18, "min_content_chars": 500,
        "link_pattern": r"/programme2025/livre/chapitre[0-9]+/?$", **extra,
    }


def test_wordpress_fetch_uses_minimal_stable_query_contract():
    session = FakeSession([chapter_row(1)])
    rows, _, _, transport = fetch_wordpress_rows(session, "https://melenchon2027.fr", structured_config())
    assert len(rows) == 1
    assert transport == "direct_posts_with_content"
    _, query = session.calls[0]
    assert query["search"] == "Chapitre"
    assert query["per_page"] == 100
    assert "after" not in query and "orderby" not in query and "order" not in query


def test_waf_block_on_heavy_list_falls_back_to_search_then_individual_details():
    rows = [chapter_row(number) for number in range(1, 19)]
    session = FakeSession(
        rows,
        direct_status=403,
        search_rows=[search_row(number) for number in range(1, 19)],
        details={row["id"]: row for row in rows},
    )
    fetched, endpoint, _, transport = fetch_wordpress_rows(session, "https://melenchon2027.fr", structured_config())
    assert len(fetched) == 18
    assert transport == "search_then_individual_details"
    assert "wp-json/wp/v2/search" in endpoint
    assert sum(1 for url, _ in session.calls if "/wp-json/wp/v2/posts/" in url) == 18


def test_archived_chapter_with_same_number_never_replaces_current_cycle():
    rows = [chapter_row(number) for number in range(1, 19)] + [chapter_row(7, old_cycle=True)]
    chapters, health = wordpress_chapters(FakeSession(rows), structured_config())
    assert health["complete"] is True
    assert health["out_of_scope_items"] == 1
    assert chapters[6]["link"].endswith("/programme2025/livre/chapitre7/")


def test_new_chapter_above_known_baseline_is_automatically_ingested():
    chapters, health = wordpress_chapters(FakeSession([chapter_row(number) for number in range(1, 20)]), structured_config())
    assert len(chapters) == 19
    assert health["complete"] is True
    assert health["expected_items"] == 19
    assert health["chapter_numbers"] == list(range(1, 20))


def test_gap_in_extended_chapter_sequence_is_unhealthy():
    rows = [chapter_row(number) for number in range(1, 20) if number != 18]
    chapters, health = wordpress_chapters(FakeSession(rows), structured_config())
    assert len(chapters) == 18
    assert health["highest_chapter_number"] == 19
    assert health["contiguous"] is False
    assert health["complete"] is False
    assert health["status"] == 206
