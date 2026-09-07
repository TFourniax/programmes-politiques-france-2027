from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from status_fast_lane import (  # noqa: E402
    candidate_pool,
    detect_status_transition,
    mentioned_candidates,
    supported_effective_date,
    transition_allowed,
)


def pcf_source(text: str | None = None):
    return {
        "url": "https://www.pcf.fr/presidentielle2027_fabien_roussel_designe_candidat",
        "title": "Élection présidentielle : Fabien Roussel désigné candidat à 72% par les communistes",
        "text": text or (
            "Élection présidentielle : Fabien Roussel désigné candidat à 72% par les communistes. "
            "Publié le 06 septembre 2026. Paris, le 6 septembre 2026. "
            "Le PCF propose donc la candidature de Fabien Roussel à l’élection présidentielle de 2027."
        ),
    }


def test_pcf_roussel_designation_is_zero_cost_deterministic():
    candidate = {"id": "fabien-roussel", "name": "Fabien Roussel", "primary_party_id": "pcf"}
    assert detect_status_transition(pcf_source(), candidate, "party") == "party_designated"


def test_explicit_candidate_owned_presidential_declaration_is_deterministic():
    candidate = {"id": "alice", "name": "Alice Martin", "primary_party_id": "parti-x"}
    source = {
        "url": "https://alicemartin.fr/presidentielle-2027",
        "title": "Présidentielle 2027",
        "text": "Le 7 septembre 2026. Je suis candidate à l'élection présidentielle de 2027.",
    }
    assert detect_status_transition(source, candidate, "candidate") == "declared_presidential"


def test_generic_presidential_article_does_not_create_a_status():
    candidate = {"id": "fabien-roussel", "name": "Fabien Roussel", "primary_party_id": "pcf"}
    source = {
        "url": "https://www.pcf.fr/presidentielle-2027-debat",
        "title": "Présidentielle 2027 : le débat continue",
        "text": "Fabien Roussel participe à une réunion sur la stratégie du parti. Aucun choix n'est annoncé.",
    }
    assert detect_status_transition(source, candidate, "party") is None


def test_party_source_must_identify_exactly_one_candidate_before_promotion():
    candidates = {
        "alice": {"id": "alice", "name": "Alice Martin", "primary_party_id": "parti-x"},
        "bob": {"id": "bob", "name": "Bob Durand", "primary_party_id": "parti-x"},
        "other": {"id": "other", "name": "Claire Dupont", "primary_party_id": "parti-y"},
    }
    pool = candidate_pool("parti-x", "party", candidates)
    source = {
        "url": "https://parti-x.fr/presidentielle-2027",
        "title": "Présidentielle 2027",
        "text": "Alice Martin et Bob Durand sont mentionnés dans ce compte rendu.",
    }
    assert {candidate["id"] for candidate in pool} == {"alice", "bob"}
    assert {candidate["id"] for candidate in mentioned_candidates(source, pool)} == {"alice", "bob"}


def test_effective_date_requires_same_date_inside_primary_source():
    event = {"published_at": "2026-09-06T18:39:35Z"}
    assert supported_effective_date(event, pcf_source()) == "2026-09-06"
    source_without_date = pcf_source("Fabien Roussel désigné candidat à l'élection présidentielle de 2027.")
    assert supported_effective_date(event, source_without_date) is None


def test_deterministic_lane_is_monotonic_and_cannot_downgrade_declared_candidate():
    assert transition_allowed("potential", "party_designated")
    assert transition_allowed("potential", "declared_presidential")
    assert transition_allowed("party_designated", "declared_presidential")
    assert not transition_allowed("declared_presidential", "party_designated")
    assert not transition_allowed("official_candidate", "declared_presidential")
