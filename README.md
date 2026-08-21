# Discepto Worktree Experiment

Provider-neutral synthetic two-agent single-worktree experiment and offline replay kit (protocol v2, package `0.4.0`).

This repository defines a minimal protocol for coordinating exactly two agents — one predesignated writer with an active lease and one read-only challenger — across fixed phases in a single isolated worktree. It provides schema validation, deterministic event replay, a neutral HTML measurement fixture, and structural release tooling. It does **not** launch agents, call models, mutate Git state, or perform external actions.

## Scope

- Two-agent topology only: one writer lease holder, one read-only challenger
- Phases: DIAGNOSE → DISPUTE → MEASURE → IMPLEMENT → FREEZE → REVIEW → CORRECT → FINAL
- Dispute resolution requires one discriminating measurement; prose/estimates never advance state
- Challenger reviews require `reviewer_id`, `freeze_id`, and matching `freeze_binding`
- Trace binding covers protocol version, run/coordinator/freeze IDs, recorded mutation paths, and canonical measurement digest — not filesystem bytes
- Fatal schema/phase errors stop replay; nonfatal authority rejections are recorded and replay continues
- Actor labels (`agent_id`, `issuer_id`, `reviewer_id`) are schema-checked only — not authenticated
- Offline synthetic fixtures and deterministic replay to stdout
- Watcher calibration module (`calibration/watcher/`) with deterministic synthetic policy/reference gate — not learned classification, blinded independent validation, production oversight, or real-world efficacy
- Discepto-to-watcher adapter maps structured authority rejections (`code`/`operation`) to watcher scenarios without reading rejection messages
- Playwright measurements across Chromium, Firefox, and WebKit (dev dependency pinned at 1.62.1)
- Node.js ESM (>=22)

## Quick start

```bash
npm ci --ignore-scripts
npm audit --audit-level=high
npm test
npm run validate
npm run demo
npm run replay
npm run demo:adversarial
npm run validate:watcher
npm run demo:watcher
npm run demo:watcher:adversarial
npx playwright install --with-deps chromium firefox webkit
npx playwright test
```

## What this is not

This kit is **not** proven multi-agent orchestration, production safety certification, or evidence of real-world effectiveness. It is a synthetic protocol and replay reference for research and calibration only.

## Layout

- `src/schema.mjs` — structure and enum validation
- `src/protocol.mjs` — phase authority, lease rules, trace binding
- `src/replay.mjs` — offline event replay with deterministic JSON output
- `src/demo.mjs` — stdout-only demonstration
- `src/adversarial-demo.mjs` — deterministic adversarial trace receipt to stdout
- `src/watcher-adapter.mjs` — maps Discepto structured rejections to watcher scenarios (code/operation only)
- `src/watcher-adversarial-demo.mjs` — deterministic synthetic watcher adversarial receipt to stdout
- `src/validate.mjs` — fixture and neutrality checks
- `calibration/watcher/` — isolated watcher calibration classifier, fixtures, validation, and demo (no Discepto imports)
- `fixtures/` — synthetic scenario, events, expected state, adversarial trace, and watcher adversarial expected receipt
- `playwright/` — neutral HTML fixture and cross-engine measurement spec
- `scripts/` — hardened git-archive release tooling
- `docs/` — protocol, methodology, and limitations

## License

Apache-2.0. See `LICENSE`.
