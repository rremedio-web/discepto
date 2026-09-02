# Watcher experiment

This directory is an optional conformance exercise. It maps structured Discepto authority rejections into a deterministic ordered-rules classifier.

It is **not** a trained model, a machine-learning evaluation, production oversight, or evidence of real-world efficacy. The classifier is a fixed sequence of if-statements over structured facts. The `rule-examples` fixtures document the intended rule order. The `conformance` fixtures are a separate family used to check that the same rules still fire; they are not a held-out training split.

`adapter.mjs` is the only file here that imports Discepto core. The classifier, schema, scorer, and fixtures do not import Discepto.

```bash
npm run validate:watcher
npm run demo:watcher
npm run demo:watcher:adversarial
```
