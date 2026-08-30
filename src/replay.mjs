import { runReplay } from './receipt.mjs';

const { output } = runReplay();
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (output.errors.length > 0) process.exit(1);
