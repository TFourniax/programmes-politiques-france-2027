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
    state = {
        "structured_primary_health": {
            "lfi-programme-chapters": {
                "owner": "La France insoumise",
                "status": 200,
                "complete": True,
                "expected_items": 18,
                "item_count": 18,
                "full_content_items": 18,
                "checked_at": "2026-08-12T15:00:00+00:00",
                "api_endpoint": "https://melenchon2027.fr/wp-json/wp/v2/posts?...",
                "coverage_urls": [
                    "https://programme.lafranceinsoumise.fr/",
                    "https://melenchon2027.fr/programme2025/livre/",
                ],
                "chapter_numbers": list(range(1, 19)),
            }
        }
    }
    coverage = healthy_structured_primary_coverage(state)
    assert set(coverage) == {
        "https://programme.lafranceinsoumise.fr/",
        "https://melenchon2027.fr/programme2025/livre/",
    }
    targets = [
        {"url": "https://programme.lafranceinsoumise.fr/", "owner": "La France insoumise", "kind": "registry_source"},
        {"url": "https://melenchon2027.fr/programme2025/livre/", "owner": "La France insoumise", "kind": "party_programme"},
    ]
    payload = update_records(
        {}, targets, {item["url"] for item in targets}, "2026-08-12T15:01:00+00:00",
        structured_coverage=coverage,
    )
    assert payload["uncovered_failure_count"] == 0
    assert payload["persistent_failure_count"] == 0
    assert payload["structured_primary_coverage_count"] == 2
    assert all(row["status"] == "ok_via_official_structured_primary" for row in payload["sources"].values())
    assert all(row["coverage_type"] == "full_primary_structured_equivalent" for row in payload["sources"].values())


def test_incomplete_structured_programme_never_masks_html_failure():
    state = {
        "structured_primary_health": {
            "lfi-programme-chapters": {
                "owner": "La France insoumise",
                "status": 206,
                "complete": False,
                "expected_items": 18,
                "item_count": 17,
                "full_content_items": 17,
                "coverage_urls": ["https://melenchon2027.fr/programme2025/livre/"],
            }
        }
    }
    coverage = healthy_structured_primary_coverage(state)
    assert coverage == {}
    target = [{"url": "https://melenchon2027.fr/programme2025/livre/", "owner": "La France insoumise", "kind": "party_programme"}]
    payload = update_records({}, target, {target[0]["url"]}, "2026-08-12T15:01:00+00:00", structured_coverage=coverage)
    assert payload["uncovered_failure_count"] == 1
    assert payload["sources"][target[0]["url"]]["status"] == "transient_failure"


class FakeResponse:
    def __init__(self, rows, pages=1):
        self._rows = rows
        self.headers = {"X-WP-TotalPages": str(pages)}

    def raise_for_status(self):
        return None

    def json(self):
        return self._rows


class FakeSession:
    def __init__(self, rows):
        self.rows = rows
        self.urls = []

    def get(self, url, timeout=30):
        self.urls.append(url)
        return FakeResponse(self.rows)


def chapter_row(number, *, old_cycle=False):
    link = (
        f"https://melenchon2027.fr/programme-partage-nupes-2022/chapitre-{number}/"
        if old_cycle else f"https://melenchon2027.fr/chapitre-{number}-test/"
    )
    return {
        "id": (500 if old_cycle else 1000) + number,
        "date": "2022-06-01T10:00:00" if old_cycle else "2026-08-12T10:00:00",
        "modified": "2026-08-12T11:00:00" if old_cycle else f"2026-08-12T10:{number:02d}:00",
        "status": "publish",
        "link": link,
        "title": {"rendered": f"Chapitre {number} : Test {number}"},
        "content": {"rendered": f"<p>{'Mesure politique documentée. ' * 30}</p>"},
    }


def structured_config(**extra):
    return {
        "id": "test",
        "owner": "Parti test",
        "api_base": "https://melenchon2027.fr",
        "minimum_expected_chapters": 18,
        "min_content_chars": 500,
        "link_pattern": r"^https://melenchon2027\.fr/chapitre-[0-9]+-",
        **extra,
    }


def test_wordpress_fetch_uses_minimal_stable_query_contract():
    session = FakeSession([chapter_row(1)])
    rows, _, _ = fetch_wordpress_rows(session, "https://melenchon2027.fr", structured_config())
    assert len(rows) == 1
    query = parse_qs(urlsplit(session.urls[0]).query)
    assert query["search"] == ["Chapitre"]
    assert query["per_page"] == ["100"]
    assert "after" not in query
    assert "orderby" not in query
    assert "order" not in query


def test_archived_chapter_with_same_number_never_replaces_current_cycle():
    rows = [chapter_row(number) for number in range(1, 19)]
    # This archive is deliberately marked as more recently modified than the current
    # chapter. URL scope must win over WordPress metadata recency.
    rows.append(chapter_row(7, old_cycle=True))
    chapters, health = wordpress_chapters(FakeSession(rows), structured_config())
    assert health["complete"] is True
    assert health["out_of_scope_items"] == 1
    assert chapters[6]["link"] == "https://melenchon2027.fr/chapitre-7-test/"


def test_new_chapter_above_known_baseline_is_automatically_ingested():
    session = FakeSession([chapter_row(number) for number in range(1, 20)])
    chapters, health = wordpress_chapters(session, structured_config(
        coverage_urls=["https://melenchon2027.fr/programme/"]
    ))
    assert len(chapters) == 19
    assert health["complete"] is True
    assert health["item_count"] == 19
    assert health["expected_items"] == 19
    assert health["minimum_expected_items"] == 18
    assert health["chapter_numbers"] == list(range(1, 20))
    assert chapters[-1]["number"] == 19


def test_gap_in_extended_chapter_sequence_is_unhealthy():
    rows = [chapter_row(number) for number in range(1, 20) if number != 18]
    chapters, health = wordpress_chapters(FakeSession(rows), structured_config())
    assert len(chapters) == 18
    assert health["highest_chapter_number"] == 19
    assert health["contiguous"] is False
    assert health["complete"] is False
    assert health["status"] == 206
