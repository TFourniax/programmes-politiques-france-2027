from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from canonical_queue import CanonicalQueue, QUEUE_DIR  # noqa: E402


def git(root: Path, *args: str, env: dict[str, str] | None = None) -> str:
    merged_env = None
    if env:
        import os
        merged_env = os.environ.copy()
        merged_env.update(env)
    result = subprocess.run(
        ["git", "-C", str(root), *args],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=merged_env,
    )
    return result.stdout.strip()


def make_repo(tmp_path: Path, commit_at: str = "2026-08-12T00:00:00Z") -> Path:
    root = tmp_path / "repo"
    (root / "data").mkdir(parents=True)
    (root / "registries").mkdir()
    (root / "corpus" / "2027").mkdir(parents=True)
    (root / "proposals").mkdir()
    (root / "data" / "entities.json").write_text('{"version": 1}\n', encoding="utf-8")
    (root / "registries" / "candidates.yaml").write_text("candidates: []\n", encoding="utf-8")
    (root / "corpus" / "2027" / "base.md").write_text("base\n", encoding="utf-8")
    (root / "proposals" / "base.json").write_text('{"base": true}\n', encoding="utf-8")
    git(root, "init", "-q")
    git(root, "config", "user.name", "tests")
    git(root, "config", "user.email", "tests@example.com")
    git(root, "add", ".")
    git(
        root,
        "commit",
        "-q",
        "-m",
        "baseline canonical publication",
        env={"GIT_AUTHOR_DATE": commit_at, "GIT_COMMITTER_DATE": commit_at},
    )
    return root


def utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def test_queue_holds_then_publishes_full_accumulated_batch(tmp_path: Path):
    root = make_repo(tmp_path)
    queue = CanonicalQueue(root)

    (root / "data" / "entities.json").write_text('{"version": 2}\n', encoding="utf-8")
    (root / "proposals" / "queued.json").write_text('{"queued": true}\n', encoding="utf-8")

    early = queue.evaluate(utc("2026-08-13T00:00:00Z"), 48)
    assert early.changed is True
    assert early.publish is False
    assert early.next_eligible_at == "2026-08-14T00:00:00+00:00"
    assert (root / "data" / "entities.json").read_text(encoding="utf-8") == '{"version": 1}\n'
    assert not (root / "proposals" / "queued.json").exists()
    assert (root / QUEUE_DIR / "manifest.json").exists()

    assert queue.prepare() is True
    assert (root / "data" / "entities.json").read_text(encoding="utf-8") == '{"version": 2}\n'
    assert (root / "proposals" / "queued.json").exists()

    (root / "corpus" / "2027" / "later.md").write_text("later verified evidence\n", encoding="utf-8")
    due = queue.evaluate(utc("2026-08-14T00:00:01Z"), 48)
    assert due.changed is True
    assert due.publish is True
    assert due.queued_files == 3
    assert (root / "data" / "entities.json").read_text(encoding="utf-8") == '{"version": 2}\n'
    assert (root / "proposals" / "queued.json").exists()
    assert (root / "corpus" / "2027" / "later.md").exists()

    queue.finalize()
    assert not (root / QUEUE_DIR).exists()
    assert (root / "data" / "entities.json").read_text(encoding="utf-8") == '{"version": 2}\n'


def test_deleted_canonical_file_survives_queue_round_trip(tmp_path: Path):
    root = make_repo(tmp_path)
    queue = CanonicalQueue(root)
    target = root / "proposals" / "base.json"
    target.unlink()

    early = queue.evaluate(utc("2026-08-13T00:00:00Z"), 48)
    assert early.publish is False
    assert early.deleted_files == 1
    assert target.exists()

    queue.prepare()
    assert not target.exists()

    due = queue.evaluate(utc("2026-08-14T01:00:00Z"), 48)
    assert due.publish is True
    assert due.deleted_files == 1
    assert not target.exists()


def test_prepare_rejects_manifest_path_escape(tmp_path: Path):
    root = make_repo(tmp_path)
    queue_dir = root / QUEUE_DIR
    queue_dir.mkdir(parents=True)
    (queue_dir / "manifest.json").write_text(
        json.dumps(
            {
                "version": 1,
                "created_at": "2026-08-13T00:00:00+00:00",
                "updated_at": "2026-08-13T00:00:00+00:00",
                "files": [{"path": "../outside", "sha256": "0" * 64, "size": 0}],
                "deleted_files": [],
            }
        ),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="invalid repository path"):
        CanonicalQueue(root).prepare()


def test_no_canonical_change_does_not_create_queue(tmp_path: Path):
    root = make_repo(tmp_path)
    evaluation = CanonicalQueue(root).evaluate(utc("2026-08-14T12:00:00Z"), 48)
    assert evaluation.changed is False
    assert evaluation.publish is False
    assert not (root / QUEUE_DIR).exists()
