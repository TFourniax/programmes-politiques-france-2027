from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from social_watch import (  # noqa: E402
    extract_social_profiles,
    relevant_social_text,
    social_profile_from_url,
)


def test_extracts_bluesky_youtube_and_x_profiles():
    raw = b'''
    <html><body>
      <a href="https://bsky.app/profile/exemple.bsky.social">Bluesky</a>
      <a href="https://www.youtube.com/@ExempleOfficiel">YouTube</a>
      <a href="https://x.com/ExempleOff">X</a>
    </body></html>
    '''
    profiles = extract_social_profiles("https://example.fr/", raw, "utf-8")
    got = {(p["platform"], p["identifier"]) for p in profiles}
    assert ("bluesky", "exemple.bsky.social") in got
    assert ("youtube", "@ExempleOfficiel") in got
    assert ("x", "ExempleOff") in got


def test_does_not_confuse_bluesky_post_with_profile():
    assert social_profile_from_url(
        "https://bsky.app/profile/exemple.bsky.social/post/3abc"
    ) is None


def test_youtube_channel_id_is_recognized():
    profile = social_profile_from_url(
        "https://www.youtube.com/channel/UC1234567890abcdef"
    )
    assert profile is not None
    assert profile["platform"] == "youtube"
    assert profile["identifier_type"] == "channel_id"


def test_x_reserved_urls_are_ignored():
    assert social_profile_from_url("https://x.com/intent/tweet") is None
    assert social_profile_from_url("https://twitter.com/search?q=politique") is None


def test_social_relevance_is_conservative_but_broad():
    assert relevant_social_text("Je propose une réforme des retraites pour 2027")
    assert relevant_social_text("Notre priorité est le pouvoir d'achat et le logement")
    assert not relevant_social_text("Merci à toutes et tous pour cette belle soirée !")
