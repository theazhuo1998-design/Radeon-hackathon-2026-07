# Hidden suite v10

- **Committed:** `manifest.json` (digests + categories only — no prompts, no expected args)
- **Gitignored:** `scenarios.full.json` (full prompts + expected args)
- Re-seal historical digests only when auditing the original full file: `PRIVATEPLATE_HIDDEN_SUITE_VERSION=v10 PRIVATEPLATE_HIDDEN_BASELINE_COMMIT=c9f22e79c5b67553e42999b758c102b2eaf1a934 node scripts/c0/seal-hidden-suite.mjs`
- **Status:** reviewed history; do not package or reuse as blind evidence.
- Product baseline commit: `c9f22e79c5b67553e42999b758c102b2eaf1a934`
- Formal run: `privateplate-gemma4-v10-20260728T112025Z-13bfe90` on commit `13bfe9036e2e987b9e6d7cf13f655b4b72975eb7`

The seal script does **not** contain the questions or answers. Implementers must
not use a blind suite's full text for tuning. Public regression and public
validation remain the in-repo fixtures.
