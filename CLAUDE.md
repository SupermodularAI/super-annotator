# Super Annotator — instructions for Claude Code

This repo is a single self-contained tool: a click-to-annotate overlay for any
HTML page, plus a zero-dependency CLI to inject it.

**Read `SKILL.md` in this repo before doing anything with the annotator** —
it's the canonical instructions for installing, injecting, configuring
(`--key` / `--name` / `--reviewer` / `--plugin`), and reading back exported
annotations. `README.md` has the human-facing usage docs.

Don't rewrite or "improve" `annotator.js` unless explicitly asked to change the
overlay itself — treat it as the canonical, tested source.
