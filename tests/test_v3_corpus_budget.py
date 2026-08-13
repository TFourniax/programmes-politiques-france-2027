"""Production corpus-loss budget for the V3 baseline.

The generic validator intentionally keeps bootstrap minimums. This test protects the
actual mature V3 product against accidental mass deletion while allowing normal growth.
Old/superseded evidence is versioned rather than deleted, so crossing these floors is
always suspicious and must be investigated explicitly.
"""
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from common import markdown_files  # noqa: E402

MIN_V3_CANDIDATES = 40
MIN_V3_PARTIES = 25
MIN_V3_DOCUMENTS = 60
MIN_V3_PROPOSALS = 1000


def test_v3_corpus_volume_cannot_silently_collapse():
    entities = json.loads((ROOT / "data" / "entities.json").read_text(encoding="utf-8"))
    candidates = len(entities.get("candidates") or [])
    parties = len(entities.get("parties") or [])
    documents = len(list(markdown_files("corpus/2027")))
    proposals = len(list(markdown_files("proposals")))

    assert candidates >= MIN_V3_CANDIDATES, f"V3 candidate coverage collapsed: {candidates} < {MIN_V3_CANDIDATES}"
    assert parties >= MIN_V3_PARTIES, f"V3 party coverage collapsed: {parties} < {MIN_V3_PARTIES}"
    assert documents >= MIN_V3_DOCUMENTS, f"V3 document coverage collapsed: {documents} < {MIN_V3_DOCUMENTS}"
    assert proposals >= MIN_V3_PROPOSALS, f"V3 proposal coverage collapsed: {proposals} < {MIN_V3_PROPOSALS}"
