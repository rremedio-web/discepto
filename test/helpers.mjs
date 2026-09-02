/**
 * Shared test fixture builder. One definition of the base run used by the
 * schema and protocol suites, so a roster shape change is one edit.
 */
export function buildRun(overrides = {}) {
  return {
    id: 'run-test',
    worktree_id: 'wt-test',
    coordinator_id: 'coordinator-test',
    agents: [
      { id: 'writer-1', role: 'writer', seat_id: 'writer-seat' },
      { id: 'challenger-1', role: 'challenger', seat_id: 'challenger-seat' },
    ],
    phase: 'DIAGNOSE',
    ...overrides,
  };
}
