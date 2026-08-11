from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from prune_social_profiles import partition_profiles  # noqa: E402


def test_recent_official_confirmation_remains_active():
    reference = datetime(2026, 8, 11, 12, 0, tzinfo=timezone.utc)
    records = [{"profile_url": "https://bsky.app/profile/a.fr", "last_confirmed_at": "2026-08-10T12:00:00+00:00"}]
    active, stale = partition_profiles(records, 7, reference)
    assert len(active) == 1
    assert stale == []


def test_old_or_missing_confirmation_is_quarantined():
    reference = datetime(2026, 8, 11, 12, 0, tzinfo=timezone.utc)
    records = [
        {"profile_url": "https://bsky.app/profile/old.fr", "last_confirmed_at": "2026-08-01T12:00:00+00:00", "source_tier": "tier_1_primary_official"},
        {"profile_url": "https://youtube.com/@unknown"},
    ]
    active, stale = partition_profiles(records, 7, reference)
    assert active == []
    assert len(stale) == 2
    assert all(row["source_tier"] == "tier_4_discovery_only" for row in stale)
    assert all(row["collection_state"] == "stale_not_confirmed_on_official_site" for row in stale)
