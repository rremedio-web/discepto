# Limitations

Discepto is a **synthetic protocol and replay reference only**.

## Not demonstrated

- Real-world multi-agent effectiveness
- Production safety or correctness guarantees
- Live worktree isolation under concurrent agents
- Model-agnostic behavior with actual LLM providers
- Automatic dispute resolution beyond the included measurement fixture
- Authentication of actor labels or coordinator identity
- Multi-run or cross-run current-state aggregation

## Synthetic scope

- Events are pre-authored; replay does not invoke agents
- HTML fixture demonstrates one neutral before/after measurement pattern
- Trace binding covers protocol version, run/coordinator/freeze IDs, recorded mutation paths, and the canonical measurement digest — not filesystem bytes
- Actor and seat labels remain unauthenticated; replay checks declared labels against run metadata and rejects declared same-seat review, but does not prove who sent an event or occupied a seat
- `artifact_identity` records file/local-server/staging/production evidence context; local or localhost measurements are not deployed served proof
- Playwright checks run at 320px, 375px, and 768px widths and assert horizontal overflow separately from vertical overflow
- Adversarial receipt validates fixture conformance offline; it is not a live attack harness
- The optional watcher experiment in `experiments/watcher/` is a deterministic ordered-rules conformance exercise; it is not learned classification, blinded independent validation, production oversight, or evidence of real-world efficacy

## Operational bounds

- One correction maximum per run trace in the neutral fixture
- Writer lease scope is explicit; scope changes only through lease events whose declared `issuer_id` matches `run.coordinator_id`; narrowing is enforced and widening rejected (scope monotonicity)
- Freeze IDs must be unique within a run
- Mutations follow a strict schema; unknown fields are rejected
- Fatal errors stop replay; nonfatal rejections are recorded and replay continues
- `MUTATION_WRITER_MISMATCH` is kept as a fail-closed defence and documented unreachable (accepted leases always pin `writer_id` to the predesignated writer); the no-current-freeze review guards are kept as defences of the same kind. The catalogue still owns their codes and the watcher adapter still enumerates them.
- Release tooling validates structure, file types, UTF-8 integrity, and example-domain emails — not semantic correctness
- CI pins action SHAs and Node 22; local environments may differ slightly in Playwright engine builds

## Authority rejection catch-rate table

The protocol currently has fourteen stable authority rejection codes, owned by the `AUTHORITY_REJECTIONS` catalogue in `src/protocol.mjs`. This table and the watcher adapter both derive from that catalogue; a test fails if the table drifts. The adversarial fixture exercises four; the watcher-adapter unit test enumerates all fourteen code/operation pairs. "No" means the code is not currently produced by `fixtures/adversarial-events.json`, not that the guard is untested.

| Code                       | Operation  | Adversarial fixture |
| -------------------------- | ---------- | ------------------- |
| `LEASE_ISSUER_MISMATCH`    | `lease`    | Yes                 |
| `LEASE_WRITER_MISMATCH`    | `lease`    | No                  |
| `LEASE_INITIAL_INACTIVE`   | `lease`    | No                  |
| `LEASE_SCOPE_WIDENING`     | `lease`    | No                  |
| `MUTATION_CHALLENGER`      | `mutation` | Yes                 |
| `MUTATION_NO_ACTIVE_LEASE` | `mutation` | No                  |
| `MUTATION_WRITER_MISMATCH` | `mutation` | No                  |
| `MUTATION_OUTSIDE_SCOPE`   | `mutation` | No                  |
| `REVIEW_REVIEWER_MISMATCH` | `review`   | Yes                 |
| `REVIEW_SAME_SEAT`         | `review`   | Yes                 |
| `REVIEW_SEAT_MISMATCH`     | `review`   | No                  |
| `REVIEW_NO_CURRENT_FREEZE` | `review`   | No                  |
| `REVIEW_BINDING_MISMATCH`  | `review`   | No                  |
| `REVIEW_FREEZE_MISMATCH`   | `review`   | No                  |

Use this repository for vocabulary, fixture calibration, and offline authority testing — not as deployed oversight infrastructure.
