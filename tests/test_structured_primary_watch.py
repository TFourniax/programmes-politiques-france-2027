from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from structured_primary_watch import visible_text  # noqa: E402
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
