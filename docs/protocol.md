# Protocol

Discepto defines a fixed-phase, two-agent protocol for a single isolated worktree (protocol version `discepto-protocol-3`).

## Compatibility

Protocol v3 makes the previously asserted review independence boundary explicit: run agents and review records must carry `seat_id`, and v3 rejects traces that omit those fields. Protocol v2 traces therefore require migration by assigning unique writer/challenger seats and recording the challenger seat on every review before they can be replayed as v3. `Measurement.artifact_identity` remains optional, so measurements without that field retain compatibility within v3.

## Roles

| Role | Count | Mutation |
|------|-------|----------|
| writer | 1 | Allowed only with active lease whose declared `issuer_id` matches `run.coordinator_id`, and within scoped paths |
| challenger | 1 | Read-only always |

`Run` declares a `coordinator_id` distinct from both agent ids. Each agent also declares a unique `seat_id`, which identifies the execution seat separately from the actor label. Exactly one predesignated writer may hold the active lease. Both agents diagnose read-only.

Actor labels (`agent_id`, `issuer_id`, `reviewer_id`) and seat labels (`seat_id`) are declarations, not authentication. Replay checks them against run metadata and rejects a review whose declared seat matches the writer seat, but cannot attest who authored an event or occupied a seat. A forged label matching the expected value is indistinguishable from a genuine one; identity authentication is out of scope.

## Phases

1. **DIAGNOSE** — both agents submit `Diagnosis { agent_id, read_only: true, findings[] }`; each agent must submit exactly one fresh diagnosis per run
2. **DISPUTE** — agents submit prose/estimates; these never resolve the dispute
3. **MEASURE** — one discriminating `Measurement` resolves the dispute and becomes observable evidence; phase advances to MEASURE but implementation unlocks only after the first active lease whose declared `issuer_id` matches `run.coordinator_id`
4. **IMPLEMENT** — scoped writer mutations under active lease; mutations follow a strict schema with unknown fields rejected
5. **FREEZE** — canonical trace binding over declared protocol fields
6. **REVIEW** — challenger must supply `reviewer_id`, `seat_id`, `freeze_id`, and `freeze_binding`; verdict `PASS` or `CHANGES_NEEDED`
7. **CORRECT** — at most one correction; supersedes current freeze; requires new freeze with a unique freeze ID
8. **FINAL** — only after challenger `PASS` on current binding

## Structures

```
Run          { id, worktree_id, coordinator_id, agents[{ id, role, seat_id }], phase }
Diagnosis    { agent_id, read_only: true, findings[] }
Dispute      { agent_id, claim, estimate }
Lease        { issuer_id, writer_id, scope[], active }
Measurement  { method, observations[{ key, value }], result, artifact_identity? }
FreezeRequest { id, base_id, candidate_id }
StoredTrace  { id, base_id, candidate_id, changed_paths[], measurement_hash, binding }  // derived on apply
Review       { reviewer_id, seat_id, freeze_id, freeze_binding, verdict: PASS|CHANGES_NEEDED, findings[] }
Correction   { supersedes, red_ref, green_ref, count: 1 }
Mutation     { agent_id, path }
```

Unknown fields and invalid enums are rejected.

## Authority rules

- Exactly two unique agents; one writer, one challenger; `coordinator_id` distinct from agent ids
- Agent seat IDs are required and unique; a review seat must match the registered challenger seat and must not match the writer seat
- Replay treats a lease as coordinator-issued when its declared `issuer_id` equals `run.coordinator_id`; the first lease must be active and name the predesignated writer; mismatched `issuer_id` is rejected (nonfatal)
- Subsequent leases with matching `issuer_id` may narrow scope or revoke/reactivate equal scope; widening is rejected (nonfatal) — scope monotonicity
- Mutation before or without active lease: rejected (nonfatal)
- Challenger mutation: always rejected (nonfatal)
- Writer mutation outside lease scope: rejected (nonfatal)
- Dispute cannot advance without measured evidence
- Review must reference current freeze; stale reviews rejected (nonfatal)
- Review `freeze_binding` must match the current freeze binding digest
- Declared `reviewer_id` must equal the challenger's id; writer-label mismatch on review is rejected (nonfatal)
- Declared review `seat_id` is required; it must match the registered challenger seat and a seat matching the writer seat is rejected (nonfatal)
- `CHANGES_NEEDED` → one correction max → new freeze required with unique freeze ID
- Second correction: fail closed (fatal)
- `MUTATION_WRITER_MISMATCH` is retained as a fail-closed defence and is documented unreachable: lease rules already pin every accepted lease's `writer_id` to the predesignated writer, so no legal event sequence can produce it. The no-current-freeze review guards are defences of the same kind, because REVIEW is only reachable after a freeze set the current freeze. Kept guards stay; they are simply not reachable through replayed events.

## Fatal errors vs nonfatal rejections

- **Fatal errors** — schema violations, wrong phase for structural events, duplicate measurements, replay stops immediately
- **Nonfatal rejections** — authority failures (lease `issuer_id` mismatch, challenger mutation, binding mismatch, writer-label review mismatch, same-seat review) recorded in `rejections[]` as structured `{ code, operation, message }`; replay continues so rejected attempts do not alter accepted binding

## Replay interface

`replayEvents(run, events)` returns outcomes as values, not state to inspect: `{ snapshot, outcomes[] }`. Each outcome is one of:

- `{ status: 'accepted' }`
- `{ status: 'rejected', code, operation, message }` — the same record the snapshot's `rejections[]` carries
- `{ status: 'fatal', message }` — replay stops after the first fatal outcome

The mutable replay state is private to the protocol module; the snapshot plus the ordered outcome list are the only public results of a replay. Tests and fixtures author traces through this same seam.

## Trace binding

Freeze identity is a canonical SHA-256 digest over:

- `protocol_version`
- `run_id`
- `coordinator_id`
- `freeze_id`
- `base_id`
- `candidate_id`
- sorted recorded mutation paths (derived from applied mutations, not request fields)
- canonical measurement digest (`method`, sorted observations, `result`, and `artifact_identity` when present)

Reviews and corrections must align with the current freeze chain. The binding covers declared protocol fields only. It does **not** hash filesystem bytes or attest to file contents on disk.

## Replay

Offline replay reads synthetic fixture events, applies authority checks, and emits deterministic JSON to stdout. No model, network, Git, or filesystem writes occur during replay.

The neutral scenario uses `fixtures/events.json`. The adversarial trace (`fixtures/adversarial-events.json`) replays the same `scenario.json` run with a rejected lease whose declared `issuer_id` does not match `run.coordinator_id`, challenger mutation, and writer `reviewer_id` before a valid challenger `PASS`. `npm run demo:adversarial` emits a deterministic receipt JSON including `protocol_version`, `fixture_id`, `run_id`, phase/freeze/binding, structured rejection records (`code`, `operation`, `message`), `errors`, per-field `expected_match` booleans, and `receipt_hash`. Exit code is nonzero on fatal errors or expected mismatch.

## Watcher adapter boundary

`src/watcher-adapter.mjs` exposes one function, `observeRejection(rejection, context)`, which consumes a structured Discepto rejection and returns the watcher observation record (`rejection_code`, `operation`, `scenario_id`, `evidence_ref`, `classification`, `disposition`, `owner_decision`). It maps using `code` and `operation` only — never the rejection message — supports the fourteen stable authority rejection codes derived from the protocol catalogue, validates code/operation pairs fail-closed, and classifies through the isolated watcher classifier as an internal seam. Every code maps to the same deterministic policy gate (RECORDS_TRUST / HOLD / yes) by design. This is a deterministic synthetic policy/reference gate — not learned classification, blinded independent validation, production oversight, or real-world efficacy.

`npm run demo:watcher:adversarial` adapts the four adversarial trace rejections and emits a deterministic watcher receipt with `watcher_calibration_version`, source protocol version/fixture/receipt hash, `observation_count`, observations (`rejection_code`, `operation`, `scenario_id`, `evidence_ref`, `classification`, `disposition`, `owner_decision`), and `receipt_hash`. Rejection messages are omitted from the watcher receipt body.
