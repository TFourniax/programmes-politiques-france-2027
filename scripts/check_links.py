#!/usr/bin/env python3
import argparse
import time

import requests

from common import load_yaml, markdown_files, parse_markdown

PROTECTED_OR_RATE_LIMITED = {401, 403, 405, 429}
RETRYABLE_HTTP = {408, 425, 500, 502, 503, 504}


def collect_urls():
    urls = set()
    for path in markdown_files("corpus/2027"):
        meta, _ = parse_markdown(path)
        if meta.get("source_url"):
            urls.add(str(meta["source_url"]))
    for source in load_yaml("registries/sources.yaml").get("sources", []):
        if source.get("url"):
            urls.add(str(source["url"]))
    return sorted(urls)


def reachable_status(status: int) -> bool:
    return status < 400 or status in PROTECTED_OR_RATE_LIMITED


def check_url(session: requests.Session, url: str, *, attempts: int = 3, timeout: float = 15.0, sleep=time.sleep):
    last = None
    for attempt in range(1, max(1, attempts) + 1):
        try:
            response = session.get(url, timeout=timeout, allow_redirects=True, stream=True)
            status = int(response.status_code)
            if reachable_status(status):
                return True, status, attempt
            last = status
            if status not in RETRYABLE_HTTP and status != 404:
                break
        except requests.RequestException as exc:
            last = f"{type(exc).__name__}: {exc}"
        if attempt < attempts:
            sleep(min(4.0, 0.75 * (2 ** (attempt - 1))))
    return False, last, max(1, attempts)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--strict", action="store_true", help="fail on unreachable links after bounded retries")
    parser.add_argument("--attempts", type=int, default=3)
    parser.add_argument("--timeout", type=float, default=15.0)
    args = parser.parse_args()

    failures = []
    session = requests.Session()
    session.headers.update({"User-Agent": "programmes-politiques-france-2027-link-check/2.0"})
    urls = collect_urls()

    for url in urls:
        ok, detail, used = check_url(session, url, attempts=args.attempts, timeout=args.timeout)
        marker = "OK " if ok else "ERR"
        print(f"{marker} {detail!s:>4} {url} (attempts={used})")
        if not ok:
            failures.append((url, detail))

    if args.strict and failures:
        sample = "; ".join(f"{url} [{detail}]" for url, detail in failures[:8])
        raise SystemExit(f"{len(failures)} source link(s) failed after retries: {sample}")
    print(f"Checked {len(urls)} source URLs; {len(failures)} warning(s)")


if __name__ == "__main__":
    main()
