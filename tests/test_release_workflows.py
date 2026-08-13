from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def test_canonical_publication_uses_cross_browser_config_explicitly():
    workflow = read(".github/workflows/daily-watch.yml")
    assert "npx playwright test -c playwright.v31.config.mjs --project=chromium --project=mobile-chromium" in workflow
    assert (
        "npx playwright test -c playwright.v31.config.mjs "
        "--project=firefox-smoke --project=webkit-smoke --project=mobile-webkit-smoke"
    ) in workflow


def test_48h_grouped_publication_budget_is_preserved():
    workflow = read(".github/workflows/daily-watch.yml")
    assert "--minimum-hours 48" in workflow
    assert "Build canonical coverage report" in workflow


def test_hardening_workflows_pin_official_actions_to_commit_shas():
    for relative in (
        ".github/workflows/watch-health.yml",
        ".github/workflows/v31-hardening.yml",
        ".github/workflows/gemini-healthcheck.yml",
    ):
        content = read(relative)
        for line in content.splitlines():
            stripped = line.strip()
            if "uses: actions/" not in stripped:
                continue
            ref = stripped.split("@", 1)[1].split()[0]
            assert len(ref) == 40, f"{relative} has floating action ref: {stripped}"
            int(ref, 16)
