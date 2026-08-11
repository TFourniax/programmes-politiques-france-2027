from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from verify_social import handle_matches_site, identity_name_matches  # noqa: E402


def test_identity_name_matching_rejects_embedded_third_party():
    assert identity_name_matches("Debout la France", "Debout La France")
    assert not identity_name_matches("Debout la France", "Agence France-Presse")
    assert not identity_name_matches("Debout la France", "Cerfia")


def test_bluesky_domain_handle_can_prove_site_identity():
    assert handle_matches_site("lesecologistes.fr", "https://lesecologistes.fr/")
    assert handle_matches_site("news.lesecologistes.fr", "https://www.lesecologistes.fr/")
    assert not handle_matches_site("other.example", "https://lesecologistes.fr/")
