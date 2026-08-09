from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[1]


def parse_markdown(path: Path):
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise ValueError(f"Missing YAML frontmatter: {path}")
    try:
        _, raw_meta, body = text.split("---", 2)
    except ValueError as exc:
        raise ValueError(f"Invalid frontmatter delimiters: {path}") from exc
    meta = yaml.safe_load(raw_meta) or {}
    if not isinstance(meta, dict):
        raise ValueError(f"Frontmatter must be a mapping: {path}")
    return meta, body.strip()


def markdown_files(relative: str):
    base = ROOT / relative
    if not base.exists():
        return []
    return sorted(p for p in base.rglob("*.md") if p.is_file())


def load_yaml(relative: str):
    path = ROOT / relative
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise ValueError(f"YAML root must be a mapping: {relative}")
    return data
