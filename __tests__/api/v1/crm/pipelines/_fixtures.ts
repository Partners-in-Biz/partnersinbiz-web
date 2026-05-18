// __tests__/api/v1/crm/pipelines/_fixtures.ts
import type { Pipeline, PipelineStage } from '@/lib/pipelines/types'
import { Timestamp } from 'firebase-admin/firestore'

// Re-export shared member + uid helpers from companies fixtures (A1) to
// keep the distinct-uid convention consistent across all CRM tests.
export { uidFor, buildAdminMember, buildRegularMember, buildOwnerMember, buildViewerMember } from '../companies/_fixtures'

/** The 5-stage default shape the A3 migration creates per org. */
export function defaultStages(): PipelineStage[] {
  return [
    { id: 'discovery',   label: 'Discovery',   kind: 'open', order: 0, probability: 10 },
    { id: 'proposal',    label: 'Proposal',    kind: 'open', order: 1, probability: 30 },
    { id: 'negotiation', label: 'Negotiation', kind: 'open', order: 2, probability: 60 },
    { id: 'won',         label: 'Won',         kind: 'won',  order: 3, probability: 100 },
    { id: 'lost',        label: 'Lost',        kind: 'lost', order: 4, probability: 0 },
  ]
}

let pipelineCounter = 0
export function buildPipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  pipelineCounter++
  return {
    id: overrides.id ?? `pipe_${pipelineCounter}_${Math.random().toString(36).slice(2, 6)}`,
    orgId: 'org-a',
    name: overrides.name ?? `Pipeline ${pipelineCounter}`,
    description: undefined,
    stages: defaultStages(),
    isDefault: false,
    archived: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides,
  }
}

export const sampleDefaultPipeline = buildPipeline({
  id: 'pipe_default_a',
  orgId: 'org-a',
  name: 'Sales',
  description: 'Default sales pipeline.',
  isDefault: true,
})

export const sampleRenewalsPipeline = buildPipeline({
  id: 'pipe_renewals_a',
  orgId: 'org-a',
  name: 'Renewals',
  description: 'Customer renewals.',
  isDefault: false,
  stages: [
    { id: 'upcoming',  label: 'Upcoming',  kind: 'open', order: 0, probability: 50 },
    { id: 'engaged',   label: 'Engaged',   kind: 'open', order: 1, probability: 70 },
    { id: 'renewed',   label: 'Renewed',   kind: 'won',  order: 2, probability: 100 },
    { id: 'churned',   label: 'Churned',   kind: 'lost', order: 3, probability: 0 },
  ],
})
