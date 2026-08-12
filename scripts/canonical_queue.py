#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath

CANONICAL_PATHS = (
    "data/entities.json",
    "registries/candidates.yaml",
    "corpus/2027",
    "proposals",
)
QUEUE_DIR = "research/veille/pending-canonical"
MANIFEST_NAME = "manifest.json"
QUEUE_VERSION = 1
DEFAULT_MINIMUM_HOURS = 48.0


@dataclass(frozen=True)
class Evaluation:
    changed: bool
    publish: bool
    queued_files: int
    deleted_files: int
    last_published_at: str | None
    next_eligible_at: str | None

    def as_outputs(self) -> dict[str, str]:
        return {
            "changed": "true" if self.changed else "false",
            "publish": "true" if self.publish else "false",
            "queued_files": str(self.queued_files),
            "deleted_files": str(self.deleted_files),
            "last_published_at": self.last_published_at or "",
            "next_eligible_at": self.next_eligible_at or "",
        }


class CanonicalQueue:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.queue_dir = self.root / QUEUE_DIR
        self.files_dir = self.queue_dir / "files"
        self.manifest_path = self.queue_dir / MANIFEST_NAME

    def _git(self, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", "-C", str(self.root), *args],
            check=check,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    @staticmethod
    def _normalize_repo_path(value: str) -> str:
        candidate = str(PurePosixPath(value))
        if not candidate or candidate == "." or candidate.startswith("../") or candidate.startswith("/"):
            raise ValueError(f"invalid repository path: {value!r}")
        parts = PurePosixPath(candidate).parts
        if ".." in parts:
            raise ValueError(f"invalid repository path: {value!r}")
        return candidate

    @classmethod
    def _is_canonical_path(cls, value: str) -> bool:
        path = cls._normalize_repo_path(value)
        for root in CANONICAL_PATHS:
            if path == root or path.startswith(root.rstrip("/") + "/"):
                return True
        return False

    @classmethod
    def _validated_canonical_path(cls, value: str) -> str:
        path = cls._normalize_repo_path(value)
        if not cls._is_canonical_path(path):
            raise ValueError(f"path outside canonical roots: {value!r}")
        return path

    def _target(self, repo_path: str) -> Path:
        safe = self._validated_canonical_path(repo_path)
        target = (self.root / safe).resolve()
        if target != self.root and self.root not in target.parents:
            raise ValueError(f"canonical path escapes repository: {repo_path!r}")
        return target

    def _snapshot_target(self, repo_path: str) -> Path:
        safe = self._validated_canonical_path(repo_path)
        target = (self.files_dir / safe).resolve()
        files_root = self.files_dir.resolve()
        if target != files_root and files_root not in target.parents:
            raise ValueError(f"queue path escapes queue directory: {repo_path!r}")
        return target

    def _load_manifest(self) -> dict | None:
        if not self.manifest_path.exists():
            return None
        data = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or data.get("version") != QUEUE_VERSION:
            raise ValueError("unsupported or malformed canonical queue manifest")
        files = data.get("files")
        deleted = data.get("deleted_files")
        if not isinstance(files, list) or not isinstance(deleted, list):
            raise ValueError("malformed canonical queue manifest entries")
        for item in files:
            if not isinstance(item, dict):
                raise ValueError("malformed canonical queue file entry")
            self._validated_canonical_path(str(item.get("path") or ""))
            if not isinstance(item.get("sha256"), str) or len(item["sha256"]) != 64:
                raise ValueError("malformed canonical queue checksum")
        for path in deleted:
            self._validated_canonical_path(str(path))
        return data

    def prepare(self) -> bool:
        manifest = self._load_manifest()
        if manifest is None:
            print("No pending canonical queue to restore.")
            return False

        for item in manifest["files"]:
            repo_path = self._validated_canonical_path(item["path"])
            source = self._snapshot_target(repo_path)
            if not source.exists() or not source.is_file():
                raise ValueError(f"queued canonical snapshot missing: {repo_path}")
            payload = source.read_bytes()
            digest = hashlib.sha256(payload).hexdigest()
            if digest != item["sha256"]:
                raise ValueError(f"queued canonical snapshot checksum mismatch: {repo_path}")
            target = self._target(repo_path)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)

        for repo_path in manifest["deleted_files"]:
            target = self._target(repo_path)
            if target.is_dir():
                shutil.rmtree(target)
            elif target.exists() or target.is_symlink():
                target.unlink()

        print(
            f"Restored pending canonical queue: {len(manifest['files'])} files, "
            f"{len(manifest['deleted_files'])} deletions."
        )
        return True

    def _changed_paths(self) -> list[str]:
        args = ["--", *CANONICAL_PATHS]
        changed = set(
            line.strip()
            for line in self._git("diff", "--name-only", "HEAD", *args).stdout.splitlines()
            if line.strip()
        )
        untracked = self._git(
            "ls-files", "--others", "--exclude-standard", *args
        ).stdout.splitlines()
        changed.update(line.strip() for line in untracked if line.strip())
        return sorted(self._validated_canonical_path(path) for path in changed)

    def _head_has_path(self, repo_path: str) -> bool:
        result = self._git("cat-file", "-e", f"HEAD:{repo_path}", check=False)
        return result.returncode == 0

    def _head_bytes(self, repo_path: str) -> bytes:
        result = subprocess.run(
            ["git", "-C", str(self.root), "show", f"HEAD:{repo_path}"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        return result.stdout

    def _clear_queue(self) -> None:
        if self.queue_dir.exists():
            shutil.rmtree(self.queue_dir)

    def snapshot(self, now: datetime) -> tuple[list[dict], list[str]]:
        changed_paths = self._changed_paths()
        if not changed_paths:
            self._clear_queue()
            return [], []

        previous = self._load_manifest()
        created_at = (
            str(previous.get("created_at"))
            if previous and previous.get("created_at")
            else now.isoformat()
        )

        self._clear_queue()
        self.files_dir.mkdir(parents=True, exist_ok=True)
        files: list[dict] = []
        deleted: list[str] = []

        for repo_path in changed_paths:
            target = self._target(repo_path)
            if target.exists() and target.is_file():
                payload = target.read_bytes()
                snapshot = self._snapshot_target(repo_path)
                snapshot.parent.mkdir(parents=True, exist_ok=True)
                snapshot.write_bytes(payload)
                files.append(
                    {
                        "path": repo_path,
                        "sha256": hashlib.sha256(payload).hexdigest(),
                        "size": len(payload),
                    }
                )
            elif not target.exists() and self._head_has_path(repo_path):
                deleted.append(repo_path)
            elif target.exists():
                raise ValueError(f"canonical queue only supports files, got: {repo_path}")

        manifest = {
            "version": QUEUE_VERSION,
            "created_at": created_at,
            "updated_at": now.isoformat(),
            "files": files,
            "deleted_files": deleted,
        }
        self.manifest_path.parent.mkdir(parents=True, exist_ok=True)
        self.manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return files, deleted

    def restore_head(self) -> None:
        for repo_path in self._changed_paths():
            target = self._target(repo_path)
            if self._head_has_path(repo_path):
                payload = self._head_bytes(repo_path)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(payload)
            else:
                if target.is_dir():
                    shutil.rmtree(target)
                elif target.exists() or target.is_symlink():
                    target.unlink()

    def last_canonical_commit(self) -> datetime | None:
        result = self._git(
            "log", "-1", "--format=%cI", "--", *CANONICAL_PATHS, check=False
        )
        value = result.stdout.strip()
        if not value:
            return None
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    def evaluate(self, now: datetime, minimum_hours: float) -> Evaluation:
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
        now = now.astimezone(timezone.utc)
        files, deleted = self.snapshot(now)
        changed = bool(files or deleted)
        if not changed:
            return Evaluation(False, False, 0, 0, None, None)

        last = self.last_canonical_commit()
        next_eligible = last + timedelta(hours=minimum_hours) if last else now
        publish = last is None or now >= next_eligible

        if not publish:
            self.restore_head()

        return Evaluation(
            changed=True,
            publish=publish,
            queued_files=len(files),
            deleted_files=len(deleted),
            last_published_at=last.isoformat() if last else None,
            next_eligible_at=next_eligible.isoformat() if last else now.isoformat(),
        )

    def finalize(self) -> None:
        if not self.manifest_path.exists():
            raise RuntimeError("cannot finalize canonical publication without a pending queue")
        self._clear_queue()
        print("Canonical queue finalized; pending snapshot removed for publication commit.")


def _write_github_output(path: str, outputs: dict[str, str]) -> None:
    with open(path, "a", encoding="utf-8") as handle:
        for key, value in outputs.items():
            handle.write(f"{key}={value}\n")


def _now_from_env_or_clock() -> datetime:
    override = os.environ.get("CANONICAL_QUEUE_NOW", "").strip()
    if override:
        parsed = datetime.fromisoformat(override.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    return datetime.now(timezone.utc)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Persist verified canonical changes until the 48h publication window.")
    parser.add_argument("command", choices=("prepare", "evaluate", "finalize"))
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--minimum-hours", type=float, default=DEFAULT_MINIMUM_HOURS)
    parser.add_argument("--github-output")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    queue = CanonicalQueue(args.root)
    if args.command == "prepare":
        queue.prepare()
        return 0
    if args.command == "finalize":
        queue.finalize()
        return 0

    evaluation = queue.evaluate(_now_from_env_or_clock(), args.minimum_hours)
    outputs = evaluation.as_outputs()
    if args.github_output:
        _write_github_output(args.github_output, outputs)
    print(json.dumps(outputs, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
