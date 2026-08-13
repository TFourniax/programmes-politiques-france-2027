from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from monitored_source_backlog import monitored_source_backlog  # noqa: E402


def state(sha):
    return {"sources": {"https://example.invalid/programme/": {"status": 200, "sha256": sha, "owner": "Example", "resolved_url": "https://example.invalid/programme/"}}}


def test_new_version_is_pending():
    rows = monitored_source_backlog(state("a" * 64), {})
    assert len(rows) == 1
    assert rows[0]["sha256"] == "a" * 64


def test_processed_version_is_not_pending_again():
    promotion = {"source_chunks": {"v": {"url": "https://example.invalid/programme/", "sha256": "a" * 64}}}
    assert monitored_source_backlog(state("a" * 64), promotion) == []


def test_changed_version_is_pending_again():
    promotion = {"source_chunks": {"v": {"url": "https://example.invalid/programme/", "sha256": "a" * 64}}}
    rows = monitored_source_backlog(state("b" * 64), promotion)
    assert rows[0]["sha256"] == "b" * 64
