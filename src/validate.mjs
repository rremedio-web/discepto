import { runReplay } from './receipt.mjs';

let errors = 0;

function report(message) {
  console.error(message);
  errors += 1;
}

const { snapshot, expected, match } = runReplay();

if (snapshot.errors.length > 0) {
  report(`replay errors: ${snapshot.errors.join('; ')}`);
}

if (!match.phase) {
  report(`phase mismatch: expected ${expected.phase}, got ${snapshot.phase}`);
}

if (!match.final) {
  report(`final mismatch: expected ${expected.final}, got ${snapshot.final}`);
}

if (snapshot.current_freeze_id !== expected.freeze_id) {
  report('expected freeze not found');
} else if (!match.freeze_binding) {
  report('freeze binding mismatch');
}

if (errors > 0) {
  process.exit(1);
}

console.log('validate: ok');
