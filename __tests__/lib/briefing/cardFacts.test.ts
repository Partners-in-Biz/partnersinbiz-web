import { activityAdapter } from '@/lib/briefing/adapters/notificationAdapter'
import { invoiceAdapter } from '@/lib/briefing/adapters/invoiceAdapter'
import { quoteAdapter } from '@/lib/briefing/adapters/quoteAdapter'
import { supportTicketAdapter } from '@/lib/briefing/adapters/supportTicketAdapter'
import { getSourceTypes } from '@/lib/briefing'
import {
  applyCrmDisplayRecords,
  briefingDisplayFacts,
  briefingHandoffAgentId,
  briefingHasContactChannel,
  briefingListFacts,
  briefingPersonName,
  briefingSpecificTitle,
} from '@/lib/briefing/cardFacts'
import { buildBriefingCardContract } from '@/lib/briefing/cardContract'
import type { BriefingCard, BriefingSourceItem, BriefingSourceType } from '@/lib/briefing/types'

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

function sampleItem(
  type: BriefingSourceType,
  context: BriefingSourceItem['context'],
  metadata: Record<string, unknown>,
): BriefingSourceItem {
  return {
    orgId: 'org-1',
    source: { type, id: `${type}-1`, collectionPath: type, url: `/${type}/1` },
    priority: 'review',
    status: 'active',
    title: `Generic ${type} title`,
    summary: `Generic ${type} summary`,
    excerpt: null,
    actor: { id: 'user:1', name: 'Operator', role: 'admin', type: 'user' },
    context: { orgId: 'org-1', ...context },
    occurredAt: new Date('2026-08-20T12:00:00.000Z'),
    sourceHash: 'hash',
    metadata,
  }
}

const SOURCE_FACT_CASES: Array<{
  type: BriefingSourceType
  context: BriefingSourceItem['context']
  metadata: Record<string, unknown>
  factIds: string[]
  factValues?: Record<string, string>
  channel?: boolean
  person?: string
  handoff?: string
}> = [
  { type: 'activity', context: { dealTitle: 'Acme rebuild', contactName: 'Jane Buyer', companyName: 'Acme' }, metadata: { value: 12000, currency: 'ZAR', email: 'jane@acme.test', phone: '+27820000001', toStageLabel: 'Qualified' }, factIds: ['deal', 'value', 'company', 'contact', 'email', 'phone'], channel: true, person: 'Jane Buyer', handoff: 'sales' },
  { type: 'contact', context: { contactName: 'Ivy Import' }, metadata: { email: 'ivy@example.test', phone: '+27820000002', company: 'Scale Co', jobTitle: 'Buyer' }, factIds: ['contact', 'company', 'email', 'phone', 'role'], channel: true, person: 'Ivy Import', handoff: 'sales' },
  { type: 'deal', context: { dealTitle: 'Retainer', contactName: 'Ava Owner', companyName: 'Acme' }, metadata: { value: 18000, currency: 'ZAR', stageLabel: 'Proposal' }, factIds: ['deal', 'value', 'company', 'contact', 'stage'], handoff: 'sales' },
  { type: 'booking', context: { bookingName: 'Mia Founder' }, metadata: { email: 'mia@example.test', company: 'Mia Studio', date: '2026-06-01', time: '10:30' }, factIds: ['booking', 'company', 'email', 'when'], channel: true, person: 'Mia Founder', handoff: 'sales' },
  { type: 'calendar-event', context: { calendarEventTitle: 'Retainer check-in', contactName: 'Ava Owner' }, metadata: { attendeeEmail: 'ava@example.test', startAt: '2026-06-01T08:00:00.000Z' }, factIds: ['calendar', 'contact', 'email', 'when'], channel: true, person: 'Ava Owner', handoff: 'sales' },
  { type: 'enquiry', context: { enquiryName: 'Ava Owner' }, metadata: { email: 'ava@example.test', company: 'Acme Holdings' }, factIds: ['enquiry', 'company', 'email'], channel: true, person: 'Ava Owner', handoff: 'sales' },
  { type: 'form-submission', context: { contactName: 'Ava Owner' }, metadata: { email: 'ava@example.test' }, factIds: ['contact', 'email'], channel: true, person: 'Ava Owner', handoff: 'sales' },
  { type: 'invoice', context: { invoiceNumber: 'INV-1001' }, metadata: { recipientName: 'Riley Client', recipientEmail: 'riley@client.test', total: 12500, currency: 'ZAR', invoiceStatus: 'draft', dueDate: '2026-06-02' }, factIds: ['invoice', 'value', 'contact', 'email', 'status', 'when'], channel: true, person: 'Riley Client', handoff: 'nora' },
  { type: 'quote', context: { quoteNumber: 'QUO-1001' }, metadata: { recipientName: 'Riley Client', recipientEmail: 'riley@client.test', total: 18500, currency: 'ZAR', quoteStatus: 'sent' }, factIds: ['quote', 'value', 'contact', 'email', 'status'], channel: true, person: 'Riley Client', handoff: 'sales' },
  { type: 'order', context: { orderTitle: 'Website onboarding', companyName: 'Acme' }, metadata: { total: 18500, currency: 'ZAR', orderStatus: 'confirmed' }, factIds: ['order', 'value', 'status', 'company'] },
  { type: 'shipment', context: { shipmentTrackingNumber: 'DHL-123', companyName: 'Acme' }, metadata: { carrier: 'DHL', shipmentStatus: 'in_transit', expectedDeliveryDate: '2026-06-02' }, factIds: ['tracking', 'carrier', 'status', 'company', 'when'] },
  { type: 'inventory-item', context: { inventoryItemName: 'SEO hours' }, metadata: { sku: 'SEO-1', inventoryStatus: 'low' }, factIds: ['sku', 'status'] },
  { type: 'expense', context: { expenseCategory: 'Travel' }, metadata: { amount: 425, currency: 'ZAR', vendor: 'Bolt', expenseStatus: 'submitted' }, factIds: ['value', 'vendor', 'status'], handoff: 'nora' },
  { type: 'support-ticket', context: { supportTicketSubject: 'Form not sending', contactName: 'Riley Client' }, metadata: { requesterEmail: 'riley@client.test', supportStatus: 'waiting_on_us' }, factIds: ['ticket', 'contact', 'email', 'status'], channel: true, person: 'Riley Client', handoff: 'support' },
  { type: 'report', context: { reportTitle: 'May performance', projectName: 'Launch site' }, metadata: { reportStatus: 'rendered' }, factIds: ['report', 'project', 'status'], handoff: 'docs' },
  { type: 'mailbox-message', context: { mailboxFrom: 'Client Lead', mailboxSubject: 'Book a call' }, metadata: { fromEmail: 'lead@example.test' }, factIds: ['mailbox', 'subject', 'email'], channel: true, person: 'Client Lead', handoff: 'support' },
  { type: 'social-inbox', context: { socialInboxFrom: 'Mia Prospect', campaignName: 'Launch' }, metadata: { socialInboxStatus: 'unread' }, factIds: ['contact', 'campaign'], person: 'Mia Prospect', handoff: 'maya' },
  { type: 'social-post', context: { campaignName: 'June push' }, metadata: { reviewState: 'awaiting' }, factIds: ['campaign'], handoff: 'maya' },
  { type: 'ad-campaign', context: { adCampaignName: 'Lead gen' }, metadata: { dailyBudget: 25000, currency: 'ZAR', adCampaignStatus: 'PENDING_REVIEW' }, factIds: ['campaign', 'value', 'status'], handoff: 'ads' },
  { type: 'broadcast', context: { broadcastName: 'June newsletter' }, metadata: { subject: 'June update', broadcastStatus: 'draft' }, factIds: ['campaign', 'subject', 'status'], handoff: 'maya' },
  { type: 'campaign', context: { campaignName: 'Retention nurture' }, metadata: { campaignStatus: 'active' }, factIds: ['campaign', 'status'], handoff: 'maya' },
  { type: 'seo-task', context: { seoTaskTitle: 'Choose keyword theme', projectName: 'Launch site' }, metadata: { seoTaskStatus: 'blocked' }, factIds: ['seo', 'status', 'project'], handoff: 'seo' },
  { type: 'seo-content', context: { seoContentTitle: 'Local service page' }, metadata: { seoStatus: 'review' }, factIds: ['seo', 'status'], handoff: 'seo' },
  { type: 'client-document', context: { documentTitle: 'Scope v2', projectName: 'Launch site' }, metadata: { documentStatus: 'review' }, factIds: ['document', 'status', 'project'], handoff: 'docs' },
  { type: 'comment', context: { taskTitle: 'Fix form', projectName: 'Launch site', documentTitle: 'Scope v2' }, metadata: {}, factIds: ['task', 'project', 'document'] },
  { type: 'task', context: { taskTitle: 'Unblock launch', projectName: 'Launch site' }, metadata: {}, factIds: ['task', 'project'] },
  { type: 'project', context: { projectName: 'Launch site', taskTitle: 'Kickoff' }, metadata: {}, factIds: ['project', 'task'] },
  { type: 'approval', context: { taskTitle: 'Approve spend', projectName: 'Launch site' }, metadata: {}, factIds: ['task', 'project'] },
  { type: 'agent-output', context: { taskTitle: 'Ship CRM cards', projectName: 'Launch site' }, metadata: { assigneeAgentId: 'theo' }, factIds: ['task', 'project'], handoff: 'theo' },
  { type: 'agent-learning-review', context: { taskTitle: 'Skill update', projectName: 'Partners' }, metadata: {}, factIds: ['task', 'project'] },
  { type: 'business-insight-review', context: { taskTitle: 'Gap review', projectName: 'Partners' }, metadata: {}, factIds: ['task', 'project'] },
  { type: 'agent-run', context: {}, metadata: { runStatus: 'waiting_for_approval', agentId: 'theo' }, factIds: ['status'], handoff: 'theo' },
  { type: 'workspace-broker-job', context: {}, metadata: { brokerStatus: 'needs_approval' }, factIds: ['status'] },
  { type: 'notification', context: { contactName: 'Ava Owner', dealTitle: 'Retainer' }, metadata: {}, factIds: ['contact', 'deal'] },
]

describe('task-specific facts for every briefing source type', () => {
  it('covers every registered source type', () => {
    expect(SOURCE_FACT_CASES.map((row) => row.type).sort()).toEqual([...getSourceTypes()].sort())
  })

  it.each(SOURCE_FACT_CASES)('ranks useful $type facts and omits unknown placeholders', ({ type, context, metadata, factIds, factValues, channel, person, handoff }) => {
    const item = sampleItem(type, context, metadata)
    const facts = briefingDisplayFacts(item)
    const list = briefingListFacts(item)
    expect(facts.every((fact) => fact.value !== 'Unknown')).toBe(true)
    expect(list.every((fact) => fact.value !== 'Unknown')).toBe(true)
    expect(facts.map((fact) => fact.id)).toEqual(expect.arrayContaining(factIds))
    expect(list.map((fact) => fact.id)).toEqual(expect.arrayContaining(factIds.slice(0, Math.min(3, factIds.length))))
    for (const [id, value] of Object.entries(factValues ?? {})) {
      expect(facts.find((fact) => fact.id === id)?.value).toBe(value)
    }
    if (channel) expect(briefingHasContactChannel(item)).toBe(true)
    if (person) expect(briefingPersonName(item)).toBe(person)
    if (handoff) expect(briefingHandoffAgentId(item)).toBe(handoff)

    const contract = buildBriefingCardContract(item)
    if (channel) {
      expect(contract.nearestValidActions.some((action) => action.action === 'call-contact' || action.action === 'email-contact')).toBe(true)
    }
    if (handoff) expect(contract.agentHandoff.targetAgentId).toBe(handoff)
  })

  it('exposes call and email from invoice, quote, and support adapters', () => {
    const invoice = invoiceAdapter.toItem({
      orgId: 'org-1',
      invoiceNumber: 'INV-9',
      status: 'draft',
      total: 9000,
      currency: 'ZAR',
      recipientName: 'Riley Client',
      recipientEmail: 'riley@client.test',
      recipientCompanyName: 'Acme',
    }, 'inv-9')
    expect(invoice.context.contactName).toBe('Riley Client')
    expect(briefingHasContactChannel(invoice)).toBe(true)
    expect(briefingDisplayFacts(invoice).map((fact) => fact.id)).toEqual(expect.arrayContaining(['invoice', 'value', 'contact', 'email']))
    expect(buildBriefingCardContract(invoice).agentHandoff.targetAgentId).toBe('nora')
    expect(buildBriefingCardContract(invoice).nearestValidActions.map((action) => action.action)).toContain('email-contact')

    const quote = quoteAdapter.toItem({
      orgId: 'org-1',
      quoteNumber: 'QUO-9',
      status: 'sent',
      total: 11000,
      currency: 'ZAR',
      recipientName: 'Riley Client',
      recipientEmail: 'riley@client.test',
    }, 'quo-9')
    expect(briefingHasContactChannel(quote)).toBe(true)
    expect(buildBriefingCardContract(quote).agentHandoff.targetAgentId).toBe('sales')

    const ticket = supportTicketAdapter.toItem({
      orgId: 'org-1',
      subject: 'Form outage',
      description: 'Leads are dropping.',
      status: 'new',
      priority: 'urgent',
      requesterName: 'Riley Client',
      requesterEmail: 'riley@client.test',
    }, 'ticket-9')
    expect(ticket.context.contactName).toBe('Riley Client')
    expect(briefingHasContactChannel(ticket)).toBe(true)
    expect(buildBriefingCardContract(ticket).agentHandoff.targetAgentId).toBe('support')
  })
})
