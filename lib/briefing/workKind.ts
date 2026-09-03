/**
 * Work-kind taxonomy for briefing cards.
 *
 * Every briefing card belongs to exactly one work lane that describes the kind
 * of human action it needs. Classification is by source type first, source
 * status second, and copy keywords last, so cards land in a predictable lane
 * regardless of how an adapter phrased its title.
 *
 * The same function runs server-side (stamped on `/api/v1/briefings/feed`) and
 * as a client fallback, so Pip, Hermes, and the desk agree on the lanes.
 */

import type { BriefingCard, BriefingPriority } from './types'

export type BriefingWorkKind = 'meeting' | 'reply' | 'approval' | 'agent' | 'blocked'

export const BRIEFING_WORK_KINDS: readonly BriefingWorkKind[] = ['meeting', 'reply', 'approval', 'agent', 'blocked'] as const

export interface BriefingWorkLane {
  id: BriefingWorkKind
  label: string
  icon: string
  description: string
}

export const BRIEFING_WORK_LANES: readonly BriefingWorkLane[] = [
  { id: 'meeting', label: 'Meetings', icon: 'event', description: 'Calls to make, bookings to confirm, meetings to join' },
  { id: 'reply', label: 'Replies', icon: 'reply', description: 'Emails, DMs, tickets, enquiries and CRM follow-ups waiting on a reply' },
  { id: 'approval', label: 'Approvals', icon: 'verified', description: 'Content, documents, spend and agent work waiting for a decision' },
  { id: 'agent', label: 'Agent work', icon: 'smart_toy', description: 'What the agents are doing right now' },
  { id: 'blocked', label: 'Blocked', icon: 'front_hand', description: 'Work that cannot move until someone clears a blocker' },
] as const

export function briefingWorkLane(kind: BriefingWorkKind): BriefingWorkLane {
  return BRIEFING_WORK_LANES.find((lane) => lane.id === kind) ?? BRIEFING_WORK_LANES[1]
}

/** Structural input so both the server BriefingCard and the lighter desk card shape qualify. */
export type WorkKindInput = {
  source: { type: string }
  priority: BriefingPriority
  title: string
  summary: string
  excerpt?: string | null
  metadata?: Record<string, unknown> | null
  actor?: { id?: string | null; type?: string | null } | null
  context?: Partial<BriefingCard['context']>
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function meta(item: WorkKindInput, key: string): string {
  return text(item.metadata?.[key])
}

function hasPhone(item: WorkKindInput): boolean {
  return Boolean(meta(item, 'phone') || meta(item, 'contactPhone') || meta(item, 'mobile'))
}

function hasCallTag(item: WorkKindInput): boolean {
  const tags = Array.isArray(item.metadata?.tags) ? item.metadata?.tags : []
  return tags.some((tag) => typeof tag === 'string' && /call-ready/i.test(tag))
}

function haystack(item: WorkKindInput): string {
  return `${item.title} ${item.summary} ${item.excerpt ?? ''}`.toLowerCase()
}

function statusOf(item: WorkKindInput): string {
  // Status enums use snake_case; normalise to spaces so word boundaries match.
  return [
    'status',
    'agentStatus',
    'columnId',
    'runStatus',
    'brokerStatus',
    'invoiceStatus',
    'quoteStatus',
    'orderStatus',
    'fulfillmentStatus',
    'shipmentStatus',
    'inventoryStatus',
    'reportStatus',
    'seoTaskStatus',
    'broadcastStatus',
    'campaignStatus',
    'reviewState',
    'approvalStatus',
  ].map((key) => meta(item, key).replace(/[_-]+/g, ' ')).filter(Boolean).join(' ')
}

const BLOCKED_STATUS = /\b(blocked|failed|error|cancel+ed|out of stock|lost|exception|overdue)\b/
const RUNNING_STATUS = /\b(running|in progress|pending|queued|todo|assigned|paused|waiting)\b/

/**
 * Decide which work lane a briefing item belongs to.
 */
export function workKindForItem(item: WorkKindInput): BriefingWorkKind {
  const type = item.source.type
  const status = statusOf(item)
  const copy = haystack(item)
  const isAgentActor = item.actor?.type === 'agent'

  // 1. Meetings: things that end in a call or a calendar slot.
  if (type === 'booking' || type === 'calendar-event') return 'meeting'
  if (type === 'task' && hasCallTag(item)) return 'meeting'
  if ((type === 'contact' || type === 'deal' || type === 'activity') && (hasPhone(item) || meta(item, 'followUpIntent') || /\b(call|meeting|book)\b/.test(copy))) {
    return 'meeting'
  }

  // 2. Blocked work that needs a human to clear it (checked before approvals so
  //    failed agent output lands here rather than in review).
  if (type === 'task') {
    const agentStatus = meta(item, 'agentStatus')
    const columnId = meta(item, 'columnId')
    if (agentStatus === 'blocked' || columnId === 'blocked' || agentStatus === 'awaiting-input') return 'blocked'
  }
  if (type === 'agent-output' && (BLOCKED_STATUS.test(status) || /\bblocked\b/.test(copy))) return 'blocked'
  if (type === 'agent-run' && /\b(failed|error|cancelled|canceled)\b/.test(status)) return 'blocked'
  if ((type === 'order' || type === 'shipment' || type === 'report' || type === 'inventory-item' || type === 'workspace-broker-job' || type === 'broadcast' || type === 'seo-task') && BLOCKED_STATUS.test(status)) {
    return 'blocked'
  }
  if (type === 'invoice' && /\boverdue\b/.test(`${status} ${copy}`)) return 'blocked'

  // 3. Approvals: something is produced and waits for a decision.
  if (
    type === 'approval'
    || type === 'client-document'
    || type === 'social-post'
    || type === 'seo-content'
    || type === 'ad-campaign'
    || type === 'expense'
    || type === 'quote'
    || type === 'agent-learning-review'
    || type === 'business-insight-review'
    || type === 'workspace-broker-job'
  ) return 'approval'
  if (type === 'agent-output') return 'approval'
  if (type === 'agent-run' && /\b(waiting|approval|paused)\b/.test(`${status} ${copy}`)) return 'approval'
  if (type === 'invoice' && /\b(draft|payment pending verification|proof)\b/.test(`${status} ${copy}`)) return 'approval'
  if ((type === 'broadcast' || type === 'campaign') && /\b(draft|ready|approve|launch|paused)\b/.test(`${status} ${copy}`)) return 'approval'
  if (type === 'report' && /\b(ready|review)\b/.test(`${status} ${copy}`)) return 'approval'
  if (type === 'task') {
    const approvalStatus = meta(item, 'approvalStatus')
    const reviewStatus = meta(item, 'reviewStatus')
    const requiresApproval = item.metadata?.requiresApproval === true
    if ((requiresApproval && (!approvalStatus || approvalStatus === 'pending')) || reviewStatus === 'pending' || reviewStatus === 'changes-requested' || meta(item, 'columnId') === 'review') {
      return 'approval'
    }
  }

  // 4. Replies: a person is waiting to hear back.
  if (
    type === 'mailbox-message'
    || type === 'social-inbox'
    || type === 'support-ticket'
    || type === 'comment'
    || type === 'enquiry'
    || type === 'form-submission'
    || type === 'contact'
    || type === 'deal'
    || type === 'activity'
  ) return 'reply'
  if (type === 'notification') {
    if (isAgentActor && !/\b(reply|follow[- ]?up|message|email|contact)\b/.test(copy)) return 'agent'
    return 'reply'
  }

  // 5. Agent work: the machines are moving, nothing needed from a human yet.
  if (type === 'agent-run' || type === 'project' || type === 'seo-task') return 'agent'
  if (type === 'task') {
    if (item.priority === 'critical') return 'blocked'
    if (RUNNING_STATUS.test(status) || isAgentActor || meta(item, 'assigneeAgentId')) return 'agent'
    if (item.priority === 'progress' || item.priority === 'fyi') return 'agent'
    return 'blocked'
  }

  // 6. Remaining operational sources: critical means blocked, otherwise it is
  //    background movement.
  if (item.priority === 'critical' || item.priority === 'needs-peet' || item.priority === 'client-risk') return 'blocked'
  if (['order', 'shipment', 'inventory-item', 'invoice', 'report', 'broadcast', 'campaign'].includes(type)) return 'agent'
  return isAgentActor ? 'agent' : 'reply'
}

/**
 * Prefer the server-stamped kind, fall back to local classification.
 */
export function resolveWorkKind(item: WorkKindInput & { workKind?: BriefingWorkKind | null }): BriefingWorkKind {
  if (item.workKind && BRIEFING_WORK_KINDS.includes(item.workKind)) return item.workKind
  return workKindForItem(item)
}
