# Hidden suite v6

- **Committed:** `manifest.json` (digests + categories only — no prompts, no expected args)
- **Gitignored:** `scenarios.full.json` (full prompts + expected args)
- Re-seal digests (requires local full file): `PRIVATEPLATE_HIDDEN_SUITE_VERSION=v6 node scripts/c0/seal-hidden-suite.mjs`
- Run on instance only when owner provides full suite path:
  `PRIVATEPLATE_HIDDEN_SUITE_PATH=fixtures/c0/hidden/v6/scenarios.full.json`

The seal script does **not** contain the questions or answers. Implementers must
not use a blind suite's full text for tuning. Public regression and public
validation remain the in-repo fixtures.
