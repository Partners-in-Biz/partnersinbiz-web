import { activityAdapter } from '@/lib/briefing/adapters/notificationAdapter'
import { applyCrmDisplayRecords, briefingDisplayFacts, briefingHasContactChannel, briefingSpecificTitle } from '@/lib/briefing/cardFacts'
import { buildBriefingCardContract } from '@/lib/briefing/cardContract'
import type { BriefingCard } from '@/lib/briefing/types'

describe('activityAdapter CRM stage-change cards', () => {
  it('titles a deal move with the deal, value, and new stage instead of the actor name', () => {
    const item = activityAdapter.toItem({
      id: 'activity-1',
      orgId: 'org-1',
      type: 'stage_change',
      summary: 'Deal moved: New lead → Qualified',
      contactId: 'contact-1',
      dealId: 'deal-1',
      metadata: {
        dealTitle: 'Acme website rebuild',
        fromStageLabel: 'New lead',
        toStageLabel: 'Qualified',
        value: 45000,
        currency: 'ZAR',
        companyName: 'Acme Holdings',
        contactName: 'Jane Buyer',
        email: 'jane@acme.test',
        phone: '+27821234567',
      },
      createdByRef: { uid: 'user-1', displayName: 'Peet Stander', role: 'admin' },
      createdAt: '2026-07-31T11:54:00.000Z',
    }, 'activity-1')

    expect(item.title).toBe('Acme website rebuild · R45,000 → Qualified')
    expect(item.summary).toContain('Deal: Acme website rebuild')
    expect(item.summary).toContain('Value: R45,000')
    expect(item.summary).toContain('Company: Acme Holdings')
    expect(item.summary).toContain('Contact: Jane Buyer')
    expect(item.summary).toContain('jane@acme.test')
    expect(item.summary).not.toContain('Activity: stage_change')
    expect(item.context).toMatchObject({
      dealId: 'deal-1',
      dealTitle: 'Acme website rebuild',
      contactId: 'contact-1',
      contactName: 'Jane Buyer',
      companyName: 'Acme Holdings',
    })
    expect(item.metadata).toMatchObject({
      email: 'jane@acme.test',
      phone: '+27821234567',
      value: 45000,
      toStageLabel: 'Qualified',
    })
  })
})

describe('briefing card facts', () => {
  it('fills unknown deal/contact cards from CRM records and exposes call/email channels', () => {
    const item = {
      id: 'activity:activity-2',
      orgId: 'org-1',
      title: 'Peet Stander: Deal moved: New lead → Qualified',
      summary: 'Activity: stage_change — Deal moved: New lead → Qualified',
      source: { type: 'activity', id: 'activity-2', collectionPath: 'activities' },
      priority: 'fyi',
      actor: { id: 'user:peet', name: 'Peet Stander', role: 'admin', type: 'user' },
      context: {
        orgId: 'org-1',
        contactId: 'contact-opaque',
        dealId: 'deal-opaque',
      },
      metadata: {
        activityType: 'stage_change',
        fromStageLabel: 'New lead',
        toStageLabel: 'Qualified',
      },
      occurredAt: '2026-07-31T11:54:00.000Z',
      sourceHash: 'hash',
    } as BriefingCard

    const enriched = applyCrmDisplayRecords(item, {
      deal: { id: 'deal-opaque', title: 'Acme website rebuild', value: 45000, currency: 'ZAR', companyName: 'Acme Holdings', contactId: 'contact-opaque' },
      contact: { id: 'contact-opaque', name: 'Jane Buyer', email: 'jane@acme.test', phone: '+27821234567', companyName: 'Acme Holdings' },
      company: { id: 'company-1', name: 'Acme Holdings' },
    })

    expect(briefingSpecificTitle(enriched)).toContain('Acme website rebuild')
    expect(enriched.context.dealTitle).toBe('Acme website rebuild')
    expect(enriched.context.contactName).toBe('Jane Buyer')
    expect(enriched.context.companyName).toBe('Acme Holdings')
    expect(enriched.metadata?.email).toBe('jane@acme.test')
    expect(enriched.metadata?.phone).toBe('+27821234567')
    expect(briefingHasContactChannel(enriched)).toBe(true)
    const facts = briefingDisplayFacts(enriched)
    expect(facts.map((fact) => fact.id)).toEqual(expect.arrayContaining(['deal', 'value', 'company', 'contact', 'email', 'phone', 'stage']))
    expect(facts.find((fact) => fact.id === 'deal')?.value).toBe('Acme website rebuild')
    expect(facts.find((fact) => fact.id === 'value')?.value).toBe('R45,000')
    expect(facts.every((fact) => fact.value !== 'Unknown')).toBe(true)
  })

  it('keeps contact and deal adapter titles instead of rewriting them from CRM records', () => {
    const item = {
      id: 'contact:contact-import',
      orgId: 'org-1',
      title: 'Import follow-up: Ivy Import',
      summary: 'Imported lead needs qualification before any outreach',
      source: { type: 'contact', id: 'contact-import', collectionPath: 'contacts' },
      priority: 'needs-peet',
      actor: { id: 'crm:contact-import', name: 'Ivy Import', role: 'client', type: 'user' },
      context: { orgId: 'org-1', contactId: 'contact-import', contactName: 'Ivy Import' },
      metadata: { email: 'ivy@example.test', contactStage: 'new' },
      occurredAt: '2026-05-20T08:00:00.000Z',
      sourceHash: 'hash',
    } as BriefingCard

    const enriched = applyCrmDisplayRecords(item, {
      contact: { id: 'contact-import', name: 'Ivy Import', email: 'ivy@example.test', companyName: 'Scale Co' },
    })

    expect(enriched.title).toBe('Import follow-up: Ivy Import')
    expect(enriched.summary).toContain('Imported lead needs qualification')
    expect(enriched.context.companyName).toBe('Scale Co')
  })

  it('builds CRM-specific actions instead of a generic review contract', () => {
    const item = activityAdapter.toItem({
      id: 'activity-3',
      orgId: 'org-1',
      type: 'stage_change',
      summary: 'Deal moved: New lead → Qualified',
      contactId: 'contact-1',
      dealId: 'deal-1',
      dealTitle: 'Acme website rebuild',
      contactName: 'Jane Buyer',
      metadata: {
        toStageLabel: 'Qualified',
        email: 'jane@acme.test',
        phone: '+27821234567',
        value: 12000,
        currency: 'ZAR',
      },
      createdAt: '2026-07-31T11:54:00.000Z',
    }, 'activity-3')

    const contract = buildBriefingCardContract(item)
    expect(contract.decisionRequest.prompt).toContain('Acme website rebuild')
    expect(contract.options.map((option) => option.id)).toEqual(expect.arrayContaining(['log-follow-up', 'create-follow-up']))
    expect(contract.options.map((option) => option.id)).not.toContain('review')
    expect(contract.nearestValidActions.map((action) => action.action)).toEqual(expect.arrayContaining(['call-contact', 'email-contact']))
    expect(contract.agentHandoff.targetAgentId).toBe('sales')
    expect(contract.disabledReason).toBeNull()
  })
})
