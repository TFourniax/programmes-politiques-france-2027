from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from common import ROOT, load_yaml, markdown_files, parse_markdown  # noqa: E402


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
        assert meta["source_document_id"] in document_ids
        assert meta["certainty"]
        assert body.strip()


def test_candidate_statuses_never_implicitly_become_official():
    candidates = load_yaml("registries/candidates.yaml").get("candidates", [])
    for candidate in candidates:
        if candidate.get("current_status") == "official_candidate":
            assert candidate.get("official_candidate_verified_at"), (
                f"{candidate['id']} is official_candidate without institutional verification date"
            )
