from pathlib import Path
import hashlib
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import structured_primary_watch as watch  # noqa: E402
from update_source_health import healthy_structured_primary_coverage, update_records  # noqa: E402


def test_page_parser_and_section_extraction_remove_site_navigation():
    raw = b"""
    <html><body>
      <nav><h1>L'avenir en commun</h1><a href='/programme2025/livre/chapitre1/s1/'>Mesure test</a></nav>
      <div>Mesure test Autre lien de navigation</div>
      <h1>Mesure test</h1>
      <p>Nous proposons une mesure politique precise et explicitement documentee pour les citoyens.</p>
      <p>Elle comprend aussi une seconde phrase substantielle afin de depasser le seuil de contenu.</p>
      <a>Lire la suite</a><h2>Le menu</h2><p>bruit du pied de page</p>
    </body></html>
    """
    page = watch.page_data(raw)
    title = watch.content_h1(page)
    text = watch.extract_section_text(page, title)
    assert title == "Mesure test"
    assert text.startswith("Mesure test Nous proposons")
    assert "bruit du pied de page" not in text
    assert "Autre lien de navigation" not in text


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
                "api_endpoint": "https://melenchon2027.fr/programme2025/livre/chapitre{n}/ + section pages",
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


def chapter_html(number: int, sections: int = 2) -> bytes:
    links = "".join(
        f"<a href='/programme2025/livre/chapitre{number}/s{index}/'>Section {index}</a>"
        for index in range(1, sections + 1)
    )
    return f"<html><body><h1>Chapitre {number} : Titre {number}</h1>{links}</body></html>".encode()


def section_html(number: int, section: int) -> bytes:
    body = (
        f"Nous proposons dans le chapitre {number} section {section} une mesure politique explicitement documentee. "
        * 8
    )
    title = f"Mesure {number}.{section}"
    return (
        f"<html><body><nav>{title}</nav><h1>{title}</h1><p>{body}</p>"
        f"<a>Lire la suite</a><h2>Le menu</h2><p>pied de page</p></body></html>"
    ).encode()


def install_fake_primary(monkeypatch, tmp_path, *, chapters=18, missing=None, broken_section=None):
    missing = set(missing or [])

    def fake_fetch(url, **kwargs):
        chapter_match = watch.re.search(r"/chapitre(\d+)/?$", url)
        if chapter_match:
            number = int(chapter_match.group(1))
            if number in missing or number > chapters:
                return {"status": 404, "url": url, "content_type": "text/html", "raw": b"not found"}
            return {"status": 200, "url": url, "content_type": "text/html", "raw": chapter_html(number)}
        section_match = watch.re.search(r"/chapitre(\d+)/s(\d+)/?$", url)
        if section_match:
            number, section = map(int, section_match.groups())
            if broken_section == (number, section):
                return {"status": 404, "url": url, "content_type": "text/html", "raw": b"not found"}
            return {"status": 200, "url": url, "content_type": "text/html", "raw": section_html(number, section)}
        raise AssertionError(url)

    monkeypatch.setattr(watch, "fetch_html", fake_fetch)
    monkeypatch.setattr(
        watch,
        "snapshot_path",
        lambda source_id, number: tmp_path / "snapshots" / source_id / f"chapter-{number:02d}.txt",
    )


def config(**extra):
    return {
        "id": "lfi-programme-chapters",
        "owner": "La France insoumise",
        "kind": "html_programme_chapters",
        "public_base": "https://melenchon2027.fr/programme2025/livre",
        "minimum_expected_chapters": 18,
        "max_probe_chapters": 25,
        "stop_after_consecutive_missing": 3,
        "min_content_chars": 500,
        "min_section_chars": 180,
        "request_delay_seconds": 0,
        "coverage_urls": ["https://melenchon2027.fr/programme2025/livre/"],
        **extra,
    }


def test_html_capture_builds_full_hashed_snapshots_for_all_sections(monkeypatch, tmp_path):
    install_fake_primary(monkeypatch, tmp_path, chapters=18)
    chapters, health = watch.collect_html_chapters(config())
    assert health["complete"] is True
    assert health["status"] == 200
    assert health["chapter_numbers"] == list(range(1, 19))
    assert health["item_count"] == health["full_content_items"] == 18
    assert health["total_sections"] == 36
    assert health["transport"] == "official_html_chapter_sections"
    sample = chapters[0]
    path = tmp_path / "snapshots" / "lfi-programme-chapters" / "chapter-01.txt"
    assert path.exists()
    snapshot = path.read_text(encoding="utf-8").rstrip("\n")
    assert "Mesure 1.1" in snapshot and "Mesure 1.2" in snapshot
    assert "pied de page" not in snapshot
    assert sample["sha256"] == hashlib.sha256(snapshot.encode()).hexdigest()
    assert sample["snapshot_path"].endswith("chapter-01.txt")


def test_one_missing_baseline_chapter_is_a_hard_failure(monkeypatch, tmp_path):
    install_fake_primary(monkeypatch, tmp_path, chapters=18, missing={7})
    with pytest.raises(ValueError, match="mandatory programme chapter 7"):
        watch.collect_html_chapters(config())


def test_one_missing_section_is_a_hard_failure(monkeypatch, tmp_path):
    install_fake_primary(monkeypatch, tmp_path, chapters=18, broken_section=(7, 2))
    with pytest.raises(ValueError, match="section unavailable"):
        watch.collect_html_chapters(config())


def test_future_chapter_19_is_automatically_captured(monkeypatch, tmp_path):
    install_fake_primary(monkeypatch, tmp_path, chapters=19)
    chapters, health = watch.collect_html_chapters(config())
    assert len(chapters) == 19
    assert health["complete"] is True
    assert health["expected_items"] == 19
    assert health["highest_chapter_number"] == 19
    assert chapters[-1]["number"] == 19


def test_gap_in_extended_sequence_is_not_silently_accepted(monkeypatch, tmp_path):
    install_fake_primary(monkeypatch, tmp_path, chapters=20, missing={19})
    # Probing continues past one 404; chapter 20 is discovered, making the sequence invalid.
    chapters, health = watch.collect_html_chapters(config())
    assert 20 in [item["number"] for item in chapters]
    assert health["contiguous"] is False
    assert health["complete"] is False
    assert health["status"] == 206
