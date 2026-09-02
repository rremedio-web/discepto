# Changelog

## 0.4.0

- Protocol v4: canonical JSON encoding with UTF-16 code-unit key order for measurement hashes, freeze bindings, and receipt hashes.
- Path-based replay CLI (`node bin/discepto.mjs replay`) and a small public API in `src/index.mjs`.
- Playwright overflow evidence split into horizontal and vertical axes, checked at 320px, 375px, and 768px.
- Watcher classifier moved to `experiments/watcher/` as an optional conformance exercise.
- Lint, format, and coverage gates added to local `npm run check` and CI.
- Recorded adversarial replay walkthrough (`docs/terminal-demo.md`, `node scripts/terminal-demo.mjs`).
