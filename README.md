Static personal webpage assets hosting.

Files under `public/` are deployed via GitHub Pages Actions.

## Structure

```
public/                         # Deployed to GitHub Pages (domain: s.0x1e31.net)
├── index.html                  # Project directory landing page
├── model-price-table/          # Sub-project: interactive price comparison
│   ├── index.html
│   └── data.json
├── github-release-history/     # Sub-project: release frequency timeline
│   ├── index.html
│   ├── projects.json           # Manifest of available repos
│   └── *.json                  # Per-repo release data (fetched by script)

scripts/                        # Data-fetching tools (NOT deployed)
└── fetch_releases.py           # Downloads GitHub release history → JSON
```

## Adding a sub-project

1. **Create** `public/<project-name>/index.html` — a self-contained static page (HTML + CSS + vanilla JS). No frameworks, no build tools.
2. If the page needs **data**, put a `.json` file in the same directory and `fetch()` it at runtime.
3. **Link** the project from `public/index.html` by adding a `.project-item` card.
4. If data is sourced externally (e.g. an API), place the **fetch/generation script** in `scripts/` — outside `public/`.

## Conventions

- **No npm / bundlers / frameworks.** Pure HTML, CSS, vanilla JS. Keep each page self-contained.
- **Scripts** are written in Python 3 (stdlib only). They read/write data into `public/`.
- **Design** follows a GitHub-inspired look: CSS variables `--gh-*`, IBM Plex Sans + Noto Sans SC fonts, card-based layout with macOS-style topbar.
- **Commits** are small and atomic: one logical change per commit. Use `feat:`, `refactor:`, `data:`, `chore:` prefixes.
