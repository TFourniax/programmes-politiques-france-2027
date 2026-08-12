from pathlib import Path

social_path = Path('scripts/social_watch.py')
social = social_path.read_text(encoding='utf-8')

if 'import xml.etree.ElementTree as ET' not in social:
    social = social.replace(
        'import re\nfrom html.parser import HTMLParser',
        'import re\nimport xml.etree.ElementTree as ET\nfrom html.parser import HTMLParser',
        1,
    )

if 'def youtube_api_items(' not in social:
    old = 'def youtube_items(\n    session: requests.Session,'
    new = 'def youtube_api_items(\n    session: requests.Session,'
    if old not in social:
        raise SystemExit('youtube_items API function not found')
    social = social.replace(old, new, 1)

marker = '\n\ndef collect_social_events(\n'
if 'def youtube_public_items(' not in social:
    public_helpers = r'''

YOUTUBE_ATOM = "{http://www.w3.org/2005/Atom}"
YOUTUBE_YT = "{http://www.youtube.com/xml/schemas/2015}"
YOUTUBE_MEDIA = "{http://search.yahoo.com/mrss/}"
YOUTUBE_CHANNEL_PATTERN = re.compile(r"UC[A-Za-z0-9_-]{20,}")


def _youtube_channel_id_from_html(text: str) -> str | None:
    patterns = (
        r'"channelId"\s*:\s*"(UC[A-Za-z0-9_-]{20,})"',
        r'"externalId"\s*:\s*"(UC[A-Za-z0-9_-]{20,})"',
        r'"browseId"\s*:\s*"(UC[A-Za-z0-9_-]{20,})"',
        r'itemprop=["\']channelId["\'][^>]+content=["\'](UC[A-Za-z0-9_-]{20,})["\']',
        r'youtube\.com/channel/(UC[A-Za-z0-9_-]{20,})',
    )
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.I)
        if match:
            return match.group(1)
    return None


def _youtube_channel_id(session: requests.Session, profile: dict[str, Any]) -> str:
    if profile.get("identifier_type") == "channel_id":
        identifier = str(profile.get("identifier") or "")
        if YOUTUBE_CHANNEL_PATTERN.fullmatch(identifier):
            return identifier
    response = session.get(str(profile.get("profile_url") or ""), timeout=25)
    response.raise_for_status()
    channel_id = _youtube_channel_id_from_html(response.text)
    if not channel_id:
        raise ValueError("YouTube public profile did not expose a channel id")
    return channel_id


def youtube_public_items(
    session: requests.Session,
    profile: dict[str, Any],
    limit: int,
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    channel_id = _youtube_channel_id(session, profile)
    feed_url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
    response = session.get(feed_url, timeout=25)
    response.raise_for_status()
    try:
        root = ET.fromstring(response.content)
    except ET.ParseError as exc:
        raise ValueError(f"Invalid YouTube public Atom feed: {exc}") from exc

    author = root.find(f"{YOUTUBE_ATOM}author")
    channel_title = ""
    if author is not None:
        channel_title = str(author.findtext(f"{YOUTUBE_ATOM}name") or "").strip()
    if not channel_title:
        feed_title = str(root.findtext(f"{YOUTUBE_ATOM}title") or "").strip()
        channel_title = re.sub(r"^Uploads from\s+", "", feed_title, flags=re.I).strip()

    out: list[dict[str, Any]] = []
    for entry in root.findall(f"{YOUTUBE_ATOM}entry")[: max(1, limit)]:
        video_id = str(entry.findtext(f"{YOUTUBE_YT}videoId") or "").strip()
        if not video_id:
            continue
        title = str(entry.findtext(f"{YOUTUBE_ATOM}title") or "").strip()
        published_at = entry.findtext(f"{YOUTUBE_ATOM}published")
        description = str(entry.findtext(f"{YOUTUBE_MEDIA}group/{YOUTUBE_MEDIA}description") or "").strip()
        link = ""
        for node in entry.findall(f"{YOUTUBE_ATOM}link"):
            if node.attrib.get("rel", "alternate") == "alternate" and node.attrib.get("href"):
                link = str(node.attrib["href"])
                break
        out.append({
            "id": video_id,
            "url": link or f"https://www.youtube.com/watch?v={video_id}",
            "title": title or "Vidéo YouTube",
            "text": f"{title}\n{description}".strip(),
            "published_at": published_at,
        })

    resolved = {
        "channel_id": channel_id,
        "channel_title": channel_title or str(profile.get("entity_name") or ""),
        "display_name": channel_title or str(profile.get("entity_name") or ""),
        "feed_url": feed_url,
        "youtube_transport": "public_atom_feed",
    }
    return out, resolved


def youtube_items(
    session: requests.Session,
    profile: dict[str, Any],
    api_key: str,
    limit: int,
) -> tuple[list[dict[str, Any]], dict[str, str] | None]:
    try:
        return youtube_public_items(session, profile, limit)
    except (requests.RequestException, ValueError) as public_error:
        if not api_key:
            raise requests.RequestException(f"YouTube public feed unavailable: {public_error}") from public_error
    return youtube_api_items(session, profile, api_key, limit)
'''
    if marker not in social:
        raise SystemExit('collect_social_events marker not found')
    social = social.replace(marker, public_helpers + marker, 1)

old_youtube_block = '''        elif platform == "youtube" and youtube_cfg.get("enabled", True):
            if not youtube_key:
                continue
            try:
                items, resolved = youtube_items(
                    session, profile, youtube_key,
                    int(youtube_cfg.get("max_videos_per_channel", 12)),
                )'''
new_youtube_block = '''        elif platform == "youtube" and youtube_cfg.get("enabled", True):
            try:
                items, resolved = youtube_items(
                    session, profile, youtube_key,
                    int(youtube_cfg.get("max_videos_per_channel", 12)),
                )'''
if old_youtube_block in social:
    social = social.replace(old_youtube_block, new_youtube_block, 1)
elif new_youtube_block not in social:
    raise SystemExit('YouTube collection block not found')

social = social.replace(
    'copy["collection_state"] = "profile_verified_waiting_for_free_api_key"',
    'copy["collection_state"] = "active_public_feed"',
)
social = social.replace(
    '"Les chaînes officielles sont enregistrées mais la lecture API attend `YOUTUBE_API_KEY`.",\n            "Cette clé utilise le quota gratuit de YouTube Data API ; aucun budget payant n\'est requis.",',
    '"La collecte YouTube utilise le flux Atom public officiel sans clé.",\n            "`YOUTUBE_API_KEY` reste optionnelle et ne sert que de solution de secours.",',
)
social = social.replace(
    'print("YouTube collection skipped unless YOUTUBE_API_KEY is configured")',
    'print("YouTube public Atom collection active; YOUTUBE_API_KEY is optional fallback")',
)
social_path.write_text(social, encoding='utf-8')

verify_path = Path('scripts/verify_social.py')
verify = verify_path.read_text(encoding='utf-8')
if 'from social_watch import youtube_public_items' not in verify:
    verify = verify.replace(
        'from common import ROOT\n',
        'from common import ROOT\nfrom social_watch import youtube_public_items\n',
        1,
    )

old_verify = '''    elif platform == "youtube":
        if not youtube_key:
            out.update({
                "identity_state": "unverified_waiting_for_youtube_api_key",
                "identity_method": "youtube_api_required_for_identity_check",
            })
        else:
            try:
                resolved = resolve_youtube(session, record, youtube_key)
                if not resolved:
                    out.update({"identity_state": "rejected_profile_not_found", "identity_method": "youtube_channel_lookup"})
                else:
                    verified = identity_name_matches(entity_name, resolved["display_name"])
                    out.update(resolved)
                    out.update({
                        "identity_state": "verified" if verified else "rejected_identity_mismatch",
                        "identity_method": "official_site_link_plus_youtube_channel_identity",
                    })
            except (requests.RequestException, ValueError) as exc:
                out.update({
                    "identity_state": "verification_unavailable",
                    "identity_method": "youtube_channel_lookup_failed",
                    "identity_error": f"{type(exc).__name__}: {exc}",
                })'''
new_verify = '''    elif platform == "youtube":
        public_error = None
        resolved = None
        try:
            _, resolved = youtube_public_items(session, record, 1)
        except (requests.RequestException, ValueError) as exc:
            public_error = exc
        if resolved:
            verified = identity_name_matches(entity_name, resolved.get("display_name") or resolved.get("channel_title"))
            out.update(resolved)
            out.update({
                "identity_state": "verified" if verified else "rejected_identity_mismatch",
                "identity_method": "official_site_link_plus_youtube_public_feed_identity",
            })
        elif youtube_key:
            try:
                resolved = resolve_youtube(session, record, youtube_key)
                if not resolved:
                    out.update({"identity_state": "rejected_profile_not_found", "identity_method": "youtube_channel_lookup"})
                else:
                    verified = identity_name_matches(entity_name, resolved["display_name"])
                    out.update(resolved)
                    out.update({
                        "identity_state": "verified" if verified else "rejected_identity_mismatch",
                        "identity_method": "official_site_link_plus_youtube_api_identity_fallback",
                    })
            except (requests.RequestException, ValueError) as exc:
                out.update({
                    "identity_state": "verification_unavailable",
                    "identity_method": "youtube_identity_lookup_failed",
                    "identity_error": f"public={public_error}; api={type(exc).__name__}: {exc}",
                })
        else:
            out.update({
                "identity_state": "verification_unavailable",
                "identity_method": "youtube_public_feed_identity_unavailable",
                "identity_error": f"{type(public_error).__name__}: {public_error}" if public_error else "public feed unavailable",
            })'''
if old_verify in verify:
    verify = verify.replace(old_verify, new_verify, 1)
elif new_verify not in verify:
    raise SystemExit('YouTube verification block not found')
verify_path.write_text(verify, encoding='utf-8')

social_test = Path('tests/test_social_watch.py')
test_text = social_test.read_text(encoding='utf-8')
import_block = test_text.split('from social_watch import', 1)[1].split(')', 1)[0]
if 'youtube_public_items' not in import_block:
    test_text = test_text.replace(
        '    social_profile_from_url,\n)',
        '    social_profile_from_url,\n    youtube_public_items,\n)',
        1,
    )
if 'test_youtube_public_atom_feed_needs_no_api_key' not in test_text:
    test_text += r'''

class _FakeYoutubeResponse:
    def __init__(self, *, text="", content=b""):
        self.text = text
        self.content = content or text.encode("utf-8")

    def raise_for_status(self):
        return None


class _FakeYoutubeSession:
    def get(self, url, **kwargs):
        if "youtube.com/@ExampleParty" in url:
            return _FakeYoutubeResponse(
                text='<html><body><script>{"channelId":"UCabcdefghijklmnopqrstuv"}</script></body></html>'
            )
        if "feeds/videos.xml" in url:
            return _FakeYoutubeResponse(content=b"""<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
  <author><name>Example Party</name></author>
  <entry>
    <yt:videoId>video123</yt:videoId>
    <title>Notre programme pour 2027</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=video123"/>
    <published>2026-08-12T12:00:00+00:00</published>
    <media:group><media:description>Nous proposons une réforme des retraites.</media:description></media:group>
  </entry>
</feed>""")
        raise AssertionError(url)


def test_youtube_public_atom_feed_needs_no_api_key():
    profile = {
        "identifier_type": "handle",
        "identifier": "@ExampleParty",
        "profile_url": "https://www.youtube.com/@ExampleParty",
        "entity_name": "Example Party",
    }
    items, resolved = youtube_public_items(_FakeYoutubeSession(), profile, 5)
    assert resolved["channel_id"] == "UCabcdefghijklmnopqrstuv"
    assert resolved["display_name"] == "Example Party"
    assert resolved["youtube_transport"] == "public_atom_feed"
    assert len(items) == 1
    assert items[0]["id"] == "video123"
    assert "réforme des retraites" in items[0]["text"]
'''
social_test.write_text(test_text, encoding='utf-8')

verify_test = Path('tests/test_verify_social.py')
verify_test_text = verify_test.read_text(encoding='utf-8')
verify_test_text = verify_test_text.replace(
    'from verify_social import handle_matches_site, identity_name_matches  # noqa: E402',
    'from verify_social import handle_matches_site, identity_name_matches, verify_profile  # noqa: E402',
)
if 'test_youtube_identity_can_be_verified_from_public_atom_feed_without_key' not in verify_test_text:
    verify_test_text += r'''

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
'''
verify_test.write_text(verify_test_text, encoding='utf-8')
