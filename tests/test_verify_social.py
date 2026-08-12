from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from verify_social import handle_matches_site, identity_name_matches, verify_profile  # noqa: E402


def test_identity_name_matching_rejects_embedded_third_party():
    assert identity_name_matches("Debout la France", "Debout La France")
    assert not identity_name_matches("Debout la France", "Agence France-Presse")
    assert not identity_name_matches("Debout la France", "Cerfia")


def test_bluesky_domain_handle_can_prove_site_identity():
    assert handle_matches_site("lesecologistes.fr", "https://lesecologistes.fr/")
    assert handle_matches_site("news.lesecologistes.fr", "https://www.lesecologistes.fr/")
    assert not handle_matches_site("other.example", "https://lesecologistes.fr/")


class _IdentityFeedResponse:
    text = ""
    content = b"""<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
  <author><name>La France insoumise</name></author>
  <entry>
    <yt:videoId>abc123</yt:videoId>
    <title>Programme</title>
    <published>2026-08-12T12:00:00+00:00</published>
    <media:group><media:description>Programme 2027</media:description></media:group>
  </entry>
</feed>"""

    def raise_for_status(self):
        return None


class _IdentityFeedSession:
    def get(self, url, **kwargs):
        assert "feeds/videos.xml?channel_id=UCKHKSD-yanY2ZwwU_4Tgf0w" in url
        return _IdentityFeedResponse()


def test_youtube_identity_can_be_verified_from_public_atom_feed_without_key():
    record = {
        "platform": "youtube",
        "identifier_type": "channel_id",
        "identifier": "UCKHKSD-yanY2ZwwU_4Tgf0w",
        "profile_url": "https://www.youtube.com/channel/UCKHKSD-yanY2ZwwU_4Tgf0w",
        "entity_id": "la-france-insoumise",
        "entity_name": "La France insoumise",
        "entity_type": "party",
        "source_site": "https://lafranceinsoumise.fr/",
    }
    result = verify_profile(_IdentityFeedSession(), record, "")
    assert result["identity_state"] == "verified"
    assert result["identity_method"] == "official_site_link_plus_youtube_public_feed_identity"
    assert result["source_tier"] == "tier_1_primary_official"
