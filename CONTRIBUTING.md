# Contributing

Thank you for your interest in Discepto.

## Ground rules

- Keep changes provider-neutral; no vendor-specific tokens in fixtures or docs
- Preserve deterministic replay output; update fixtures and hard-coded test expectations together
- Run the full local verification sequence before opening a PR:

```bash
npm ci --ignore-scripts
npm audit --audit-level=high
npm test
npm run validate
npm run demo
npm run demo:adversarial
npx playwright install --with-deps chromium firefox webkit
npx playwright test
bash scripts/release.sh --structural-only /tmp/discepto-structural-release
node --test test/release.test.mjs
git diff --check
```

`release.sh` runs `check_release.py` against the release output (including `tracked-files.txt` from the archive step); do not invoke the checker directly on the output directory.

## Pull requests

- One logical change per PR when possible
- Include test coverage for new authority rules or phase transitions
- Do not commit secrets, home paths, or non-example email domains

## Code of conduct

Be respectful and constructive. This is a research reference, not a production service.
