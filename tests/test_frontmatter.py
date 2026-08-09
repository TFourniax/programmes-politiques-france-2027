from pathlib import Path
import json
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from common import ROOT, markdown_files, parse_markdown  # noqa: E402


def test_all_corpus_has_frontmatter_and_source():
    files = list(markdown_files("corpus/2027"))
    assert files
    for path in files:
        meta, body = parse_markdown(path)
        assert meta["document_id"]
        assert meta["entity_id"]
        assert meta["source_url"]
        assert body.strip()


def test_all_proposals_reference_existing_document():
    document_ids = {parse_markdown(path)[0]["document_id"] for path in markdown_files("corpus/2027")}
    for path in markdown_files("proposals"):
        meta, body = parse_markdown(path)
        assert meta["proposal_id"]
        sources = meta.get("source_document_ids") or meta.get("source_document_id")
        assert sources
        if isinstance(sources, str):
            sources = [sources]
        assert set(sources).issubset(document_ids)
        assert meta["certainty"]
        assert body.strip()


def test_candidate_statuses_never_implicitly_become_official():
    with (ROOT / "data" / "entities.json").open(encoding="utf-8") as handle:
        data = json.load(handle)
    assert data["snapshot_date"] == "2026-08-09"
    for candidate in data["candidates"]:
        if candidate.get("current_status") == "official_candidate":
            assert candidate.get("official_candidate") is True
        else:
            assert candidate.get("official_candidate") is False
