from datetime import datetime, timezone
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from canonical_queue import CanonicalQueue, QUEUE_DIR  # noqa: E402


def git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(root), *args],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return result.stdout.strip()


def test_due_batch_can_restore_head_without_losing_pending_snapshot(tmp_path: Path):
    root = tmp_path / "repo"
    (root / "data").mkdir(parents=True)
    (root / "registries").mkdir()
    (root / "corpus" / "2027").mkdir(parents=True)
    (root / "proposals").mkdir()
    (root / "data" / "entities.json").write_text('{"version": 1}\n', encoding="utf-8")
    (root / "registries" / "candidates.yaml").write_text("candidates: []\n", encoding="utf-8")
    (root / "corpus" / "2027" / "base.md").write_text("base\n", encoding="utf-8")
    (root / "proposals" / "base.md").write_text("base\n", encoding="utf-8")
    git(root, "init", "-q")
    git(root, "config", "user.name", "tests")
    git(root, "config", "user.email", "tests@example.com")
    git(root, "add", ".")
    git(root, "commit", "-q", "-m", "baseline")

    queue = CanonicalQueue(root)
    (root / "proposals" / "queued.md").write_text("queued\n", encoding="utf-8")
    due = queue.evaluate(datetime.now(timezone.utc), 0)
    assert due.publish is True
    assert (root / "proposals" / "queued.md").exists()
    assert (root / QUEUE_DIR / "manifest.json").exists()

    queue.restore_head()
    assert not (root / "proposals" / "queued.md").exists()
    assert (root / QUEUE_DIR / "manifest.json").exists()

    assert queue.prepare() is True
    assert (root / "proposals" / "queued.md").read_text(encoding="utf-8") == "queued\n"
