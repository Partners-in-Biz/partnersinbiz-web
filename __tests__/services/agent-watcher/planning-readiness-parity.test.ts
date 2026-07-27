import {
  isPlanningReady,
  planningDiscoveryDigest,
  type PlanningDecisionBrief,
  type PlanningDiscoveryState,
} from '../../../lib/projects/planningDiscovery'
import { isWatcherPlanningReady } from '../../../services/agent-watcher/src/planning-readiness'

const brief: PlanningDecisionBrief = {
  outcome: 'Keep watcher claims aligned with canonical planning readiness',
  user: 'Project delivery agents',
  whyNow: 'The watcher cannot import the application library at runtime',
  successCriteria: ['Equivalent states produce equivalent readiness decisions'],
  constraints: ['No application alias imports in the watcher package'],
  outOfScope: ['Changing the canonical state machine'],
  assumptions: ['The mirrored schema is version one'],
  risks: ['Predicate drift'],
  approvalGates: ['production-deploy'],
}

const inspection = {
  brief: ['brief'], docs: ['docs'], files: ['files'], plan: ['plan'],
  tasks: ['tasks'], tools: ['tools'], agents: ['agents'], skills: ['skills'],
  inspectedBy: 'pip', inspectedAt: '2026-07-27T00:00:00.000Z',
}

const confirmed: PlanningDiscoveryState = {
  schemaVersion: 1,
  revision: 7,
  enforced: true,
  status: 'confirmed',
  mode: 'interview',
  inspection,
  turns: [{
    id: 'q-1', question: 'What matters?', currentGuess: 'Predicate parity',
    askedBy: 'pip', askedAt: '2026-07-27T00:01:00.000Z',
    answer: 'Fail closed', answeredBy: 'peet', answeredAt: '2026-07-27T00:02:00.000Z',
  }],
  confidence: 96,
  predictedNextAnswers: ['Development only', 'No deployment', 'Preserve approvals'],
  intentBlockingUnknowns: [],
  brief,
  digest: planningDiscoveryDigest(brief),
  confirmedBy: 'peet',
  confirmedAt: '2026-07-27T00:03:00.000Z',
}

const assumptions: PlanningDiscoveryState = {
  schemaVersion: 1,
  revision: 5,
  enforced: true,
  status: 'assumptions_attested',
  mode: 'assumptions',
  inspection,
  brief,
  digest: planningDiscoveryDigest(brief),
  attestation: 'PLAN WITH ASSUMPTIONS',
  attestationReason: 'Proceed with explicit assumptions while preserving every approval gate',
  acknowledgesPreservedOperationalGates: true,
  confirmedBy: 'peet',
  confirmedAt: '2026-07-27T00:03:00.000Z',
}

describe('watcher planning readiness parity', () => {
  it.each([
    ['canonical confirmed state', confirmed],
    ['canonical assumption state', assumptions],
    ['missing inspection', { ...confirmed, inspection: undefined }],
    ['incomplete brief', { ...confirmed, brief: { ...brief, risks: [] } }],
    ['stale digest', { ...confirmed, digest: 'stale' }],
    ['low confidence', { ...confirmed, confidence: 94 }],
    ['missing interview evidence', { ...confirmed, turns: [] }],
    ['truthy confirmed metadata accepted by canonical readiness', { ...confirmed, confirmedBy: ' ' }],
    ['wrong assumption mode', { ...assumptions, mode: 'interview' }],
    ['missing gate acknowledgement', { ...assumptions, acknowledgesPreservedOperationalGates: undefined }],
    ['truthy assumption metadata accepted by canonical readiness', { ...assumptions, confirmedAt: ' ' }],
  ])('matches the canonical predicate for %s', (_label, state) => {
    expect(isWatcherPlanningReady(state)).toBe(isPlanningReady(state))
  })
})