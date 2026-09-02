import { AUTHORITY_REJECTIONS } from './protocol.mjs';

export const REJECTION_CODE_OPERATIONS = Object.freeze(
  Object.fromEntries(
    Object.entries(AUTHORITY_REJECTIONS).map(([code, rule]) => [code, rule.operation]),
  ),
);

export function rejectionOperation(code) {
  const operation = REJECTION_CODE_OPERATIONS[code];
  if (!operation) {
    throw new Error(`unknown rejection code: ${code}`);
  }
  return operation;
}
