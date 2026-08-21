# Methodology

Discepto is a synthetic reference experiment, not a live orchestrator.

## Experiment design

1. **Fixture scenario** — neutral token table with generic long tokens; `Run` includes `coordinator_id` distinct from agent ids
2. **Event trace** — ordered protocol events covering all phases including one correction cycle in the neutral trace
3. **Adversarial trace** — same scenario run with a rejected lease whose declared `issuer_id` does not match `run.coordinator_id`, challenger mutation, and writer `reviewer_id` before valid challenger `PASS`; proves rejections do not alter final binding
4. **Measurement fixture** — static HTML with `?variant=after` query toggle
5. **Cross-engine checks** — Playwright captures structured measurements (line count, overflow px) in Chromium, Firefox, and WebKit at 320px width
6. **Replay validation** — deterministic stdout JSON compared across runs; adversarial demo compared byte-identically across two invocations
7. **Watcher calibration** — isolated classifier scored against train/held-out fixtures via `npm run validate:watcher`; synthetic policy gate only
8. **Watcher adversarial receipt** — adapts the three adversarial rejections through `src/watcher-adapter.mjs` and emits deterministic JSON via `npm run demo:watcher:adversarial`; not blinded independent validation or production oversight

## Dispute resolution

Agents may disagree in prose during DISPUTE. Estimates and claims never advance phase. A single discriminating measurement (viewport overflow and token line count) is the only valid resolver. After measurement, phase is observable as MEASURE until the first active lease whose declared `issuer_id` matches `run.coordinator_id` advances to IMPLEMENT.

## Lease authority

Replay treats a lease as coordinator-issued when its declared `issuer_id` equals `run.coordinator_id`. The first lease must be active. Scope may narrow on subsequent matching leases; widening is rejected (scope monotonicity). Leases whose declared `issuer_id` does not match are nonfatal rejections. Identity authentication is out of scope — a trace event forging the coordinator label is indistinguishable from one bearing the same declared label.

## Correction ceiling

When review returns `CHANGES_NEEDED`, exactly one correction is permitted. The writer must produce a new freeze with a unique freeze ID. A second correction attempt fails closed. Failed review or measurement after correction requires a new freeze before FINAL.

## Challenger review

Reviews require a declared `reviewer_id` equal to the challenger's id, the current `freeze_id`, and the matching `freeze_binding` digest. Stale freeze IDs, binding mismatches, or writer-label review mismatch are nonfatal rejections.

## Neutrality

Fixtures use generic uppercase tokens and neutral CSS property names. No private project dimensions, vendor names, or production identifiers appear in public artifacts.

## Release

Structural release uses hardened Git archive isolation (fsmonitor disabled, config cleared), untracked-clean guard, dual deterministic zip builds, and `discepto.zip` + `receipt.json` output with atomic sibling rename. The release checker enforces a tight file-type allowlist, strict UTF-8 and NUL handling, and credential-pattern scans without embedding secrets in public files.
