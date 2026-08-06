# Hidden suite v9

- **Committed:** `manifest.json` (digests + categories only — no prompts, no expected args)
- **Gitignored:** `scenarios.full.json` (full prompts + expected args)
- Re-seal historical digests only when auditing the original full file: `PRIVATEPLATE_HIDDEN_SUITE_VERSION=v9 PRIVATEPLATE_HIDDEN_BASELINE_COMMIT=ba47b6ae3557a6529e36b13ff875e9b5de16d5c6 node scripts/c0/seal-hidden-suite.mjs`
- **Status:** reviewed history; do not package or reuse as blind evidence.
- Product baseline commit: `ba47b6ae3557a6529e36b13ff875e9b5de16d5c6`

The seal script does **not** contain the questions or answers. Implementers must
not use a blind suite's full text for tuning. Public regression and public
validation remain the in-repo fixtures.
