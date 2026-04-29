Static personal webpage assets hosting.

Files under `public/` are deployed via GitHub Pages Actions.

## Project structure

```
scripts/           scripts may be placed here (outside public/)
public/
  index.html       project directory landing page
  <sub-project>/   each sub-project is a directory under public/
    index.html     entry point; pure HTML + CSS + vanilla JS, no build tools
    *.json         static data loaded at runtime (optional)
    ...
```

## Adding a sub-project

1. Create `public/<name>/` with an `index.html`.
   - Use existing CSS-variable conventions (`--gh-*` tokens) from `public/index.html` for visual consistency.
   - No frameworks, no bundlers — vanilla HTML/CSS/JS, `fetch` for data.
2. Add a link card in `public/index.html` inside `.project-list` (copy the `.project-item` pattern).
3. If the project needs data preprocessing, write a script in `scripts/` (Python recommended) that outputs JSON into the sub-project directory.
   - Example: `python3 scripts/do_something.py <args> -o public/<name>/`
4. Commit and push — the GitHub Actions workflow deploys `public/` automatically.
