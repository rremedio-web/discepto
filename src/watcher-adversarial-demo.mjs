import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { runAdversarialDemo, sealReceipt } from './receipt.mjs';
import { observeRejection, WATCHER_CALIBRATION_VERSION } from './watcher-adapter.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function buildWatcherAdversarialReceipt(adversarialOutput) {
  const { output } = adversarialOutput;
  const context = {
    run_id: output.run_id,
    scope: output.fixture_id,
  };

  const observations = output.rejections.map((item, index) => observeRejection(
    { code: item.code, operation: item.operation },
    { ...context, sequence: index },
  ));

  const body = {
    watcher_calibration_version: WATCHER_CALIBRATION_VERSION,
    source_protocol_version: output.protocol_version,
    source_fixture_id: output.fixture_id,
    source_receipt_hash: output.receipt_hash,
    observation_count: observations.length,
    observations,
  };

  return sealReceipt(body);
}

export function runWatcherAdversarialDemo(baseDir = root) {
  const adversarial = runAdversarialDemo(baseDir);
  const receipt = buildWatcherAdversarialReceipt(adversarial);
  const allCatches = receipt.observations.every(
    (observation) =>
      observation.classification === 'RECORDS_TRUST'
      && observation.disposition === 'HOLD'
      && observation.owner_decision === 'yes',
  );
  return { adversarial, receipt, allCatches };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { receipt, adversarial, allCatches } = runWatcherAdversarialDemo();
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (adversarial.output.errors.length > 0 || !adversarial.allMatch || !allCatches) {
    process.exit(1);
  }
}
