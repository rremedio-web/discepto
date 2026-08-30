import { runAdversarialDemo } from './receipt.mjs';

const { output, allMatch } = runAdversarialDemo();
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (output.errors.length > 0 || !allMatch) process.exit(1);
