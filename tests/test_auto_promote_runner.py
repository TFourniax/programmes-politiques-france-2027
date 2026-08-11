from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from auto_promote_runner import EXTRACTION_SCHEMA, VERIFICATION_SCHEMA, schema_for_prompt  # noqa: E402


def test_schema_selection_is_deterministic():
    assert schema_for_prompt("Tu es un second vérificateur indépendant.") is VERIFICATION_SCHEMA
    assert schema_for_prompt("Tu extrais des données politiques.") is EXTRACTION_SCHEMA


def test_extraction_schema_requires_evidence_quote():
    claim = EXTRACTION_SCHEMA["properties"]["claims"]["items"]
    assert "evidence_quote" in claim["required"]
    assert claim["additionalProperties"] is False


def test_verifier_schema_is_closed_and_conservative():
    verdict = VERIFICATION_SCHEMA["properties"]["verdicts"]["items"]
    assert set(verdict["properties"]["verdict"]["enum"]) == {"CONFIRMED", "REJECTED", "AMBIGUOUS"}
    assert "CONTRADICTS" in verdict["properties"]["relation"]["enum"]
    assert verdict["additionalProperties"] is False
