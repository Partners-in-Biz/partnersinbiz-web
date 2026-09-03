import { BRIEFING_WORK_LANES, briefingWorkLane, resolveWorkKind, workKindForItem } from '@/lib/briefing/workKind'

type Input = Parameters<typeof workKindForItem>[0]

function item(type: string, overrides: Partial<Input> = {}): Input {
  return {
    source: { type },
    priority: 'review',
    title: overrides.title ?? `${type} card`,
    summary: overrides.summary ?? 'Summary',
    ...overrides,
  }
}

describe('workKindForItem', () => {
  it('routes bookings, calendar events and call-ready tasks to meetings', () => {
    expect(workKindForItem(item('booking', { priority: 'critical', title: 'Booking needs Meet link: Buhle' }))).toBe('meeting')
    expect(workKindForItem(item('calendar-event', { title: 'RSVP needed: Kickoff' }))).toBe('meeting')
    expect(workKindForItem(item('task', { metadata: { tags: ['call-ready'] } }))).toBe('meeting')
  })

  it('sends CRM contacts with a phone number to meetings and the rest to replies', () => {
    expect(workKindForItem(item('contact', { metadata: { phone: '+27 82 000 0000' } }))).toBe('meeting')
    expect(workKindForItem(item('contact', { metadata: { email: 'a@b.co' } }))).toBe('reply')
    expect(workKindForItem(item('deal', { title: 'Proposal follow-up: ACME' }))).toBe('reply')
  })

  it('puts inbox-style sources in replies', () => {
    for (const type of ['mailbox-message', 'social-inbox', 'support-ticket', 'comment', 'enquiry', 'form-submission']) {
      expect(workKindForItem(item(type))).toBe('reply')
    }
  })

  it('puts review gates in approvals', () => {
    for (const type of ['approval', 'client-document', 'social-post', 'seo-content', 'ad-campaign', 'expense', 'quote', 'agent-learning-review', 'business-insight-review']) {
      expect(workKindForItem(item(type))).toBe('approval')
    }
    expect(workKindForItem(item('agent-output', { title: 'Theo completed: Landing page', metadata: { columnId: 'review' } }))).toBe('approval')
    expect(workKindForItem(item('task', { priority: 'needs-peet', metadata: { requiresApproval: true, approvalStatus: 'pending' } }))).toBe('approval')
    expect(workKindForItem(item('invoice', { metadata: { invoiceStatus: 'draft' } }))).toBe('approval')
    expect(workKindForItem(item('agent-run', { metadata: { runStatus: 'waiting_approval' } }))).toBe('approval')
  })

  it('classifies blocked and failed work before approvals', () => {
    expect(workKindForItem(item('task', { priority: 'critical', metadata: { agentStatus: 'blocked', requiresApproval: true } }))).toBe('blocked')
    expect(workKindForItem(item('task', { priority: 'needs-peet', metadata: { agentStatus: 'awaiting-input' } }))).toBe('blocked')
    expect(workKindForItem(item('agent-output', { title: 'Theo blocked', metadata: { columnId: 'blocked' } }))).toBe('blocked')
    expect(workKindForItem(item('agent-run', { metadata: { runStatus: 'failed' } }))).toBe('blocked')
    expect(workKindForItem(item('shipment', { metadata: { shipmentStatus: 'failed' } }))).toBe('blocked')
    expect(workKindForItem(item('inventory-item', { metadata: { inventoryStatus: 'out_of_stock' } }))).toBe('blocked')
    expect(workKindForItem(item('invoice', { metadata: { invoiceStatus: 'overdue' } }))).toBe('blocked')
  })

  it('keeps moving agent work in the agent lane', () => {
    expect(workKindForItem(item('agent-run', { priority: 'progress', metadata: { runStatus: 'running' } }))).toBe('agent')
    expect(workKindForItem(item('task', { priority: 'progress', metadata: { agentStatus: 'in-progress', assigneeAgentId: 'theo' }, actor: { id: 'agent:theo', type: 'agent' } }))).toBe('agent')
    expect(workKindForItem(item('project', { priority: 'fyi' }))).toBe('agent')
    expect(workKindForItem(item('seo-task', { priority: 'progress' }))).toBe('agent')
    expect(workKindForItem(item('shipment', { priority: 'progress', metadata: { shipmentStatus: 'in_transit' } }))).toBe('agent')
  })

  it('treats agent notifications as agent work and human notifications as replies', () => {
    expect(workKindForItem(item('notification', { actor: { id: 'agent:theo', type: 'agent' }, title: 'Theo finished a task' }))).toBe('agent')
    expect(workKindForItem(item('notification', { actor: { id: 'user:1', type: 'user' }, title: 'New comment' }))).toBe('reply')
  })

  it('prefers the server-stamped kind when present', () => {
    expect(resolveWorkKind({ ...item('contact'), workKind: 'blocked' })).toBe('blocked')
    expect(resolveWorkKind({ ...item('contact'), workKind: null })).toBe('reply')
  })

  it('exposes five ordered lanes with labels', () => {
    expect(BRIEFING_WORK_LANES.map((lane) => lane.id)).toEqual(['meeting', 'reply', 'approval', 'agent', 'blocked'])
    expect(briefingWorkLane('approval').label).toBe('Approvals')
  })
})
