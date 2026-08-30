export const REJECTION_CODE_OPERATIONS = Object.freeze({
  LEASE_ISSUER_MISMATCH: 'lease',
  LEASE_WRITER_MISMATCH: 'lease',
  LEASE_INITIAL_INACTIVE: 'lease',
  LEASE_SCOPE_WIDENING: 'lease',
  MUTATION_CHALLENGER: 'mutation',
  MUTATION_NO_ACTIVE_LEASE: 'mutation',
  MUTATION_WRITER_MISMATCH: 'mutation',
  MUTATION_OUTSIDE_SCOPE: 'mutation',
  REVIEW_REVIEWER_MISMATCH: 'review',
  REVIEW_SAME_SEAT: 'review',
  REVIEW_SEAT_MISMATCH: 'review',
  REVIEW_NO_CURRENT_FREEZE: 'review',
  REVIEW_BINDING_MISMATCH: 'review',
  REVIEW_FREEZE_MISMATCH: 'review',
});

export function rejectionOperation(code) {
  const operation = REJECTION_CODE_OPERATIONS[code];
  if (!operation) {
    throw new Error(`unknown rejection code: ${code}`);
  }
  return operation;
}
