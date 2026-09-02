# Terminal demo

Recorded walkthrough of `fixtures/adversarial-events.json` on protocol v4. This is synthetic fixture replay — not a live agent session.

Reproduce:

```bash
node scripts/terminal-demo.mjs
```

The session below uses the real replay CLI on event prefixes, then on the full adversarial fixture.

```console
# Discepto terminal demo — protocol v4 adversarial fixture
# Synthetic event replay. No agents, models, or repository writes.
# Reproduce: node scripts/terminal-demo.mjs

# 1. Self-issued writer lease is rejected; phase stays MEASURE
# prefix: diagnoses, disputes, measurement, writer-issued lease
{
  "protocol_version": "discepto-protocol-4",
  "run_id": "run-neutral-001",
  "phase": "MEASURE",
  "final": false,
  "current_freeze_id": null,
  "freeze_binding": null,
  "correction_count": 0,
  "rejection_count": 1,
  "rejections": [
    {
      "code": "LEASE_ISSUER_MISMATCH",
      "operation": "lease",
      "message": "first lease must be coordinator-issued"
    }
  ],
  "errors": [],
  "receipt_hash": "de09d82360328725cb1ee9e1ec8ada901544463b68ae005502728389687802e0"
}
# exit 0

# 2. Coordinator lease is accepted; phase advances to IMPLEMENT
# same prefix, then coordinator-issued lease; prior rejection stays recorded
{
  "protocol_version": "discepto-protocol-4",
  "run_id": "run-neutral-001",
  "phase": "IMPLEMENT",
  "final": false,
  "current_freeze_id": null,
  "freeze_binding": null,
  "correction_count": 0,
  "rejection_count": 1,
  "rejections": [
    {
      "code": "LEASE_ISSUER_MISMATCH",
      "operation": "lease",
      "message": "first lease must be coordinator-issued"
    }
  ],
  "errors": [],
  "receipt_hash": "70be0a85e6c270bfa0aee6fb2bea4bdff5d2c92a925c7ad7a8c5612e9a7217d7"
}
# exit 0

# 3. Valid freeze and challenger PASS
# measurement, coordinator lease, writer mutation, freeze, challenger review
{
  "protocol_version": "discepto-protocol-4",
  "run_id": "run-neutral-001",
  "phase": "FINAL",
  "final": true,
  "current_freeze_id": "freeze-001",
  "freeze_binding": "98cca23c0ffea38e464e039420bfdfbb59105d6e5678cc3d46ed703c64bb86fc",
  "correction_count": 0,
  "rejection_count": 0,
  "rejections": [],
  "errors": [],
  "receipt_hash": "9896b9b7fc84f142a52a51f6bde96b4d0af30c063c22c5cc42a634998de4924a"
}
# exit 0

# 4. Full adversarial fixture — deterministic receipt
# node bin/discepto.mjs replay --scenario fixtures/scenario.json --events fixtures/adversarial-events.json --pretty
{
  "protocol_version": "discepto-protocol-4",
  "run_id": "run-neutral-001",
  "phase": "FINAL",
  "final": true,
  "current_freeze_id": "freeze-001",
  "freeze_binding": "98cca23c0ffea38e464e039420bfdfbb59105d6e5678cc3d46ed703c64bb86fc",
  "correction_count": 0,
  "rejection_count": 4,
  "rejections": [
    {
      "code": "LEASE_ISSUER_MISMATCH",
      "operation": "lease",
      "message": "first lease must be coordinator-issued"
    },
    {
      "code": "MUTATION_CHALLENGER",
      "operation": "mutation",
      "message": "challenger mutation rejected"
    },
    {
      "code": "REVIEW_REVIEWER_MISMATCH",
      "operation": "review",
      "message": "reviewer must be challenger"
    },
    {
      "code": "REVIEW_SAME_SEAT",
      "operation": "review",
      "message": "reviewer and writer seats must differ"
    }
  ],
  "errors": [],
  "receipt_hash": "95afef4c6450b9025f3c41acec92dc8d105624f53dfe9844fc537b2772ac0e55"
}
# exit 0
```
