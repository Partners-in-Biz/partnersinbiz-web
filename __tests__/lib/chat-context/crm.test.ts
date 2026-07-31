import { crmChatActions } from '@/lib/chat-context/adapters/crm'
import type { PipelineStage } from '@/lib/pipelines/types'

const stages: PipelineStage[] = [
  { id: 'discovery', label: 'Discovery', kind: 'open', order: 0, probability: 10 },
  { id: 'proposal', label: 'Proposal', kind: 'open', order: 1, probability: 40 },
  { id: 'won', label: 'Won', kind: 'won', order: 2, probability: 100 },
  { id: 'lost', label: 'Lost', kind: 'lost', order: 3, probability: 0 },
]

describe('CRM chat actions', () => {
  it('keeps viewers read-only', () => {
    expect(crmChatActions({
      kind: 'contact',
      id: 'contact-1',
      data: { stage: 'new' },
      actorUid: 'viewer-1',
      actorRole: 'viewer',
      apiRole: 'client',
    })).toEqual([])
  })

  it('lets a member claim and advance an accessible contact without exposing admin scoring', () => {
    expect(crmChatActions({
      kind: 'contact',
      id: 'contact-1',
      data: { assignedTo: 'member-2', stage: 'contacted' },
      actorUid: 'member-1',
      actorRole: 'member',
      apiRole: 'client',
    })).toEqual([
      {
        id: 'claim-crm-contact:contact-1',
        label: 'Assign to me',
        href: '/api/v1/crm/contacts/contact-1',
        method: 'PATCH',
        requiresApproval: true,
        body: { assignedTo: 'member-1' },
      },
      {
        id: 'advance-crm-contact:contact-1:replied',
        label: 'Move to Replied',
        href: '/api/v1/crm/contacts/contact-1',
        method: 'PATCH',
        requiresApproval: true,
        body: { stage: 'replied' },
      },
    ])
  })

  it('offers lead-score refresh only to CRM administrators', () => {
    expect(crmChatActions({
      kind: 'contact',
      id: 'contact-1',
      data: { assignedTo: 'admin-1', stage: 'proposal' },
      actorUid: 'admin-1',
      actorRole: 'admin',
      apiRole: 'admin',
    })).toEqual([
      {
        id: 'score-crm-contact:contact-1',
        label: 'Refresh lead score',
        href: '/api/v1/crm/contacts/contact-1/recompute-score',
        method: 'POST',
        requiresApproval: true,
        body: { includeAi: true },
      },
    ])
  })

  it('uses the canonical company ownership field', () => {
    expect(crmChatActions({
      kind: 'company',
      id: 'company-1',
      data: { ownerUid: 'member-2' },
      actorUid: 'member-1',
      actorRole: 'member',
      apiRole: 'client',
    })).toEqual([
      expect.objectContaining({
        id: 'claim-crm-company:company-1',
        href: '/api/v1/crm/companies/company-1',
        body: { ownerUid: 'member-1' },
      }),
    ])
  })

  it('advances deals only to the supplied next open stage', () => {
    expect(crmChatActions({
      kind: 'deal',
      id: 'deal-1',
      data: { ownerUid: 'member-1', pipelineId: 'pipeline-1', stageId: 'discovery' },
      actorUid: 'member-1',
      actorRole: 'member',
      apiRole: 'client',
      nextDealStage: stages[1],
    })).toEqual([
      {
        id: 'advance-crm-deal:deal-1:proposal',
        label: 'Move to Proposal',
        href: '/api/v1/crm/deals/deal-1',
        method: 'PATCH',
        requiresApproval: true,
        body: { pipelineId: 'pipeline-1', stageId: 'proposal' },
      },
    ])

    expect(crmChatActions({
      kind: 'deal',
      id: 'deal-1',
      data: { ownerUid: 'member-1', pipelineId: 'pipeline-1', stageId: 'proposal' },
      actorUid: 'member-1',
      actorRole: 'member',
      apiRole: 'client',
      nextDealStage: null,
    })).toEqual([])
  })

  it('never offers agent identities as human CRM owners', () => {
    const actions = crmChatActions({
      kind: 'company',
      id: 'company-1',
      data: {},
      actorUid: 'agent:pip',
      actorRole: 'system',
      apiRole: 'ai',
    })

    expect(actions).toEqual([])
  })
})
