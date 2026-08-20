from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "daily-watch.yml"


def workflow_text() -> str:
    return WORKFLOW.read_text(encoding="utf-8")


def test_source_health_normalization_runs_before_health_snapshot():
    workflow = workflow_text()
    normalize = workflow.index("Normalize reachable anti-bot source responses")
    record = workflow.index("Record autonomous watch health")
    assert normalize < record
    assert "python scripts/normalize_source_health.py" in workflow


def test_watch_state_is_persisted_before_any_canonical_release_gate():
    workflow = workflow_text()
    restore_head = workflow.index("Restore canonical HEAD before persisting watch state")
    persist = workflow.index("Persist autonomous watch state and pending canonical queue")
    restore_batch = workflow.index("Restore queued canonical batch for release validation")
    security = workflow.index("Security audit")
    retrieval = workflow.index("Run retrieval regression tests")
    final_commit = workflow.index("Commit grouped canonical publication")

    assert restore_head < persist < restore_batch < security < retrieval < final_commit
    assert "git add research/veille" in workflow
    assert "python scripts/restore_canonical_head.py" in workflow
    assert "python scripts/canonical_queue.py prepare" in workflow


def test_failed_release_cannot_skip_queue_persistence_or_weaken_release_gates():
    workflow = workflow_text()
    assert "--minimum-hours 48" in workflow
    assert "npm audit --audit-level=high" in workflow
    assert "npm run test:retrieval" in workflow
    assert "npm run build" in workflow
    assert "--project=firefox-smoke --project=webkit-smoke --project=mobile-webkit-smoke" in workflow
    assert "if: steps.canonical.outputs.publish == 'true'" in workflow
