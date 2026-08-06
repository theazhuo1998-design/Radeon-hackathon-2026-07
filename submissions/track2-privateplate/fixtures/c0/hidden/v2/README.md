# Locked validation suite v2

- **Committed:** `manifest.json` (digests + categories only — no prompts, no expected args)
- **Gitignored:** `scenarios.full.json` (full prompts + expected args)
- Re-seal digests (requires local full file): `PRIVATEPLATE_HIDDEN_SUITE_VERSION=v2 node scripts/c0/seal-hidden-suite.mjs`
- This suite is retained for audit history and optional validation only.

The seal script does **not** contain the questions or answers. Implementers must
not present this suite as untouched blind evidence: its plaintext participated
in deterministic local pipeline development. Formal blind evaluation uses v3.
