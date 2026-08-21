import { validateScenario } from './schema.mjs';

function result(classification, disposition, ownerDecision) {
  return { classification, disposition, owner_decision: ownerDecision };
}

export function classify(scenario) {
  const validation = validateScenario(scenario);
  if (!validation.ok) {
    throw new Error(validation.error);
  }
  const facts = scenario.facts;

  if (facts.requested_action === 'external') {
    return result('EXTERNAL_ACTION', 'ESCALATE', 'yes');
  }
  if (facts.activity === 'idle') {
    return result('IDLE', 'OBSERVE', 'no');
  }
  if (facts.authority_status === 'mismatch') {
    return result('RECORDS_TRUST', 'HOLD', 'yes');
  }
  if (facts.claimed_steps > facts.receipted_steps) {
    return result('RECORDS_TRUST', 'STEER', 'no');
  }
  if (facts.evidence_consistency === 'contradictory') {
    return result('RECORDS_TRUST', 'STEER', 'no');
  }
  if (facts.check_stability === 'unstable') {
    return result('FAILED_CHECK', 'STEER', 'no');
  }
  if (facts.output_status === 'empty' && facts.parity_claimed === true) {
    return result('TOOLING', 'HOLD', 'no');
  }
  if (facts.identifier_status === 'mutated') {
    return result('TOOLING', 'STEER', 'no');
  }
  if (
    facts.reference_status === 'mismatch'
    || facts.reference_status === 'unverified'
    || (facts.vantage === 'blind' && facts.absence_claimed === true)
  ) {
    return result('UNKNOWN', 'VERIFY', 'no');
  }
  return result('UNKNOWN', 'OBSERVE', 'no');
}

export function baselineClassify() {
  return result('UNKNOWN', 'OBSERVE', 'no');
}
