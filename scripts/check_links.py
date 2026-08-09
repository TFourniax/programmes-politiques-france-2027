#!/usr/bin/env python3
import argparse
import requests
from common import load_yaml, markdown_files, parse_markdown


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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--strict", action="store_true", help="fail on unreachable links")
    args = parser.parse_args()
    failures = []
    headers = {"User-Agent": "programmes-politiques-france-2027-link-check/1.0"}
    for url in collect_urls():
        try:
            response = requests.get(url, headers=headers, timeout=15, allow_redirects=True, stream=True)
            ok = response.status_code < 400 or response.status_code in {401, 403, 405, 429}
            print(f"{response.status_code:3} {url}")
            if not ok:
                failures.append((url, response.status_code))
        except requests.RequestException as exc:
            print(f"ERR {url} — {exc}")
            failures.append((url, str(exc)))
    if args.strict and failures:
        raise SystemExit(f"{len(failures)} source link(s) failed")
    print(f"Checked {len(collect_urls())} source URLs; {len(failures)} warning(s)")


if __name__ == "__main__":
    main()
