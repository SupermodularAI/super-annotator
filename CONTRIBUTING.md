# Contributing

Thanks for taking a look at Super Annotator!

## Quick start

1. Fork and clone the repo.
2. Install dependencies: `npm install` (only needed for the Playwright e2e tests).
3. Run the tests before opening a PR:
   - `npm test` — unit tests
   - `npm run test:e2e` — Playwright end-to-end tests

No build step — `annotator.js` runs as-is in the browser and `inject-annotate.js`
runs as-is under Node.

## Before you dive in

- Read [SKILL.md](./SKILL.md) first — it's the canonical spec for how the
  annotator installs, configures, and behaves.
- `annotator.js` is treated as tested, canonical source. Small, scoped fixes
  are very welcome; drive-by rewrites or restyling are not — please open an
  issue first if you want to change its behavior.
- Keep it dependency-free. That's the whole pitch: one `<script>` tag, no
  build, no install.

## Development workflow

- Create a feature branch from `main`.
- Keep PRs focused — one fix or behavior change per PR.
- Add or update tests when behavior changes.
- If you touch overlay behavior, update `SKILL.md` and `README.md` too so the
  docs don't drift from reality.

## Reporting issues

Use GitHub Issues for bugs and feature requests. Steps to reproduce + expected
behavior go a long way.

## License

By contributing, you agree your contributions are licensed under the
[Apache License, Version 2.0](./LICENSE).
