#!/usr/bin/env python3
"""Fetch GitHub release history and save as JSON.

By default, if a data file already exists for the repo, only new releases
(since the last known tag) are fetched.  Pass --full to re-download everything.
"""

import argparse
import json
import os
import sys
import time
import urllib.request
errors = __import__("urllib.error")
from datetime import datetime, timezone
from pathlib import Path


def _github_request(url: str, token: str | None) -> tuple:
    """Make a GitHub API request, return (data, rate_limit_remaining)."""
    req = urllib.request.Request(url)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "fetch-releases/1.0")
    if token:
        req.add_header("Authorization", f"Bearer {token}")

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req) as resp:
                remaining = resp.headers.get("X-RateLimit-Remaining")
                data = json.loads(resp.read().decode())
                return data, remaining
        except errors.HTTPError as e:
            body = ""
            try:
                body = e.read().decode()
            except Exception:
                pass
            if e.code == 403 and "rate limit" in body.lower():
                wait = min(60, 10 * (attempt + 1))
                print(f"  Rate limit hit, waiting {wait}s...")
                time.sleep(wait)
                continue
            if e.code == 404:
                print(f"  Repo {url.split('/repos/')[1].split('/releases')[0]} not found")
                sys.exit(1)
            raise
        except Exception:
            if attempt < 2:
                time.sleep(3 * (attempt + 1))
                continue
            raise

    return None, None


def _load_existing(filepath: Path) -> dict | None:
    """Return existing data dict or None."""
    if not filepath.exists():
        return None
    try:
        return json.loads(filepath.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def fetch_incremental(repo: str, existing: dict, token: str | None) -> list[dict]:
    """Fetch only releases whose tags are not already in *existing*.

    GitHub returns releases newest-first, so we consume pages until
    we hit a tag we already know about.
    """
    existing_tags = {r["tag"] for r in existing.get("releases", [])}
    new_releases: list[dict] = []
    page = 1
    per_page = 100

    while True:
        url = f"https://api.github.com/repos/{repo}/releases?per_page={per_page}&page={page}"
        data, remaining = _github_request(url, token)
        if not data:
            break

        for rel in data:
            if rel["tag_name"] in existing_tags:
                print(f"  Reached known tag {rel['tag_name']} (page {page}), stopping.")
                return new_releases
            new_releases.append(rel)

        print(f"  Page {page}: {len(data)} releases (rate limit remaining: {remaining})")
        page += 1

        if remaining and int(remaining) <= 2:
            print("  Rate limit low, waiting 10s...")
            time.sleep(10)

    return new_releases


def fetch_all(repo: str, token: str | None) -> list[dict]:
    """Fetch every release, handling pagination."""
    releases: list[dict] = []
    page = 1
    per_page = 100

    while True:
        url = f"https://api.github.com/repos/{repo}/releases?per_page={per_page}&page={page}"
        data, remaining = _github_request(url, token)
        if not data:
            break

        releases.extend(data)
        print(f"  Page {page}: {len(data)} releases (rate limit remaining: {remaining})")
        page += 1

        if remaining and int(remaining) <= 2:
            print("  Rate limit low, waiting 10s...")
            time.sleep(10)

    return releases


def build_output(repo: str, releases: list[dict]) -> dict:
    """Convert raw GitHub API releases to our JSON format."""
    items: list[dict] = []
    for rel in releases:
        items.append({
            "tag": rel.get("tag_name", ""),
            "date": (rel.get("published_at") or rel.get("created_at", ""))[:10],
            "prerelease": bool(rel.get("prerelease", False)),
            "name": rel.get("name") or rel.get("tag_name", ""),
        })

    # Sort oldest-first
    items.sort(key=lambda r: r["date"])

    return {
        "repo": repo,
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "total": len(items),
        "releases": items,
    }


def update_manifest(outdir: Path, repo: str, filename: str, output: dict) -> None:
    """Add or update entry in projects.json."""
    manifest_path = outdir / "projects.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
    else:
        manifest = {"projects": []}

    existing = [p for p in manifest["projects"] if p.get("repo") == repo]
    entry = {
        "repo": repo,
        "file": filename,
        "updated": output["updated"],
        "total": output["total"],
    }
    if existing:
        existing[0].update(entry)
    else:
        manifest["projects"].append(entry)

    manifest["updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fetch GitHub release history and save as JSON."
    )
    parser.add_argument(
        "repo",
        help="GitHub repo in owner/name format (e.g., torvalds/linux)",
    )
    parser.add_argument(
        "-o", "--outdir",
        default="public/github-release-history",
        help="Output directory for JSON file (default: public/github-release-history)",
    )
    parser.add_argument(
        "--full",
        action="store_true",
        help="Force full re-fetch even when existing data is present.",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("GITHUB_TOKEN"),
        help="GitHub personal access token (or set GITHUB_TOKEN env var)",
    )
    args = parser.parse_args()

    repo = args.repo.strip("/")
    if "/" not in repo:
        print("Error: repo must be in owner/name format")
        sys.exit(1)

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    filename = repo.replace("/", "-") + ".json"
    filepath = outdir / filename

    existing = _load_existing(filepath)

    if existing and not args.full:
        existing_tags = {r["tag"] for r in existing.get("releases", [])}
        print(f"Incremental fetch for {repo} ({len(existing_tags)} existing releases)...")
        new_releases = fetch_incremental(repo, existing, args.token)
        print(f"New: {len(new_releases)} releases")
        if not new_releases:
            print("Already up to date.")
            return
        # Merge: prepend new items to existing list, re-sort
        new_items = build_output(repo, new_releases)["releases"]
        all_releases = new_items + existing["releases"]
        all_releases.sort(key=lambda r: r["date"])
        output = {
            "repo": repo,
            "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "total": len(all_releases),
            "releases": all_releases,
        }
    else:
        if args.full and existing:
            print(f"Full re-fetch for {repo} (--full flag set)...")
        else:
            print(f"Full fetch for {repo} (no existing data)...")
        releases = fetch_all(repo, args.token)
        print(f"Total: {len(releases)} releases")
        output = build_output(repo, releases)

    filepath.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(f"Saved to {filepath}")

    update_manifest(outdir, repo, filename, output)
    print(f"Updated manifest: {outdir / 'projects.json'}")


if __name__ == "__main__":
    main()
