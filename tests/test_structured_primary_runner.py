from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import structured_primary_runner as runner  # noqa: E402


class FakeSession:
    pass


def source():
    return {
        "kind": "html_programme_tree",
        "minimum_expected_chapters": 2,
        "min_chapter_chars": 500,
        "chapter_url_template": "https://parti.fr/programme/chapitre{number}/",
        "chapter_urls": [
            "https://parti.fr/programme/chapitre1/",
            "https://parti.fr/programme/chapitre2/",
        ],
    }


def test_new_chapters_are_appended_until_first_definite_404(monkeypatch):
    statuses = {
        "https://parti.fr/programme/chapitre3/": {"status": 200, "text": "x" * 700},
        "https://parti.fr/programme/chapitre4/": {"status": 200, "text": "x" * 800},
        "https://parti.fr/programme/chapitre5/": {"status": 404, "text": ""},
    }
    monkeypatch.setattr(runner.base, "fetch_public_html", lambda session, url: statuses[url])
    resolved = runner.extend_chapter_sequence(FakeSession(), source())
    assert resolved["chapter_urls"][-2:] == [
        "https://parti.fr/programme/chapitre3/",
        "https://parti.fr/programme/chapitre4/",
    ]
    assert resolved["next_chapter_probe_url"] == "https://parti.fr/programme/chapitre5/"
    assert resolved["autodiscovered_chapters"] == 2
    assert resolved["autodiscovery_terminal_status"] == 404


def test_waf_status_never_gets_interpreted_as_no_new_chapter(monkeypatch):
    monkeypatch.setattr(
        runner.base,
        "fetch_public_html",
        lambda session, url: {"status": 403, "text": "Just a moment..."},
    )
    resolved = runner.extend_chapter_sequence(FakeSession(), source())
    assert resolved["chapter_urls"] == source()["chapter_urls"]
    assert resolved["next_chapter_probe_url"].endswith("chapitre3/")
    assert resolved["autodiscovery_terminal_status"] == 403


def test_implausibly_short_new_chapter_is_rejected(monkeypatch):
    monkeypatch.setattr(
        runner.base,
        "fetch_public_html",
        lambda session, url: {"status": 200, "text": "too short"},
    )
    try:
        runner.extend_chapter_sequence(FakeSession(), source())
    except ValueError as exc:
        assert "implausibly short" in str(exc)
    else:
        raise AssertionError("a short soft-200 page must not be accepted as a new chapter")
