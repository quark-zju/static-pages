#!/usr/bin/env python3
"""Fetch GitHub release history and save as JSON."""

import argparse
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def fetch_all_releases(repo: str, token: str | None = None) -> list[dict]:
    """Fetch all releases for a GitHub repo, handling pagination."""
    releases: list[dict] = []
    page = 1
    per_page = 100

    while True:
        url = f"https://api.github.com/repos/{repo}/releases?per_page={per_page}&page={page}"
        req = urllib.request.Request(url)
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("User-Agent", "fetch-releases/1.0")
        if token:
            req.add_header("Authorization", f"Bearer {token}")

        try:
            with urllib.request.urlopen(req) as resp:
                remaining = resp.headers.get("X-RateLimit-Remaining")
                data = json.loads(resp.read().decode())
                if not data:
                    break
                releases.extend(data)
                print(f"  Page {page}: {len(data)} releases (rate limit remaining: {remaining})")
                page += 1
                if remaining and int(remaining) <= 2:
                    print("  Rate limit low, waiting 10s...")
                    time.sleep(10)
        except urllib.error.HTTPError as e:
            if e.code == 403 and "rate limit" in e.read().decode().lower():
                print("  Rate limit exceeded, waiting 60s...")
                time.sleep(60)
                continue
            elif e.code == 404:
                print(f"  Repo {repo} not found")
                sys.exit(1)
            raise

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


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch GitHub release history and save as JSON.")
    parser.add_argument("repo", help="GitHub repo in owner/name format (e.g., torvalds/linux)")
    parser.add_argument(
        "-o", "--outdir",
        default="public/github-release-history",
        help="Output directory for JSON file (default: public/github-release-history)",
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

    print(f"Fetching releases for {repo}...")
    releases = fetch_all_releases(repo, args.token)
    print(f"Total: {len(releases)} releases")

    output = build_output(repo, releases)
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    filename = repo.replace("/", "-") + ".json"
    filepath = outdir / filename
    filepath.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(f"Saved to {filepath}")

    # Update projects manifest
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
    print(f"Updated manifest: {manifest_path}")


if __name__ == "__main__":
    main()
