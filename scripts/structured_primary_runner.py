#!/usr/bin/env python3
from __future__ import annotations

import re
from copy import deepcopy
from typing import Any

import requests

import structured_primary_watch as base
from common import load_yaml as load_yaml_file
from daily_watch import USER_AGENT

MAX_AUTODISCOVERED_EXTRA_CHAPTERS = 100


def _chapter_template(source: dict[str, Any]) -> str:
    configured = str(source.get("chapter_url_template") or "").strip()
    if configured and "{number}" in configured:
        return configured
    urls = [str(url) for url in source.get("chapter_urls") or []]
    if not urls:
        raise ValueError("structured programme has no chapter URL to infer a template")
    last = urls[-1]
    match = re.search(r"(chapitre)(\d+)(/?)$", last, flags=re.I)
    if not match:
        raise ValueError(f"cannot infer chapter URL template from {last}")
    return last[:match.start(2)] + "{number}" + last[match.end(2):]


def extend_chapter_sequence(session: requests.Session, source: dict[str, Any]) -> dict[str, Any]:
    """Extend a known contiguous chapter list until the first definite 404.

    A 200 means a newly published chapter and is appended automatically. A 404 proves
    the current end of the official sequence. Any other status is left as the next probe
    so the normal health logic degrades instead of silently assuming no new chapter.
    """
    out = deepcopy(source)
    urls = [str(url) for url in out.get("chapter_urls") or []]
    minimum = int(out.get("minimum_expected_chapters") or len(urls) or 1)
    if len(urls) < minimum:
        raise ValueError(f"known chapter list shorter than minimum baseline ({len(urls)}<{minimum})")
    template = _chapter_template(out)
    start = len(urls) + 1
    last_probe = None

    for number in range(start, start + MAX_AUTODISCOVERED_EXTRA_CHAPTERS + 1):
        url = template.format(number=number)
        result = base.fetch_public_html(session, url)
        last_probe = url
        status = int(result.get("status") or 0)
        if status == 200:
            text_chars = len(str(result.get("text") or ""))
            if text_chars < int(out.get("min_chapter_chars") or 500):
                raise ValueError(f"new chapter {number} returned implausibly short content ({text_chars} chars)")
            urls.append(url)
            continue
        # 404 is the only status that proves the chapter is not published. For 403/429/
        # 5xx we retain the URL as the health probe; base.collect_source will mark the
        # structured representation incomplete instead of concealing uncertainty.
        out["chapter_urls"] = urls
        out["next_chapter_probe_url"] = url
        out["autodiscovered_chapters"] = max(0, len(urls) - minimum)
        out["autodiscovery_terminal_status"] = status
        return out

    raise ValueError(
        f"chapter autodiscovery exceeded {MAX_AUTODISCOVERED_EXTRA_CHAPTERS} extra chapters without a terminal response; last={last_probe}"
    )


def resolved_watch_config() -> dict[str, Any]:
    config = deepcopy(load_yaml_file("registries/watch.yaml"))
    sources = []
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "fr,en;q=0.7"})
    for source in config.get("official_structured_sources") or []:
        if str(source.get("kind") or "") == "html_programme_tree":
            sources.append(extend_chapter_sequence(session, source))
        else:
            sources.append(source)
    config["official_structured_sources"] = sources
    return config


def main() -> None:
    config = resolved_watch_config()
    original = base.load_yaml

    def patched(name: str):
        if name == "registries/watch.yaml":
            return config
        return original(name)

    base.load_yaml = patched
    try:
        base.main()
    finally:
        base.load_yaml = original


if __name__ == "__main__":
    main()
