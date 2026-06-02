'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

interface OrgSummary {
  id: string
  name: string
  slug?: string
}

interface BriefingCard {
  id: string
  orgId: string
  priority: 'critical' | 'needs-peet' | 'client-risk' | 'review' | 'progress' | 'fyi'
  title: string
  summary: string
  excerpt?: string | null
  timeAgo?: string
  requiresAction?: boolean
  source: { type: string; id: string; url?: string }
  actor: { id: string; name?: string | null; role?: string; type?: string }
  context: {
    orgId: string
    orgName?: string | null
    orgSlug?: string | null
    companyId?: string | null
    companyName?: string | null
    projectId?: string | null
    projectName?: string | null
    taskId?: string | null
    taskTitle?: string | null
    documentId?: string | null
    documentTitle?: string | null
    conversationId?: string | null
    conversationTitle?: string | null
    contactId?: string | null
    contactName?: string | null
    dealId?: string | null
    dealTitle?: string | null
    reportId?: string | null
    reportTitle?: string | null
    bookingId?: string | null
    bookingName?: string | null
    supportTicketId?: string | null
    supportTicketSubject?: string | null
    invoiceId?: string | null
    invoiceNumber?: string | null
    quoteId?: string | null
    quoteNumber?: string | null
    orderId?: string | null
    orderTitle?: string | null
    inventoryItemId?: string | null
    inventoryItemName?: string | null
    shipmentId?: string | null
    shipmentTrackingNumber?: string | null
    expenseId?: string | null
    expenseCategory?: string | null
    seoContentId?: string | null
    seoContentTitle?: string | null
    seoTaskId?: string | null
    seoTaskTitle?: string | null
    seoSprintId?: string | null
    adCampaignId?: string | null
    adCampaignName?: string | null
    broadcastId?: string | null
    broadcastName?: string | null
    campaignId?: string | null
    campaignName?: string | null
    enquiryId?: string | null
    enquiryName?: string | null
    formId?: string | null
    formSubmissionId?: string | null
    formName?: string | null
    socialInboxId?: string | null
    socialInboxFrom?: string | null
    socialPostId?: string | null
    mailboxMessageId?: string | null
    mailboxFrom?: string | null
    mailboxSubject?: string | null
    agentRunId?: string | null
    agentProfile?: string | null
    workspaceBrokerJobId?: string | null
    workspaceBrokerOperation?: string | null
    workspaceArtifactId?: string | null
    workspaceArtifactTitle?: string | null
    calendarEventId?: string | null
    calendarEventTitle?: string | null
  }
  metadata?: Record<string, unknown> | null
  occurredAt: string
}

interface BriefingFeed {
  items: BriefingCard[]
  total: number
  hasMore: boolean
  generatedAt: string
}

type Mode = 'admin' | 'portal'
type Flash = { kind: 'ok' | 'error'; message: string } | null

const PRIORITIES = [
  { value: 'all', label: 'All priorities', icon: 'select_all' },
  { value: 'critical', label: 'Blocked', icon: 'priority_high' },
  { value: 'needs-peet', label: 'Needs Peet', icon: 'person_alert' },
  { value: 'client-risk', label: 'Risk', icon: 'release_alert' },
  { value: 'review', label: 'Review', icon: 'rate_review' },
  { value: 'progress', label: 'In motion', icon: 'motion_photos_auto' },
  { value: 'fyi', label: 'Changed', icon: 'history' },
]

const SOURCES = [
  { value: 'all', label: 'All sources' },
  { value: 'task', label: 'Tasks' },
  { value: 'comment', label: 'Comments' },
  { value: 'agent-output', label: 'Agent output' },
  { value: 'agent-run', label: 'Agent runs' },
  { value: 'workspace-broker-job', label: 'Workspace jobs' },
  { value: 'calendar-event', label: 'Calendar' },
  { value: 'booking', label: 'Bookings' },
  { value: 'project', label: 'Projects' },
  { value: 'client-document', label: 'Documents' },
  { value: 'social-post', label: 'Social posts' },
  { value: 'social-inbox', label: 'Social inbox' },
  { value: 'mailbox-message', label: 'Mailbox' },
  { value: 'approval', label: 'Approvals' },
  { value: 'notification', label: 'Notifications' },
  { value: 'activity', label: 'Activity' },
  { value: 'contact', label: 'Contacts' },
  { value: 'report', label: 'Reports' },
  { value: 'support-ticket', label: 'Support' },
  { value: 'invoice', label: 'Invoices' },
  { value: 'quote', label: 'Quotes' },
  { value: 'order', label: 'Orders' },
  { value: 'inventory-item', label: 'Inventory' },
  { value: 'shipment', label: 'Shipments' },
  { value: 'expense', label: 'Expenses' },
  { value: 'seo-content', label: 'SEO content' },
  { value: 'seo-task', label: 'SEO tasks' },
  { value: 'ad-campaign', label: 'Ad campaigns' },
  { value: 'broadcast', label: 'Broadcasts' },
  { value: 'campaign', label: 'Campaigns' },
  { value: 'enquiry', label: 'Enquiries' },
  { value: 'form-submission', label: 'Form submissions' },
]

const PRIORITY_LABELS: Record<BriefingCard['priority'], string> = {
  critical: 'Blocked',
  'needs-peet': 'Needs Peet',
  'client-risk': 'Risk',
  review: 'Review',
  progress: 'In motion',
  fyi: 'Changed',
}

function priorityClass(priority: BriefingCard['priority']) {
  switch (priority) {
    case 'critical':
      return 'border-red-400/45 bg-red-500/15 text-red-100'
    case 'needs-peet':
      return 'border-amber-300/45 bg-amber-400/15 text-amber-100'
    case 'client-risk':
      return 'border-orange-300/45 bg-orange-400/15 text-orange-100'
    case 'review':
      return 'border-sky-300/45 bg-sky-400/15 text-sky-100'
    case 'progress':
      return 'border-emerald-300/45 bg-emerald-400/15 text-emerald-100'
    default:
      return 'border-white/10 bg-white/[0.04] text-on-surface-variant'
  }
}

function priorityAccentColor(priority: BriefingCard['priority'] | string) {
  switch (priority) {
    case 'critical':
      return '#ef4444'
    case 'needs-peet':
      return 'var(--color-accent-v2)'
    case 'client-risk':
      return '#f97316'
    case 'review':
      return '#60a5fa'
    case 'progress':
      return '#4ade80'
    default:
      return 'var(--color-outline)'
  }
}

function titledId(title: string | null | undefined, id: string | null | undefined) {
  if (title && id && title === id) return title
  if (title && id) return `${title} (${id})`
  return title ?? id ?? 'Unknown'
}

function sourceLabel(item: BriefingCard) {
  if (item.context.taskTitle) return `${item.source.type} / ${titledId(item.context.taskTitle, item.context.taskId ?? item.source.id)}`
  if (item.context.projectName) return `${item.source.type} / ${titledId(item.context.projectName, item.context.projectId ?? item.source.id)}`
  if (item.context.documentTitle) return `${item.source.type} / ${titledId(item.context.documentTitle, item.context.documentId ?? item.source.id)}`
  if (item.context.conversationTitle || item.context.conversationId) return `${item.source.type} / ${titledId(item.context.conversationTitle, item.context.conversationId ?? item.source.id)}`
  if (item.context.contactName || item.context.contactId) return `${item.source.type} / ${titledId(item.context.contactName, item.context.contactId ?? item.source.id)}`
  if (item.context.dealTitle || item.context.dealId) return `${item.source.type} / ${titledId(item.context.dealTitle, item.context.dealId ?? item.source.id)}`
  if (item.context.reportTitle || item.context.reportId) return `${item.source.type} / ${titledId(item.context.reportTitle, item.context.reportId ?? item.source.id)}`
  if (item.context.bookingName || item.context.bookingId) return `${item.source.type} / ${titledId(item.context.bookingName, item.context.bookingId ?? item.source.id)}`
  if (item.context.supportTicketSubject || item.context.supportTicketId) return `${item.source.type} / ${titledId(item.context.supportTicketSubject, item.context.supportTicketId ?? item.source.id)}`
  if (item.context.invoiceNumber || item.context.invoiceId) return `${item.source.type} / ${titledId(item.context.invoiceNumber, item.context.invoiceId ?? item.source.id)}`
  if (item.context.quoteNumber || item.context.quoteId) return `${item.source.type} / ${titledId(item.context.quoteNumber, item.context.quoteId ?? item.source.id)}`
  if (item.context.orderTitle || item.context.orderId) return `${item.source.type} / ${titledId(item.context.orderTitle, item.context.orderId ?? item.source.id)}`
  if (item.context.inventoryItemName || item.context.inventoryItemId) return `${item.source.type} / ${titledId(item.context.inventoryItemName, item.context.inventoryItemId ?? item.source.id)}`
  if (item.context.shipmentTrackingNumber || item.context.shipmentId) return `${item.source.type} / ${titledId(item.context.shipmentTrackingNumber, item.context.shipmentId ?? item.source.id)}`
  if (item.context.expenseCategory || item.context.expenseId) return `${item.source.type} / ${titledId(item.context.expenseCategory, item.context.expenseId ?? item.source.id)}`
  if (item.context.seoContentTitle || item.context.seoContentId) return `${item.source.type} / ${titledId(item.context.seoContentTitle, item.context.seoContentId ?? item.source.id)}`
  if (item.context.seoTaskTitle || item.context.seoTaskId) return `${item.source.type} / ${titledId(item.context.seoTaskTitle, item.context.seoTaskId ?? item.source.id)}`
  if (item.context.adCampaignName || item.context.adCampaignId) return `${item.source.type} / ${titledId(item.context.adCampaignName, item.context.adCampaignId ?? item.source.id)}`
  if (item.context.broadcastName || item.context.broadcastId) return `${item.source.type} / ${titledId(item.context.broadcastName, item.context.broadcastId ?? item.source.id)}`
  if (item.context.campaignName || item.context.campaignId) return `${item.source.type} / ${titledId(item.context.campaignName, item.context.campaignId ?? item.source.id)}`
  if (item.context.enquiryName || item.context.enquiryId) return `${item.source.type} / ${titledId(item.context.enquiryName, item.context.enquiryId ?? item.source.id)}`
  if (item.context.formName || item.context.formId || item.context.formSubmissionId) return `${item.source.type} / ${titledId(item.context.formName, item.context.formSubmissionId ?? item.source.id)}`
  if (item.context.socialInboxFrom || item.context.socialInboxId) return `${item.source.type} / ${titledId(item.context.socialInboxFrom, item.context.socialInboxId ?? item.source.id)}`
  if (item.context.mailboxFrom || item.context.mailboxMessageId) return `${item.source.type} / ${titledId(item.context.mailboxFrom, item.context.mailboxMessageId ?? item.source.id)}`
  if (item.context.agentProfile || item.context.agentRunId) return `${item.source.type} / ${titledId(item.context.agentProfile, item.context.agentRunId ?? item.source.id)}`
  if (item.context.workspaceBrokerOperation || item.context.workspaceBrokerJobId) return `${item.source.type} / ${titledId(item.context.workspaceBrokerOperation, item.context.workspaceBrokerJobId ?? item.source.id)}`
  if (item.context.calendarEventTitle || item.context.calendarEventId) return `${item.source.type} / ${titledId(item.context.calendarEventTitle, item.context.calendarEventId ?? item.source.id)}`
  return `${item.source.type} / ${item.source.id}`
}

function sourceHref(item: BriefingCard, mode: Mode) {
  if (item.source.type === 'agent-run') return mode === 'admin' ? adminSourceHref(item) : null
  if (item.source.type === 'workspace-broker-job') return mode === 'admin' ? adminSourceHref(item) : null
  if (item.source.type === 'calendar-event') return item.source.url || (mode === 'admin' ? adminSourceHref(item) : `/portal/calendar/events/${encodeURIComponent(item.source.id)}`)
  if (item.source.type === 'booking') return mode === 'admin' ? adminSourceHref(item) : null
  if (item.source.type === 'form-submission') return mode === 'admin' ? adminSourceHref(item) : null
  if (item.source.type === 'social-inbox') return adminSourceHref(item)
  if (item.source.type === 'mailbox-message') return mode === 'admin' ? adminSourceHref(item) : item.source.url || `/portal/email?message=${encodeURIComponent(item.source.id)}`
  if (item.source.type === 'social-post') return `/portal/social/review/${encodeURIComponent(item.source.id)}`
  if (item.source.type === 'support-ticket') return mode === 'admin' ? `/admin/support?ticket=${encodeURIComponent(item.source.id)}` : '/portal'
  if (item.source.type === 'invoice') return mode === 'admin' ? `/admin/invoicing/${encodeURIComponent(item.source.id)}` : `/portal/payments?invoice=${encodeURIComponent(item.source.id)}`
  if (item.source.type === 'quote') return mode === 'admin' ? `/admin/quotes/${encodeURIComponent(item.source.id)}` : `/portal/payments?quote=${encodeURIComponent(item.source.id)}`
  if (item.source.type === 'order') return item.source.url || (item.context.companyId ? `/portal/companies/${encodeURIComponent(item.context.companyId)}?order=${encodeURIComponent(item.source.id)}` : `/portal/crm?order=${encodeURIComponent(item.source.id)}`)
  if (item.source.type === 'inventory-item') return item.source.url || (item.context.companyId ? `/portal/companies/${encodeURIComponent(item.context.companyId)}?inventory=${encodeURIComponent(item.source.id)}` : `/portal/crm?inventory=${encodeURIComponent(item.source.id)}`)
  if (item.source.type === 'shipment') return item.source.url || (item.context.companyId ? `/portal/companies/${encodeURIComponent(item.context.companyId)}?shipment=${encodeURIComponent(item.source.id)}` : `/portal/crm?shipment=${encodeURIComponent(item.source.id)}`)
  if (item.source.type === 'expense') return mode === 'admin' ? `/admin/finance?expense=${encodeURIComponent(item.source.id)}` : null
  if (item.source.type === 'ad-campaign') return mode === 'admin' ? adminSourceHref(item) : `/portal/ads/campaigns/${encodeURIComponent(item.source.id)}`
  if (item.source.type === 'broadcast') return mode === 'admin' ? adminSourceHref(item) : item.source.url || `/portal/campaigns/broadcast/${encodeURIComponent(item.source.id)}`
  if (item.source.type === 'campaign') return mode === 'admin' ? adminSourceHref(item) : item.source.url || `/portal/campaigns/${encodeURIComponent(item.source.id)}`
  if (item.source.type === 'enquiry') return mode === 'admin' ? adminSourceHref(item) : null
  if (item.source.type === 'seo-content') {
    const sprintId = item.context.seoSprintId
    const contentId = encodeURIComponent(item.source.id)
    if (sprintId) return `${mode === 'admin' ? '/admin' : '/portal'}/seo/sprints/${encodeURIComponent(sprintId)}/content?content=${contentId}`
    return mode === 'admin' ? `/admin/seo?content=${contentId}` : `/portal/seo?content=${contentId}`
  }
  if (item.source.type === 'seo-task') {
    if (mode !== 'admin') return null
    const sprintId = item.context.seoSprintId
    const taskId = encodeURIComponent(item.source.id)
    if (sprintId) return `/admin/seo/sprints/${encodeURIComponent(sprintId)}/tasks?task=${taskId}`
    return `/admin/seo?task=${taskId}`
  }
  if (mode === 'admin') return item.source.url || null
  if (item.source.url?.startsWith('/portal')) return item.source.url
  if (item.context.conversationId) return `/portal/conversations?convId=${encodeURIComponent(item.context.conversationId)}`
  if (item.context.projectId) return `/portal/projects/${item.context.projectId}${item.context.taskId ? `?taskId=${encodeURIComponent(item.context.taskId)}` : ''}`
  if (item.context.documentId) return `/portal/documents/${item.context.documentId}`
  if (item.context.contactId) return `/portal/contacts/${encodeURIComponent(item.context.contactId)}`
  if (item.context.dealId) return `/portal/deals/${encodeURIComponent(item.context.dealId)}`
  if (item.source.type === 'report' && item.source.url) return item.source.url
  return item.source.url || null
}

function adminSourceHref(item: BriefingCard) {
  if (item.source.type === 'workspace-broker-job') return item.source.url || `/admin/knowledge/workspace-broker/jobs/${encodeURIComponent(item.source.id)}`
  if (item.source.type === 'calendar-event') return item.source.url || `/admin/calendar/events/${encodeURIComponent(item.source.id)}`
  if (item.source.type === 'booking') return item.source.url || `/admin/briefings?source=booking&id=${encodeURIComponent(item.source.id)}`
  if (item.source.type === 'agent-run') {
    const agentId = typeof item.metadata?.agentId === 'string' && item.metadata.agentId ? item.metadata.agentId : item.actor.id.replace(/^agent:/, '')
    const runId = typeof item.metadata?.hermesRunId === 'string' && item.metadata.hermesRunId ? item.metadata.hermesRunId : item.context.agentRunId ?? item.source.id
    return `/admin/agents/${encodeURIComponent(agentId)}?run=${encodeURIComponent(runId)}`
  }
  if (item.source.type === 'support-ticket') return `/admin/support?ticket=${encodeURIComponent(item.source.id)}`
  if (item.source.type === 'invoice') return `/admin/invoicing/${encodeURIComponent(item.source.id)}`
  if (item.source.type === 'quote') return `/admin/quotes/${encodeURIComponent(item.source.id)}`
  if (item.source.type === 'order') {
    if (item.context.orgSlug && item.context.companyId) return `/admin/org/${encodeURIComponent(item.context.orgSlug)}/crm/companies/${encodeURIComponent(item.context.companyId)}?order=${encodeURIComponent(item.source.id)}`
    return item.source.url || null
  }
  if (item.source.type === 'inventory-item') {
    if (item.context.orgSlug && item.context.companyId) return `/admin/org/${encodeURIComponent(item.context.orgSlug)}/crm/companies/${encodeURIComponent(item.context.companyId)}?inventory=${encodeURIComponent(item.source.id)}`
    return item.source.url || null
  }
  if (item.source.type === 'shipment') return item.source.url || (item.context.companyId ? `/admin/crm/companies/${encodeURIComponent(item.context.companyId)}?shipment=${encodeURIComponent(item.source.id)}` : null)
  if (item.source.type === 'expense') return `/admin/finance?expense=${encodeURIComponent(item.source.id)}`
  if (item.source.type === 'ad-campaign') {
    if (item.context.orgSlug) return `/admin/org/${encodeURIComponent(item.context.orgSlug)}/ads/campaigns/${encodeURIComponent(item.source.id)}`
    return `/admin/marketing?adCampaign=${encodeURIComponent(item.source.id)}`
  }
  if (item.source.type === 'broadcast') return `/admin/broadcasts/${encodeURIComponent(item.source.id)}`
  if (item.source.type === 'campaign') return `/admin/campaigns/${encodeURIComponent(item.source.id)}`
  if (item.source.type === 'form-submission') {
    const formId = item.context.formId
    if (formId) return `/admin/forms/${encodeURIComponent(formId)}/submissions/${encodeURIComponent(item.source.id)}`
    return item.source.url || null
  }
  if (item.source.type === 'enquiry') return item.source.url || `/admin/briefings?source=enquiry&id=${encodeURIComponent(item.source.id)}`
  if (item.source.type === 'social-inbox') {
    return item.source.url || `/admin/social/inbox?item=${encodeURIComponent(item.source.id)}`
  }
  if (item.source.type === 'mailbox-message') {
    return `/admin/email/mailbox?message=${encodeURIComponent(item.source.id)}`
  }
  if (item.source.type === 'seo-content') {
    const sprintId = item.context.seoSprintId
    const contentId = encodeURIComponent(item.source.id)
    if (sprintId) return `/admin/seo/sprints/${encodeURIComponent(sprintId)}/content?content=${contentId}`
    return `/admin/seo?content=${contentId}`
  }
  if (item.source.type === 'seo-task') {
    const sprintId = item.context.seoSprintId
    const taskId = encodeURIComponent(item.source.id)
    if (sprintId) return `/admin/seo/sprints/${encodeURIComponent(sprintId)}/tasks?task=${taskId}`
    return `/admin/seo?task=${taskId}`
  }
  if (item.context.conversationId) {
    const query = `convId=${encodeURIComponent(item.context.conversationId)}`
    if (item.context.orgSlug) return `/admin/org/${item.context.orgSlug}/messages?${query}`
    return `/admin/communications?${query}`
  }
  if (item.source.type === 'social-post') {
    if (socialActionStage(item) === 'qa') return `/admin/social/qa/${encodeURIComponent(item.source.id)}`
    if (item.context.orgSlug) return `/admin/org/${item.context.orgSlug}/social/${encodeURIComponent(item.source.id)}`
    return `/admin/social?postId=${encodeURIComponent(item.source.id)}`
  }
  if (item.context.contactId) return `/admin/crm/contacts/${encodeURIComponent(item.context.contactId)}`
  if (item.context.dealId) return `/admin/crm/pipeline?dealId=${encodeURIComponent(item.context.dealId)}`
  if (item.source.type === 'report' && item.source.url) return item.source.url
  return item.source.url || null
}

function canTaskAct(item: BriefingCard) {
  return Boolean(item.context.projectId && item.context.taskId)
}

function canTaskUnblock(item: BriefingCard) {
  if (!canTaskAct(item)) return false
  const columnId = typeof item.metadata?.columnId === 'string' ? item.metadata.columnId : null
  const agentStatus = typeof item.metadata?.agentStatus === 'string' ? item.metadata.agentStatus : null
  if (columnId || agentStatus) {
    return columnId === 'blocked' || agentStatus === 'blocked' || agentStatus === 'awaiting-input'
  }
  return item.source.type === 'task' && ['critical', 'needs-peet'].includes(item.priority) && /\b(blocked|awaiting[- ]input)\b/i.test(`${item.title} ${item.summary}`)
}

function canDocumentAct(item: BriefingCard) {
  return Boolean(item.context.documentId)
}

function canDocumentCommentReplyAct(item: BriefingCard) {
  return item.source.type === 'comment' && Boolean(item.context.documentId && item.source.id)
}

function canDocumentCommentResolveAct(item: BriefingCard) {
  return canDocumentCommentReplyAct(item)
}

function canConversationAct(item: BriefingCard) {
  return Boolean(item.context.conversationId)
}

function canSocialPostAct(item: BriefingCard) {
  return item.source.type === 'social-post' && Boolean(item.source.id)
}

function canSocialInboxAct(item: BriefingCard) {
  return item.source.type === 'social-inbox' && Boolean(item.source.id)
}

function canMailboxAct(item: BriefingCard) {
  return item.source.type === 'mailbox-message' && Boolean(item.source.id)
}

function canAgentRunApprove(item: BriefingCard, mode: Mode) {
  return mode === 'admin' && item.source.type === 'agent-run' && item.metadata?.runStatus === 'waiting_for_approval' && Boolean(item.metadata?.agentId && item.metadata?.hermesRunId)
}

function canWorkspaceBrokerAct(item: BriefingCard, mode: Mode) {
  return mode === 'admin' && item.source.type === 'workspace-broker-job' && item.metadata?.brokerStatus === 'awaiting_approval' && Boolean(item.source.id)
}

function canCalendarRsvpAct(item: BriefingCard) {
  return item.source.type === 'calendar-event' && item.metadata?.rsvpStatus === 'pending' && Boolean(item.source.id && calendarRsvpEmail(item))
}

function calendarRsvpEmail(item: BriefingCard): string | null {
  const email = item.metadata?.attendeeEmail
  return typeof email === 'string' && email.includes('@') ? email : null
}

function mailboxApiBase(mode: Mode) {
  return mode === 'admin' ? '/api/v1/admin/mailbox/messages' : '/api/v1/portal/email/messages'
}

function mailboxReplyTo(item: BriefingCard): string[] {
  const fromEmail = item.metadata?.fromEmail
  if (typeof fromEmail === 'string' && fromEmail.includes('@')) return [fromEmail]
  const actorEmail = item.actor.id.startsWith('email:') ? item.actor.id.slice('email:'.length) : ''
  return actorEmail.includes('@') ? [actorEmail] : []
}

function mailboxReplySubject(item: BriefingCard): string {
  const subject = typeof item.metadata?.subject === 'string' && item.metadata.subject.trim()
    ? item.metadata.subject.trim()
    : item.context.mailboxSubject || 'Email reply'
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`
}

function canNotificationAct(item: BriefingCard) {
  return item.source.type === 'notification' && Boolean(item.source.id)
}

function canActivityFollowUpAct(item: BriefingCard) {
  return (item.source.type === 'activity' || item.source.type === 'contact') && Boolean(item.context.contactId || item.metadata?.contactId)
}

function canContactFollowUpComplete(item: BriefingCard) {
  return item.source.type === 'contact' && Boolean(item.context.contactId || item.source.id)
}

function canReportAct(item: BriefingCard) {
  return item.source.type === 'report' && Boolean(item.context.reportId || item.source.id)
}

function canSupportTicketAct(item: BriefingCard) {
  return item.source.type === 'support-ticket' && Boolean(item.source.id)
}

function canInvoiceAct(item: BriefingCard) {
  return item.source.type === 'invoice' && Boolean(item.source.id)
}

function invoiceSendable(item: BriefingCard) {
  return canInvoiceAct(item) && item.metadata?.invoiceStatus === 'draft'
}

function invoicePaymentProofReviewable(item: BriefingCard, mode: Mode) {
  return mode === 'admin' && canInvoiceAct(item) && item.metadata?.invoiceStatus === 'payment_pending_verification'
}

function canQuoteAct(item: BriefingCard) {
  return item.source.type === 'quote' && Boolean(item.source.id)
}

function quoteDecisionable(item: BriefingCard) {
  return canQuoteAct(item) && item.metadata?.quoteStatus === 'sent'
}

function quoteConvertible(item: BriefingCard, mode: Mode) {
  return mode === 'admin' && canQuoteAct(item) && item.metadata?.quoteStatus === 'accepted' && !item.metadata?.convertedInvoiceId
}

function canShipmentAct(item: BriefingCard) {
  return item.source.type === 'shipment' && Boolean(item.source.id)
}

function canOrderAct(item: BriefingCard) {
  return item.source.type === 'order' && Boolean(item.source.id)
}

function orderActive(item: BriefingCard) {
  return canOrderAct(item) && item.metadata?.orderStatus !== 'fulfilled' && item.metadata?.orderStatus !== 'cancelled' && item.metadata?.orderStatus !== 'archived'
}

function canInventoryAct(item: BriefingCard) {
  return item.source.type === 'inventory-item' && Boolean(item.source.id)
}

function inventoryActive(item: BriefingCard) {
  return canInventoryAct(item) && item.metadata?.inventoryStatus !== 'archived'
}

function shipmentActive(item: BriefingCard) {
  return canShipmentAct(item) && item.metadata?.shipmentStatus !== 'delivered' && item.metadata?.shipmentStatus !== 'cancelled'
}

function expenseReviewable(item: BriefingCard, mode: Mode) {
  return mode === 'admin' && item.source.type === 'expense' && item.metadata?.expenseStatus === 'submitted' && Boolean(item.source.id)
}

function canSeoContentAct(item: BriefingCard) {
  return item.source.type === 'seo-content' && Boolean(item.source.id)
}

function seoContentReviewable(item: BriefingCard) {
  return canSeoContentAct(item) && item.metadata?.seoStatus === 'review'
}

function canSeoTaskAct(item: BriefingCard, mode: Mode) {
  return mode === 'admin' && item.source.type === 'seo-task' && Boolean(item.source.id)
}

function seoTaskSkippable(item: BriefingCard, mode: Mode) {
  return canSeoTaskAct(item, mode) && item.metadata?.seoTaskStatus !== 'skipped' && item.metadata?.seoTaskStatus !== 'done'
}

function canAdCampaignAct(item: BriefingCard) {
  return item.source.type === 'ad-campaign' && Boolean(item.source.id)
}

function adCampaignReviewable(item: BriefingCard) {
  return canAdCampaignAct(item) && item.metadata?.reviewState === 'awaiting'
}

function canBroadcastAct(item: BriefingCard) {
  return item.source.type === 'broadcast' && Boolean(item.source.id)
}

function broadcastStatus(item: BriefingCard) {
  return typeof item.metadata?.broadcastStatus === 'string' ? item.metadata.broadcastStatus : null
}

function broadcastSendable(item: BriefingCard) {
  return canBroadcastAct(item) && ['draft', 'paused', 'scheduled'].includes(broadcastStatus(item) ?? '')
}

function broadcastPausable(item: BriefingCard) {
  return canBroadcastAct(item) && broadcastStatus(item) === 'scheduled'
}

function broadcastResumable(item: BriefingCard) {
  return canBroadcastAct(item) && broadcastStatus(item) === 'paused'
}

function canCampaignAct(item: BriefingCard) {
  return item.source.type === 'campaign' && Boolean(item.source.id)
}

function campaignStatus(item: BriefingCard) {
  return typeof item.metadata?.campaignStatus === 'string' ? item.metadata.campaignStatus : null
}

function campaignLaunchable(item: BriefingCard) {
  return canCampaignAct(item) && ['draft', 'scheduled', 'paused'].includes(campaignStatus(item) ?? '')
}

function campaignArchivable(item: BriefingCard) {
  return canCampaignAct(item) && campaignStatus(item) !== 'completed'
}

function enquiryActionable(item: BriefingCard, mode: Mode) {
  return mode === 'admin' && item.source.type === 'enquiry' && Boolean(item.source.id) && item.metadata?.enquiryStatus !== 'closed'
}

function formSubmissionActionable(item: BriefingCard, mode: Mode) {
  return mode === 'admin' && item.source.type === 'form-submission' && Boolean(item.context.formId && item.source.id)
}

function bookingActionable(item: BriefingCard, mode: Mode) {
  return mode === 'admin' && item.source.type === 'booking' && Boolean(item.source.id) && item.metadata?.bookingStatus !== 'completed' && item.metadata?.bookingStatus !== 'cancelled'
}

function socialActionStage(item: BriefingCard): 'client' | 'qa' | null {
  const stage = item.metadata?.actionStage
  if (stage === 'client' || stage === 'qa') return stage
  const status = item.metadata?.status
  if (status === 'client_review' || status === 'pending_approval') return 'client'
  if (status === 'qa_review') return 'qa'
  return null
}

function reviewable(item: BriefingCard) {
  return canTaskAct(item) && (item.priority === 'review' || item.source.type === 'agent-output')
}

function approvalGateReviewable(item: BriefingCard) {
  const status = item.metadata?.approvalStatus
  return canTaskAct(item) && item.source.type === 'approval' && (status === undefined || status === null || status === 'pending')
}

function documentReviewable(item: BriefingCard) {
  return canDocumentAct(item) && (item.source.type === 'client-document' || item.source.type === 'approval') && ['needs-peet', 'review'].includes(item.priority)
}

function defaultSnoozeDate() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
}

type PulseRow = {
  id: string
  name: string
  total: number
  action: number
  blocked: number
  review: number
  agents: number
  documents: number
  latestAt: number
}

const WORKSPACE_OPERATIONS_KEY = 'workspace-operations'

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function slugKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function pulseRow(id: string, name: string): PulseRow {
  return {
    id,
    name,
    total: 0,
    action: 0,
    blocked: 0,
    review: 0,
    agents: 0,
    documents: 0,
    latestAt: 0,
  }
}

function addPulseItem(row: PulseRow, item: BriefingCard) {
  row.total += 1
  if (item.requiresAction) row.action += 1
  if (item.priority === 'critical') row.blocked += 1
  if (item.priority === 'review' || item.priority === 'needs-peet') row.review += 1
  if (item.actor.type === 'agent' || item.source.type === 'agent-output') row.agents += 1
  if (item.source.type === 'client-document' || item.source.type === 'approval') row.documents += 1
  row.latestAt = Math.max(row.latestAt, new Date(item.occurredAt).getTime())
}

function accountPulseIdentity(item: BriefingCard): { id: string; name: string } {
  const companyName = cleanText(item.context.companyName) || cleanText(item.metadata?.company) || cleanText(item.metadata?.recipientCompanyName)
  const companyId = cleanText(item.context.companyId)
  if (companyName) return { id: `company-name:${slugKey(companyName)}`, name: companyName }
  if (companyId) return { id: `company-id:${companyId}`, name: `Company ${companyId}` }
  return { id: WORKSPACE_OPERATIONS_KEY, name: 'Workspace operations' }
}

export function BriefingControlDesk({ mode }: { mode: Mode }) {
  const [orgs, setOrgs] = useState<OrgSummary[]>([])
  const [orgId, setOrgId] = useState('')
  const [accountPulseId, setAccountPulseId] = useState('')
  const [priority, setPriority] = useState('all')
  const [sourceType, setSourceType] = useState('all')
  const [feed, setFeed] = useState<BriefingFeed | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [snapshotting, setSnapshotting] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [replyText, setReplyText] = useState('')
  const [socialChangeText, setSocialChangeText] = useState('')
  const [followUpText, setFollowUpText] = useState('')
  const [mailboxReplyText, setMailboxReplyText] = useState('')
  const [reportRecipients, setReportRecipients] = useState('')
  const [expenseReviewText, setExpenseReviewText] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('eft')
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentProofRejectReason, setPaymentProofRejectReason] = useState('')
  const [seoChangeText, setSeoChangeText] = useState('')
  const [seoTaskSkipReason, setSeoTaskSkipReason] = useState('')
  const [adCampaignChangeText, setAdCampaignChangeText] = useState('')
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [flash, setFlash] = useState<Flash>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (mode === 'portal') {
          const res = await fetch('/api/v1/portal/org')
          const body = await res.json()
          if (!res.ok) throw new Error(body.error || 'Workspace lookup failed')
          const org = body.org
          if (cancelled) return
          if (org?.id) {
            setOrgId(org.id)
            setOrgs([{ id: org.id, name: org.name || 'Current workspace', slug: org.slug }])
          } else {
            setOrgs([])
          }
          return
        }

        const res = await fetch('/api/v1/organizations')
        const body = await res.json()
        const rows = (body.data ?? body.organizations ?? body.orgs ?? []) as OrgSummary[]
        if (cancelled) return
        setOrgs(rows)
      } catch {
        if (cancelled) return
        setOrgs([])
        if (mode === 'portal') setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [mode])

  useEffect(() => {
    setAccountPulseId('')
  }, [mode, orgId])

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (orgId) params.set('orgId', orgId)
    if (priority !== 'all') params.set('priority', priority)
    if (sourceType !== 'all') params.set('sourceType', sourceType)
    params.set('limit', '80')
    return params.toString()
  }, [orgId, priority, sourceType])

  const loadFeed = useCallback(async ({ quiet = false }: { quiet?: boolean } = {}) => {
    if (mode === 'portal' && !orgId) return
    if (!quiet) setLoading(true)
    try {
      const res = await fetch(`/api/v1/briefings/feed?${query}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Briefing feed failed')
      const data = (body.data ?? body) as BriefingFeed
      setFeed(data)
      setSelectedId((current) => current && data.items.some((item) => item.id === current) ? current : data.items[0]?.id ?? null)
      setFlash(null)
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Briefing feed failed' })
      if (!quiet) setFeed({ items: [], total: 0, hasMore: false, generatedAt: new Date().toISOString() })
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [mode, orgId, query])

  useEffect(() => {
    if (mode === 'portal' && !orgId) return
    loadFeed()
  }, [loadFeed, mode, orgId])

  useEffect(() => {
    if (!autoRefresh) return
    if (mode === 'portal' && !orgId) return
    const timer = window.setInterval(() => loadFeed({ quiet: true }), 30_000)
    return () => window.clearInterval(timer)
  }, [autoRefresh, loadFeed, mode, orgId])

  const allItems = useMemo(() => feed?.items ?? [], [feed?.items])
  const items = useMemo(() => {
    if (mode !== 'portal' || !accountPulseId) return allItems
    return allItems.filter((item) => accountPulseIdentity(item).id === accountPulseId)
  }, [accountPulseId, allItems, mode])
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null

  const counts = useMemo(() => {
    const result: Record<string, number> = {}
    for (const item of items) result[item.priority] = (result[item.priority] ?? 0) + 1
    return result
  }, [items])

  const topStats = useMemo(() => ({
    action: items.filter((item) => item.requiresAction).length,
    blocked: counts.critical ?? 0,
    review: counts.review ?? 0,
    agents: items.filter((item) => item.actor.type === 'agent' || item.source.type === 'agent-output').length,
  }), [counts, items])

  const workspacePulse = useMemo(() => {
    const byOrg = new Map<string, PulseRow>()

    for (const org of orgs) {
      byOrg.set(org.id, pulseRow(org.id, org.name))
    }

    for (const item of allItems) {
      const id = item.orgId || item.context.orgId || 'unknown'
      const current = byOrg.get(id) ?? pulseRow(id, item.context.orgName || id)
      current.name = item.context.orgName || current.name
      addPulseItem(current, item)
      byOrg.set(id, current)
    }

    return [...byOrg.values()]
      .filter((row) => row.total > 0 || !orgId)
      .sort((a, b) => b.action - a.action || b.blocked - a.blocked || b.latestAt - a.latestAt || a.name.localeCompare(b.name))
      .slice(0, 8)
  }, [allItems, orgId, orgs])

  const accountPulse = useMemo(() => {
    const byAccount = new Map<string, PulseRow>()
    for (const item of allItems) {
      const identity = accountPulseIdentity(item)
      const current = byAccount.get(identity.id) ?? pulseRow(identity.id, identity.name)
      addPulseItem(current, item)
      byAccount.set(identity.id, current)
    }
    return [...byAccount.values()]
      .sort((a, b) => b.action - a.action || b.blocked - a.blocked || b.latestAt - a.latestAt || a.name.localeCompare(b.name))
      .slice(0, 8)
  }, [allItems])

  function selectAccountPulse(id: string) {
    setAccountPulseId(id)
    const next = allItems.find((item) => accountPulseIdentity(item).id === id)
    setSelectedId(next?.id ?? null)
  }

  const pulseRows = mode === 'portal' ? accountPulse : workspacePulse
  const pulseSelectionId = mode === 'portal' ? accountPulseId : orgId
  const activeWorkspaceName = orgs[0]?.name ?? 'Current workspace'

  function clearPulseSelection() {
    if (mode === 'portal') {
      setAccountPulseId('')
      return
    }
    setOrgId('')
  }

  function selectPulseRow(row: PulseRow) {
    if (mode === 'portal') {
      selectAccountPulse(row.id)
      return
    }
    setOrgId(row.id)
  }

  async function createSnapshot() {
    setSnapshotting(true)
    try {
      const res = await fetch('/api/v1/briefings/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId: orgId || undefined, priority, sourceType, limit: 100, title: 'Control desk snapshot' }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Snapshot failed')
      setFlash({ kind: 'ok', message: `Snapshot saved: ${body.data?.snapshot?.id ?? 'created'}` })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Snapshot failed' })
    } finally {
      setSnapshotting(false)
    }
  }

  async function setItemState(item: BriefingCard, action: 'handled' | 'snoozed' | 'active') {
    setBusyAction(action)
    try {
      const res = await fetch(`/api/v1/briefings/items/${encodeURIComponent(item.id)}/state`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, snoozedUntil: action === 'snoozed' ? defaultSnoozeDate() : undefined }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'State update failed')
      setFeed((current) => current ? { ...current, items: current.items.filter((row) => row.id !== item.id), total: Math.max(0, current.total - 1) } : current)
      setFlash({ kind: 'ok', message: action === 'snoozed' ? 'Snoozed for 24 hours.' : action === 'handled' ? 'Marked handled.' : 'Returned to active.' })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'State update failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function replyToTask(item: BriefingCard) {
    if (!canTaskAct(item) || !replyText.trim()) return
    setBusyAction('reply')
    try {
      const res = await fetch(`/api/v1/projects/${item.context.projectId}/tasks/${item.context.taskId}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: replyText.trim() }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Reply failed')
      setReplyText('')
      setFlash({ kind: 'ok', message: 'Reply posted to the source task.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Reply failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function replyToDocument(item: BriefingCard, text: string) {
    if (!canDocumentAct(item) || !text.trim()) return
    setBusyAction('document-reply')
    try {
      const res = await fetch(`/api/v1/client-documents/${item.context.documentId}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: text.trim() }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Document reply failed')
      setReplyText('')
      setFlash({ kind: 'ok', message: 'Reply posted to the source document.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Document reply failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function replyToDocumentComment(item: BriefingCard, text: string) {
    if (!canDocumentCommentReplyAct(item) || !text.trim()) return
    setBusyAction('document-comment-reply')
    try {
      const res = await fetch(`/api/v1/client-documents/${item.context.documentId}/comments/${encodeURIComponent(item.source.id)}/replies`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: text.trim() }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Document comment reply failed')
      setReplyText('')
      setFlash({ kind: 'ok', message: 'Reply posted to the source document comment.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Document comment reply failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function resolveDocumentComment(item: BriefingCard) {
    if (!canDocumentCommentResolveAct(item)) return
    setBusyAction('document-comment-resolve')
    try {
      const res = await fetch(`/api/v1/client-documents/${item.context.documentId}/comments/${encodeURIComponent(item.source.id)}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resolved: true }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Document comment resolve failed')
      setFlash({ kind: 'ok', message: 'Document comment resolved from the control desk.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Document comment resolve failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function replyToConversation(item: BriefingCard, text: string) {
    if (!canConversationAct(item) || !text.trim()) return
    setBusyAction('conversation-reply')
    try {
      const res = await fetch(`/api/v1/conversations/${item.context.conversationId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: text.trim() }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Conversation reply failed')
      setReplyText('')
      setFlash({ kind: 'ok', message: 'Reply posted to the source conversation.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Conversation reply failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function approveDocument(item: BriefingCard) {
    if (!canDocumentAct(item)) return
    setBusyAction('document-approve')
    try {
      const res = await fetch(`/api/v1/client-documents/${item.context.documentId}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actorName: 'Briefings control desk' }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Document approval failed')
      setFlash({ kind: 'ok', message: 'Document approved from the control desk.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Document approval failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function requestDocumentChanges(item: BriefingCard) {
    const text = replyText.trim() || `Changes requested from the Briefings control desk for ${item.context.documentTitle ?? 'this document'}.`
    await replyToDocument(item, text)
  }

  async function replyToSelected(item: BriefingCard) {
    if (canDocumentCommentReplyAct(item)) {
      await replyToDocumentComment(item, replyText)
      return
    }
    if (canTaskAct(item)) {
      await replyToTask(item)
      return
    }
    if (canDocumentAct(item)) {
      await replyToDocument(item, replyText)
      return
    }
    if (canConversationAct(item)) {
      await replyToConversation(item, replyText)
    }
  }

  async function taskPatch(item: BriefingCard, body: Record<string, unknown>, success: string) {
    if (!canTaskAct(item)) return
    setBusyAction(success)
    try {
      const res = await fetch(`/api/v1/projects/${item.context.projectId}/tasks/${item.context.taskId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const responseBody = await res.json()
      if (!res.ok) throw new Error(responseBody.error || success)
      setFlash({ kind: 'ok', message: success })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Task update failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function socialPostAction(item: BriefingCard, action: 'approve' | 'reject') {
    if (!canSocialPostAct(item)) return
    const stage = socialActionStage(item)
    if (!stage) return
    const reason = socialChangeText.trim()
    if (action === 'reject' && !reason) return

    setBusyAction(`social-${action}`)
    try {
      const routeAction = stage === 'qa'
        ? action === 'approve' ? 'qa-approve' : 'qa-reject'
        : action === 'approve' ? 'client-approve' : 'client-reject'
      const res = await fetch(`/api/v1/social/posts/${encodeURIComponent(item.source.id)}/${routeAction}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: action === 'reject' ? JSON.stringify({ reason }) : undefined,
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Social post action failed')
      setSocialChangeText('')
      setFlash({ kind: 'ok', message: action === 'approve' ? 'Social post approved from the control desk.' : 'Social changes sent back to the agent.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Social post action failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function socialInboxAction(item: BriefingCard, status: 'read' | 'replied' | 'archived') {
    if (!canSocialInboxAct(item)) return
    setBusyAction(`social-inbox-${status}`)
    try {
      const res = await fetch(`/api/v1/social/inbox/${encodeURIComponent(item.source.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Social inbox update failed')
      const message = status === 'read'
        ? 'Social engagement marked read.'
        : status === 'replied'
          ? 'Social engagement marked replied.'
          : 'Social engagement archived.'
      setFlash({ kind: 'ok', message })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Social inbox update failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function mailboxPatch(item: BriefingCard, body: Record<string, unknown>, success: string) {
    if (!canMailboxAct(item)) return
    setBusyAction(success)
    try {
      const res = await fetch(`${mailboxApiBase(mode)}/${encodeURIComponent(item.source.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const responseBody = await res.json()
      if (!res.ok) throw new Error(responseBody.error || 'Mailbox update failed')
      setFlash({ kind: 'ok', message: success })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Mailbox update failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function draftMailboxReply(item: BriefingCard) {
    if (!canMailboxAct(item)) return
    const text = mailboxReplyText.trim()
    const accountId = typeof item.metadata?.accountId === 'string' ? item.metadata.accountId : ''
    const to = mailboxReplyTo(item)
    if (!text || !accountId || to.length === 0) return
    setBusyAction('mailbox-reply-draft')
    try {
      const res = await fetch(mailboxApiBase(mode), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'draft',
          accountId,
          to,
          subject: mailboxReplySubject(item),
          bodyText: text,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Mailbox reply draft failed')
      setMailboxReplyText('')
      setFlash({ kind: 'ok', message: 'Email reply draft created from the control desk.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Mailbox reply draft failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function agentRunApprovalAction(item: BriefingCard, choice: 'once' | 'deny') {
    if (!canAgentRunApprove(item, mode)) return
    const agentId = String(item.metadata?.agentId)
    const runId = String(item.metadata?.hermesRunId)
    setBusyAction(`agent-run-${choice}`)
    try {
      const res = await fetch(`/api/v1/admin/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/approval`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ choice }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Agent run approval failed')
      setFlash({ kind: 'ok', message: choice === 'once' ? 'Agent run approved once.' : 'Agent run denied.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Agent run approval failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function workspaceBrokerAction(item: BriefingCard, action: 'approve' | 'reject') {
    if (!canWorkspaceBrokerAct(item, mode)) return
    setBusyAction(`workspace-broker-${action}`)
    try {
      const res = await fetch(`/api/v1/workspace-broker/jobs/${encodeURIComponent(item.source.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Workspace broker job update failed')
      setFlash({ kind: 'ok', message: action === 'approve' ? 'Workspace job approved.' : 'Workspace job rejected.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Workspace broker job update failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function calendarRsvpAction(item: BriefingCard, status: 'accepted' | 'declined') {
    const email = calendarRsvpEmail(item)
    if (!canCalendarRsvpAct(item) || !email) return
    setBusyAction(`calendar-rsvp-${status}`)
    try {
      const res = await fetch(`/api/v1/calendar/events/${encodeURIComponent(item.source.id)}/rsvp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, status }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Calendar RSVP failed')
      setFlash({ kind: 'ok', message: status === 'accepted' ? 'Meeting accepted.' : 'Meeting declined.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Calendar RSVP failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function bookingAction(item: BriefingCard, status: 'completed' | 'cancelled') {
    if (!bookingActionable(item, mode)) return
    setBusyAction(`booking-${status}`)
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(item.source.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Booking update failed')
      setFlash({ kind: 'ok', message: status === 'completed' ? 'Booking marked completed.' : 'Booking cancelled.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Booking update failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function notificationAction(item: BriefingCard, status: 'read' | 'archived') {
    if (!canNotificationAct(item)) return
    setBusyAction(`notification-${status}`)
    try {
      const res = await fetch(`/api/v1/notifications/${encodeURIComponent(item.source.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Notification update failed')
      setFlash({ kind: 'ok', message: status === 'read' ? 'Notification marked read.' : 'Notification archived.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Notification update failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function logActivityFollowUp(item: BriefingCard) {
    const contactId = typeof item.context.contactId === 'string'
      ? item.context.contactId
      : typeof item.metadata?.contactId === 'string' ? item.metadata.contactId : ''
    const dealId = typeof item.context.dealId === 'string'
      ? item.context.dealId
      : typeof item.metadata?.dealId === 'string' ? item.metadata.dealId : ''
    const summary = followUpText.trim()
    if (!contactId || !summary) return

    setBusyAction('activity-follow-up')
    try {
      const res = await fetch('/api/v1/crm/activities', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contactId,
          dealId,
          type: 'note',
          summary,
          metadata: {
            sourceBriefingId: item.id,
            ...(item.source.type === 'contact'
              ? { sourceContactId: contactId }
              : { sourceActivityId: item.source.id }),
            source: 'briefings-control-desk',
          },
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Follow-up note failed')
      setFollowUpText('')
      setFlash({ kind: 'ok', message: 'Follow-up note logged to the CRM contact.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Follow-up note failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function completeContactFollowUp(item: BriefingCard) {
    const contactId = typeof item.context.contactId === 'string' && item.context.contactId
      ? item.context.contactId
      : item.source.id
    const summary = followUpText.trim()
    if (!contactId || !summary) return

    setBusyAction('contact-follow-up')
    try {
      const activityRes = await fetch('/api/v1/crm/activities', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contactId,
          dealId: typeof item.context.dealId === 'string' ? item.context.dealId : '',
          type: 'note',
          summary,
          metadata: {
            sourceBriefingId: item.id,
            sourceContactId: contactId,
            source: 'briefings-control-desk',
          },
        }),
      })
      const activityBody = await activityRes.json().catch(() => ({}))
      if (!activityRes.ok) throw new Error(activityBody.error || 'Follow-up note failed')

      const lastContactedAt = new Date().toISOString()
      const contactRes = await fetch(`/api/v1/crm/contacts/${encodeURIComponent(contactId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lastContactedAt }),
      })
      const contactBody = await contactRes.json().catch(() => ({}))
      if (!contactRes.ok) throw new Error(contactBody.error || 'Contact update failed')

      setFollowUpText('')
      setFlash({ kind: 'ok', message: 'Contact follow-up logged and cleared.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Contact follow-up failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function sendReport(item: BriefingCard) {
    if (!canReportAct(item)) return
    const reportId = item.context.reportId || item.source.id
    const recipients = reportRecipients
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    if (!reportId || recipients.length === 0) return

    setBusyAction('report-send')
    try {
      const res = await fetch(`/api/v1/reports/${encodeURIComponent(reportId)}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: recipients }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Report send failed')
      setReportRecipients('')
      setFlash({ kind: 'ok', message: `Report sent to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}.` })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Report send failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function replyToSupportTicket(item: BriefingCard, text: string) {
    if (!canSupportTicketAct(item) || !text.trim()) return
    setBusyAction('support-reply')
    try {
      const scope = mode === 'admin' ? 'admin' : 'portal'
      const res = await fetch(`/api/v1/${scope}/support/${encodeURIComponent(item.source.id)}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: text.trim() }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Support reply failed')
      setReplyText('')
      setFlash({ kind: 'ok', message: 'Reply posted to the support ticket.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Support reply failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function sendInvoice(item: BriefingCard) {
    if (!invoiceSendable(item)) return
    setBusyAction('invoice-send')
    try {
      const res = await fetch(`/api/v1/invoices/${encodeURIComponent(item.source.id)}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Invoice send failed')
      setFlash({ kind: 'ok', message: 'Invoice sent from the control desk.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Invoice send failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function paymentProofAction(item: BriefingCard, action: 'confirm' | 'reject') {
    if (!invoicePaymentProofReviewable(item, mode)) return
    const reference = paymentReference.trim()
    const reason = paymentProofRejectReason.trim()
    if (action === 'reject' && !reason) return
    setBusyAction(`invoice-proof-${action}`)
    try {
      const payload = action === 'confirm'
        ? { confirmed: true, paymentMethod, ...(reference ? { reference } : {}) }
        : { confirmed: false, reason }
      const res = await fetch(`/api/v1/invoices/${encodeURIComponent(item.source.id)}/confirm-payment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Payment proof review failed')
      if (action === 'confirm') setPaymentReference('')
      if (action === 'reject') setPaymentProofRejectReason('')
      setFlash({ kind: 'ok', message: action === 'confirm' ? 'Payment proof confirmed from the control desk.' : 'Payment proof rejected from the control desk.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Payment proof review failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function quoteAction(item: BriefingCard, action: 'accept' | 'decline' | 'convert') {
    if (!canQuoteAct(item)) return
    setBusyAction(`quote-${action}`)
    try {
      const body = action === 'convert'
        ? { action: 'convert-to-invoice' }
        : { status: action === 'accept' ? 'accepted' : 'declined' }
      const res = await fetch(`/api/v1/quotes/${encodeURIComponent(item.source.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const responseBody = await res.json()
      if (!res.ok) throw new Error(responseBody.error || 'Quote update failed')
      setFlash({
        kind: 'ok',
        message: action === 'accept'
          ? 'Quote accepted from the control desk.'
          : action === 'decline'
            ? 'Quote declined from the control desk.'
            : 'Quote converted to invoice.',
      })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Quote update failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function shipmentAction(item: BriefingCard, status: 'ready' | 'in_transit' | 'delivered' | 'failed') {
    if (!canShipmentAct(item)) return
    setBusyAction(`shipment-${status}`)
    try {
      const res = await fetch(`/api/v1/shipments?id=${encodeURIComponent(item.source.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Shipment update failed')
      setFlash({ kind: 'ok', message: status === 'delivered' ? 'Shipment marked delivered.' : status === 'failed' ? 'Shipment marked failed.' : 'Shipment status updated.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Shipment update failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function orderAction(item: BriefingCard, action: 'in_progress' | 'fulfilled' | 'cancelled') {
    if (!canOrderAct(item)) return
    setBusyAction(`order-${action}`)
    try {
      const payload = action === 'in_progress'
        ? { status: 'in_progress', fulfillmentStatus: 'picking' }
        : action === 'fulfilled'
          ? { status: 'fulfilled', fulfillmentStatus: 'delivered' }
          : { status: 'cancelled' }
      const res = await fetch(`/api/v1/orders?id=${encodeURIComponent(item.source.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Order update failed')
      setFlash({
        kind: 'ok',
        message: action === 'in_progress'
          ? 'Order marked in progress.'
          : action === 'fulfilled'
            ? 'Order marked fulfilled.'
            : 'Order cancelled.',
      })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Order update failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function inventoryAction(item: BriefingCard, status: 'active' | 'archived') {
    if (!canInventoryAct(item)) return
    setBusyAction(`inventory-${status}`)
    try {
      const res = await fetch(`/api/v1/inventory-items?id=${encodeURIComponent(item.source.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Inventory update failed')
      setFlash({ kind: 'ok', message: status === 'active' ? 'Inventory marked restocked.' : 'Inventory item archived.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Inventory update failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function expenseAction(item: BriefingCard, action: 'approve' | 'reject') {
    if (!expenseReviewable(item, mode)) return
    const note = expenseReviewText.trim()
    if (action === 'reject' && !note) return
    setBusyAction(`expense-${action}`)
    try {
      const res = await fetch(`/api/v1/expenses/${encodeURIComponent(item.source.id)}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action === 'approve' ? { action } : { action, note }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Expense review failed')
      if (action === 'reject') setExpenseReviewText('')
      setFlash({ kind: 'ok', message: action === 'approve' ? 'Expense approved from the control desk.' : 'Expense rejected from the control desk.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Expense review failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function seoContentAction(item: BriefingCard, action: 'approve' | 'changes') {
    if (!seoContentReviewable(item)) return
    const text = seoChangeText.trim()
    if (action === 'changes' && !text) return
    setBusyAction(`seo-${action}`)
    try {
      const res = action === 'approve'
        ? await fetch(`/api/v1/seo/content/${encodeURIComponent(item.source.id)}/client-approve`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        })
        : await fetch(`/api/v1/seo/content/${encodeURIComponent(item.source.id)}/comments`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text }),
        })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'SEO content action failed')
      if (action === 'changes') setSeoChangeText('')
      setFlash({ kind: 'ok', message: action === 'approve' ? 'SEO content approved from the control desk.' : 'SEO content changes requested.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'SEO content action failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function seoTaskAction(item: BriefingCard, action: 'execute' | 'complete' | 'skip') {
    if (!seoTaskSkippable(item, mode)) return
    const reason = seoTaskSkipReason.trim()
    if (action === 'skip' && !reason) return
    setBusyAction(`seo-task-${action}`)
    try {
      const res = await fetch(`/api/v1/seo/tasks/${encodeURIComponent(item.source.id)}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: action === 'skip' ? JSON.stringify({ reason }) : undefined,
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'SEO task action failed')
      if (action === 'skip') setSeoTaskSkipReason('')
      const message = action === 'execute'
        ? 'SEO task execution started from the control desk.'
        : action === 'complete'
          ? 'SEO task completed from the control desk.'
          : 'SEO task skipped from the control desk.'
      setFlash({ kind: 'ok', message })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'SEO task action failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function adCampaignAction(item: BriefingCard, action: 'approve' | 'reject') {
    if (!adCampaignReviewable(item)) return
    const reason = adCampaignChangeText.trim()
    if (action === 'reject' && !reason) return
    setBusyAction(`ad-campaign-${action}`)
    try {
      const res = await fetch(`/api/v1/portal/ads/campaigns/${encodeURIComponent(item.source.id)}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: action === 'reject' ? JSON.stringify({ reason }) : undefined,
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Ad campaign action failed')
      if (action === 'reject') setAdCampaignChangeText('')
      setFlash({ kind: 'ok', message: action === 'approve' ? 'Ad campaign approved from the control desk.' : 'Ad campaign changes requested.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Ad campaign action failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function broadcastAction(item: BriefingCard, action: 'send-now' | 'pause' | 'resume') {
    if (!canBroadcastAct(item)) return
    if (action === 'send-now' && !broadcastSendable(item)) return
    if (action === 'pause' && !broadcastPausable(item)) return
    if (action === 'resume' && !broadcastResumable(item)) return
    setBusyAction(`broadcast-${action}`)
    try {
      const res = await fetch(`/api/v1/broadcasts/${encodeURIComponent(item.source.id)}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: action === 'send-now' ? JSON.stringify({ immediate: false }) : undefined,
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Broadcast action failed')
      const message = action === 'send-now'
        ? 'Broadcast queued from the control desk.'
        : action === 'pause'
          ? 'Broadcast paused from the control desk.'
          : 'Broadcast resumed from the control desk.'
      setFlash({ kind: 'ok', message })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Broadcast action failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function campaignAction(item: BriefingCard, action: 'approve-all' | 'launch' | 'archive') {
    if (!canCampaignAct(item)) return
    if (action === 'launch' && !campaignLaunchable(item)) return
    if (action === 'archive' && !campaignArchivable(item)) return
    setBusyAction(`campaign-${action}`)
    try {
      const res = await fetch(`/api/v1/campaigns/${encodeURIComponent(item.source.id)}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: action === 'approve-all'
          ? JSON.stringify({ type: 'all' })
          : action === 'archive'
            ? JSON.stringify({ force: false })
            : undefined,
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Campaign action failed')
      const message = action === 'approve-all'
        ? 'Campaign assets approved from the control desk.'
        : action === 'launch'
          ? 'Campaign launched from the control desk.'
          : 'Campaign archived from the control desk.'
      setFlash({ kind: 'ok', message })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Campaign action failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function enquiryAction(item: BriefingCard, status: 'reviewing' | 'active' | 'closed') {
    if (!enquiryActionable(item, mode)) return
    setBusyAction(`enquiry-${status}`)
    try {
      const res = await fetch(`/api/enquiries/${encodeURIComponent(item.source.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Enquiry update failed')
      const message = status === 'reviewing'
        ? 'Enquiry marked reviewing.'
        : status === 'active'
          ? 'Enquiry marked active.'
          : 'Enquiry closed.'
      setFlash({ kind: 'ok', message })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Enquiry update failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function formSubmissionAction(item: BriefingCard, status: 'read' | 'archived') {
    if (!formSubmissionActionable(item, mode)) return
    setBusyAction(`form-submission-${status}`)
    try {
      const res = await fetch(`/api/v1/forms/${encodeURIComponent(item.context.formId as string)}/submissions/${encodeURIComponent(item.source.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Form submission update failed')
      setFlash({ kind: 'ok', message: status === 'read' ? 'Form submission marked read.' : 'Form submission archived.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Form submission update failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function unblockTask(item: BriefingCard) {
    if (!canTaskAct(item)) return
    setBusyAction('unblock')
    try {
      const res = await fetch(`/api/v1/projects/${item.context.projectId}/tasks/${item.context.taskId}/unblock`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Unblock failed')
      setFlash({ kind: 'ok', message: body.data?.requeued ? 'Unblocked and requeued to the agent.' : 'Unblocked.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Unblock failed' })
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <div className="min-h-screen bg-page text-on-surface">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <section className="relative overflow-hidden rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-5 shadow-[var(--shadow-card)]">
          <span className="absolute inset-y-0 left-0 w-1.5 bg-[var(--color-accent-v2)]" aria-hidden="true" />
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(420px,0.8fr)] lg:items-end">
            <div className="pl-2">
              <p className="eyebrow !text-[10px] text-brand">{mode === 'admin' ? 'Admin / Control Desk' : 'Workspace / Control Desk'}</p>
              <h1 className="mt-2 max-w-4xl font-display text-4xl font-semibold text-on-surface sm:text-5xl">Briefings control desk</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-on-surface-variant">
                Live operations across projects, blockers, agent output, approvals, notifications, activity, documents, and reports. Work from the card, then jump to the exact source when deeper context is needed.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: 'Needs action', value: topStats.action, icon: 'bolt', color: 'var(--color-accent-v2)' },
                { label: 'Blocked', value: topStats.blocked, icon: 'priority_high', color: '#ef4444' },
                { label: 'For review', value: topStats.review, icon: 'rate_review', color: '#60a5fa' },
                { label: 'Agent signals', value: topStats.agents, icon: 'smart_toy', color: '#4ade80' },
              ].map((stat) => (
                <div key={stat.label} className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] p-3">
                  <span className="material-symbols-outlined text-[18px]" style={{ color: stat.color }} aria-hidden="true">{stat.icon}</span>
                  <p className="mt-2 text-2xl font-semibold text-on-surface">{stat.value}</p>
                  <p className="text-xs text-on-surface-variant">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {flash ? (
          <div className={`rounded-lg border px-4 py-3 text-sm ${flash.kind === 'ok' ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-100' : 'border-red-400/40 bg-red-400/10 text-red-100'}`}>
            {flash.message}
          </div>
        ) : null}

        <section className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-4">
          <div className="grid gap-3 lg:grid-cols-[1.1fr_0.85fr_0.85fr_auto] lg:items-end">
            {mode === 'admin' ? (
              <label className="flex flex-col gap-2 text-sm text-on-surface-variant">
                Workspace
                <select className="pib-input" value={orgId} onChange={(event) => setOrgId(event.target.value)}>
                  <option value="">All visible workspaces</option>
                  {orgs.map((org) => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="flex min-h-[74px] flex-col justify-center rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2">
                <p className="text-xs text-on-surface-variant">Active workspace</p>
                <p className="mt-1 truncate text-sm font-semibold text-on-surface">{activeWorkspaceName}</p>
              </div>
            )}
            <label className="flex flex-col gap-2 text-sm text-on-surface-variant">
              Priority
              <select className="pib-input" value={priority} onChange={(event) => setPriority(event.target.value)}>
                {PRIORITIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm text-on-surface-variant">
              Source
              <select className="pib-input" value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
                {SOURCES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <button className="pib-btn-secondary" type="button" onClick={() => setAutoRefresh((value) => !value)}>
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{autoRefresh ? 'sync' : 'sync_disabled'}</span>
                {autoRefresh ? 'Live on' : 'Live off'}
              </button>
              <button className="pib-btn-secondary" type="button" onClick={() => loadFeed()} disabled={loading}>
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">refresh</span>
                {loading ? 'Refreshing' : 'Refresh'}
              </button>
              <button className="pib-btn-primary" type="button" onClick={createSnapshot} disabled={snapshotting}>
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">bookmark_added</span>
                {snapshotting ? 'Saving' : 'Snapshot'}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow !text-[10px] text-brand">{mode === 'portal' ? 'Account pulse' : 'Workspace pulse'}</p>
              <p className="mt-1 text-sm text-on-surface-variant">
                {mode === 'portal'
                  ? 'Jump between CRM companies and workspace operations by action pressure, blockers, approvals, and agent signals.'
                  : 'Jump between organisations by action pressure, blockers, document approvals, and agent signals.'}
              </p>
            </div>
            {pulseSelectionId ? (
              <button type="button" className="pib-btn-secondary text-xs" onClick={clearPulseSelection}>
                <span className="material-symbols-outlined text-[15px]" aria-hidden="true">select_all</span>
                {mode === 'portal' ? 'All accounts' : 'All workspaces'}
              </button>
            ) : null}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {pulseRows.length === 0 ? (
              <div className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] p-4 text-sm text-on-surface-variant">
                {mode === 'portal'
                  ? 'Account counts will appear when the live feed returns active cards.'
                  : 'Workspace counts will appear when the live feed returns active cards.'}
              </div>
            ) : pulseRows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => selectPulseRow(row)}
                aria-label={`Filter to ${row.name} ${mode === 'portal' ? 'account' : 'workspace'}`}
                className={`min-h-36 rounded-lg border p-4 text-left transition ${pulseSelectionId === row.id ? 'border-[var(--color-accent-v2)] bg-[var(--color-accent-subtle)] shadow-lg shadow-black/20' : 'border-[var(--color-card-border)] bg-[var(--color-surface-container)] hover:border-[var(--color-accent-v2)]/50'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-on-surface">{row.name}</p>
                    <p className="mt-1 text-xs text-on-surface-variant">{row.total} live cards</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.action > 0 ? 'bg-amber-300/15 text-amber-100' : 'bg-emerald-300/15 text-emerald-100'}`}>
                    {row.action} action
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <span className="rounded-md bg-red-400/10 px-2 py-1 text-red-100">{row.blocked} blocked</span>
                  <span className="rounded-md bg-sky-400/10 px-2 py-1 text-sky-100">{row.review} review</span>
                  <span className="rounded-md bg-emerald-400/10 px-2 py-1 text-emerald-100">{row.agents} agents</span>
                  <span className="rounded-md bg-violet-400/10 px-2 py-1 text-violet-100">{row.documents} docs</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_420px] xl:items-start">
          <aside className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-3 xl:sticky xl:top-4 xl:h-fit">
            <p className="eyebrow !text-[10px] px-1">Signal lanes</p>
            <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-1">
              {PRIORITIES.filter((p) => p.value !== 'all').map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPriority(p.value)}
                  className={`flex min-h-14 items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition ${priority === p.value ? 'border-[var(--color-accent-v2)] bg-[var(--color-accent-subtle)] text-on-surface' : 'border-[var(--color-card-border)] bg-[var(--color-surface-container)] text-on-surface-variant hover:border-[var(--color-accent-v2)]/50 hover:text-on-surface'}`}
                  style={{ borderLeft: `3px solid ${priorityAccentColor(p.value)}` }}
                >
                  <span className="material-symbols-outlined text-[19px]" style={{ color: priorityAccentColor(p.value) }} aria-hidden="true">{p.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{p.label}</span>
                    <span className="block text-xs text-on-surface-variant">{counts[p.value] ?? 0} live</span>
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <div className="flex min-h-0 flex-col gap-3 xl:sticky xl:top-4 xl:h-[calc(100vh-2rem)]">
            <div className="flex shrink-0 items-center justify-between rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-4 py-3 text-sm text-on-surface-variant">
              <span>{items.length} live cards</span>
              <span>{feed?.generatedAt ? `Updated ${new Date(feed.generatedAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}` : 'Waiting for feed'}</span>
            </div>

            <div aria-label="Live briefing cards" className="min-h-0 flex-1 space-y-3 xl:overflow-y-auto xl:pr-2">
              {loading ? (
                <div className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-6 text-sm text-on-surface-variant">Loading live control desk...</div>
              ) : items.length === 0 ? (
                <div className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-6 text-sm text-on-surface-variant">No matching cards are active. Handled and snoozed cards stay out of this live view until they return.</div>
              ) : (
                items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={`w-full overflow-hidden rounded-lg border bg-[var(--color-card)] p-4 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-[var(--color-accent-v2)]/60 hover:bg-[var(--color-card-hover)] ${selected?.id === item.id ? 'border-[var(--color-accent-v2)] bg-[var(--color-card-hover)] shadow-[0_18px_40px_rgba(0,0,0,0.24)]' : 'border-[var(--color-card-border)]'}`}
                    style={{ borderLeft: `3px solid ${priorityAccentColor(item.priority)}` }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${priorityClass(item.priority)}`}>{PRIORITY_LABELS[item.priority]}</span>
                      <span className="rounded-full border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-2.5 py-1 text-xs text-on-surface-variant">{sourceLabel(item)}</span>
                      {item.requiresAction ? <span className="rounded-full border border-[var(--color-accent-v2)]/35 bg-[var(--color-accent-subtle)] px-2.5 py-1 text-xs text-[var(--color-accent-text)]">Action</span> : null}
                      <span className="ml-auto text-xs text-on-surface-variant">{item.timeAgo}</span>
                    </div>
                    <h2 className="mt-3 text-lg font-semibold leading-snug text-on-surface">{item.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-on-surface-variant">{item.summary}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-on-surface-variant">
                      <span>Workspace: {titledId(item.context.orgName, item.orgId)}</span>
                      {item.context.companyName || item.context.companyId ? <span>Company: {titledId(item.context.companyName, item.context.companyId)}</span> : null}
                      {item.context.projectName || item.context.projectId ? <span>Project: {titledId(item.context.projectName, item.context.projectId)}</span> : null}
                      {item.context.taskTitle || item.context.taskId ? <span>Task: {titledId(item.context.taskTitle, item.context.taskId)}</span> : null}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <aside className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-5 xl:sticky xl:top-4 xl:h-[calc(100vh-2rem)] xl:overflow-y-auto">
            <p className="eyebrow !text-[10px] text-brand">Action panel</p>
            {selected ? (
              <div className="mt-4 space-y-5">
                <div>
                  <h2 className="text-xl font-semibold text-on-surface">{selected.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-on-surface-variant">{selected.excerpt || selected.summary}</p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => setItemState(selected, 'handled')} disabled={!!busyAction}>
                    <span className="material-symbols-outlined text-[15px]" aria-hidden="true">done_all</span>
                    Handled
                  </button>
                  <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => setItemState(selected, 'snoozed')} disabled={!!busyAction}>
                    <span className="material-symbols-outlined text-[15px]" aria-hidden="true">snooze</span>
                    Snooze 24h
                  </button>
                  {canTaskUnblock(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => unblockTask(selected)} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">play_arrow</span>
                      Unblock
                    </button>
                  ) : null}
                  {reviewable(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => taskPatch(selected, { reviewStatus: 'approved', columnId: 'done', agentStatus: 'done' }, 'Approved and moved to done.')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">verified</span>
                      Approve
                    </button>
                  ) : null}
                  {reviewable(selected) ? (
                    <button className="pib-btn-secondary col-span-2 justify-center text-xs" type="button" onClick={() => taskPatch(selected, { reviewStatus: 'changes-requested', agentStatus: 'pending', columnId: 'todo' }, 'Sent back to the assigned agent.')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">assignment_return</span>
                      Send back to agent
                    </button>
                  ) : null}
                  {approvalGateReviewable(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => taskPatch(selected, { reviewStatus: 'approved', approvalStatus: 'approved', columnId: 'done', agentStatus: 'done' }, 'Approval gate approved.')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">verified</span>
                      Approve approval
                    </button>
                  ) : null}
                  {approvalGateReviewable(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => taskPatch(selected, { reviewStatus: 'changes-requested', approvalStatus: 'rejected', agentStatus: 'pending', columnId: 'todo' }, 'Approval gate rejected and sent back.')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">assignment_return</span>
                      Reject approval
                    </button>
                  ) : null}
                  {documentReviewable(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => approveDocument(selected)} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">approval</span>
                      Approve document
                    </button>
                  ) : null}
                  {documentReviewable(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => requestDocumentChanges(selected)} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">edit_note</span>
                      Request changes
                    </button>
                  ) : null}
                  {canDocumentCommentResolveAct(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => resolveDocumentComment(selected)} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">task_alt</span>
                      Resolve document comment
                    </button>
                  ) : null}
                  {canSocialPostAct(selected) && socialActionStage(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => socialPostAction(selected, 'approve')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">thumb_up</span>
                      Approve social post
                    </button>
                  ) : null}
                  {canSocialPostAct(selected) && socialActionStage(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => socialPostAction(selected, 'reject')} disabled={!socialChangeText.trim() || !!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">thumb_down</span>
                      Request social changes
                    </button>
                  ) : null}
                  {canSocialInboxAct(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => socialInboxAction(selected, 'read')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">mark_chat_read</span>
                      Mark engagement read
                    </button>
                  ) : null}
                  {canSocialInboxAct(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => socialInboxAction(selected, 'replied')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">forum</span>
                      Mark engagement replied
                    </button>
                  ) : null}
                  {canSocialInboxAct(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => socialInboxAction(selected, 'archived')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">archive</span>
                      Archive engagement
                    </button>
                  ) : null}
                  {canMailboxAct(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => mailboxPatch(selected, { read: true }, 'Email marked read.')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">mark_email_read</span>
                      Mark email read
                    </button>
                  ) : null}
                  {canMailboxAct(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => mailboxPatch(selected, { folder: 'archive' }, 'Email archived.')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">archive</span>
                      Archive email
                    </button>
                  ) : null}
                  {canAgentRunApprove(selected, mode) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => agentRunApprovalAction(selected, 'once')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">play_circle</span>
                      Approve run once
                    </button>
                  ) : null}
                  {canAgentRunApprove(selected, mode) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => agentRunApprovalAction(selected, 'deny')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">block</span>
                      Deny run
                    </button>
                  ) : null}
                  {canWorkspaceBrokerAct(selected, mode) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => workspaceBrokerAction(selected, 'approve')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">verified</span>
                      Approve workspace job
                    </button>
                  ) : null}
                  {canWorkspaceBrokerAct(selected, mode) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => workspaceBrokerAction(selected, 'reject')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">block</span>
                      Reject workspace job
                    </button>
                  ) : null}
                  {canCalendarRsvpAct(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => calendarRsvpAction(selected, 'accepted')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">event_available</span>
                      Accept meeting
                    </button>
                  ) : null}
                  {canCalendarRsvpAct(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => calendarRsvpAction(selected, 'declined')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">event_busy</span>
                      Decline meeting
                    </button>
                  ) : null}
                  {canNotificationAct(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => notificationAction(selected, 'read')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">mark_email_read</span>
                      Mark notification read
                    </button>
                  ) : null}
                  {canNotificationAct(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => notificationAction(selected, 'archived')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">archive</span>
                      Archive notification
                    </button>
                  ) : null}
                  {invoiceSendable(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => sendInvoice(selected)} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">send</span>
                      Send invoice
                    </button>
                  ) : null}
                  {invoicePaymentProofReviewable(selected, mode) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => paymentProofAction(selected, 'confirm')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">price_check</span>
                      Confirm payment proof
                    </button>
                  ) : null}
                  {invoicePaymentProofReviewable(selected, mode) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => paymentProofAction(selected, 'reject')} disabled={!paymentProofRejectReason.trim() || !!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">block</span>
                      Reject payment proof
                    </button>
                  ) : null}
                  {quoteDecisionable(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => quoteAction(selected, 'accept')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">verified</span>
                      Accept quote
                    </button>
                  ) : null}
                  {quoteDecisionable(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => quoteAction(selected, 'decline')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">block</span>
                      Decline quote
                    </button>
                  ) : null}
                  {quoteConvertible(selected, mode) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => quoteAction(selected, 'convert')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">receipt_long</span>
                      Convert to invoice
                    </button>
                  ) : null}
                  {orderActive(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => orderAction(selected, 'in_progress')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">play_arrow</span>
                      Mark order in progress
                    </button>
                  ) : null}
                  {orderActive(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => orderAction(selected, 'fulfilled')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">task_alt</span>
                      Mark order fulfilled
                    </button>
                  ) : null}
                  {orderActive(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => orderAction(selected, 'cancelled')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">block</span>
                      Cancel order
                    </button>
                  ) : null}
                  {inventoryActive(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => inventoryAction(selected, 'active')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">inventory_2</span>
                      Mark inventory restocked
                    </button>
                  ) : null}
                  {inventoryActive(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => inventoryAction(selected, 'archived')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">archive</span>
                      Archive inventory item
                    </button>
                  ) : null}
                  {shipmentActive(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => shipmentAction(selected, 'delivered')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">inventory_2</span>
                      Mark delivered
                    </button>
                  ) : null}
                  {shipmentActive(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => shipmentAction(selected, 'failed')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">report</span>
                      Mark shipment failed
                    </button>
                  ) : null}
                  {expenseReviewable(selected, mode) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => expenseAction(selected, 'approve')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">verified</span>
                      Approve expense
                    </button>
                  ) : null}
                  {expenseReviewable(selected, mode) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => expenseAction(selected, 'reject')} disabled={!expenseReviewText.trim() || !!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">block</span>
                      Reject expense
                    </button>
                  ) : null}
                  {seoContentReviewable(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => seoContentAction(selected, 'approve')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">published_with_changes</span>
                      Approve SEO content
                    </button>
                  ) : null}
                  {seoContentReviewable(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => seoContentAction(selected, 'changes')} disabled={!seoChangeText.trim() || !!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">edit_note</span>
                      Request SEO changes
                    </button>
                  ) : null}
                  {seoTaskSkippable(selected, mode) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => seoTaskAction(selected, 'execute')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">play_arrow</span>
                      Execute SEO task
                    </button>
                  ) : null}
                  {seoTaskSkippable(selected, mode) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => seoTaskAction(selected, 'complete')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">task_alt</span>
                      Complete SEO task
                    </button>
                  ) : null}
                  {seoTaskSkippable(selected, mode) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => seoTaskAction(selected, 'skip')} disabled={!seoTaskSkipReason.trim() || !!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">skip_next</span>
                      Skip SEO task
                    </button>
                  ) : null}
                  {adCampaignReviewable(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => adCampaignAction(selected, 'approve')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">verified</span>
                      Approve ad campaign
                    </button>
                  ) : null}
                  {adCampaignReviewable(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => adCampaignAction(selected, 'reject')} disabled={!adCampaignChangeText.trim() || !!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">assignment_return</span>
                      Request ad campaign changes
                    </button>
                  ) : null}
                  {broadcastSendable(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => broadcastAction(selected, 'send-now')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">send</span>
                      Send broadcast now
                    </button>
                  ) : null}
                  {broadcastPausable(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => broadcastAction(selected, 'pause')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">pause_circle</span>
                      Pause broadcast
                    </button>
                  ) : null}
                  {broadcastResumable(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => broadcastAction(selected, 'resume')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">play_circle</span>
                      Resume broadcast
                    </button>
                  ) : null}
                  {canCampaignAct(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => campaignAction(selected, 'approve-all')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">done_all</span>
                      Approve campaign assets
                    </button>
                  ) : null}
                  {campaignLaunchable(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => campaignAction(selected, 'launch')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">rocket_launch</span>
                      Launch campaign
                    </button>
                  ) : null}
                  {campaignArchivable(selected) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => campaignAction(selected, 'archive')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">archive</span>
                      Archive campaign
                    </button>
                  ) : null}
                  {enquiryActionable(selected, mode) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => enquiryAction(selected, 'reviewing')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">pageview</span>
                      Mark enquiry reviewing
                    </button>
                  ) : null}
                  {enquiryActionable(selected, mode) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => enquiryAction(selected, 'active')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">person_check</span>
                      Mark enquiry active
                    </button>
                  ) : null}
                  {enquiryActionable(selected, mode) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => enquiryAction(selected, 'closed')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">check_circle</span>
                      Close enquiry
                    </button>
                  ) : null}
                  {bookingActionable(selected, mode) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => bookingAction(selected, 'completed')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">event_available</span>
                      Mark booking completed
                    </button>
                  ) : null}
                  {bookingActionable(selected, mode) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => bookingAction(selected, 'cancelled')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">event_busy</span>
                      Cancel booking
                    </button>
                  ) : null}
                  {formSubmissionActionable(selected, mode) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => formSubmissionAction(selected, 'read')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">mark_email_read</span>
                      Mark submission read
                    </button>
                  ) : null}
                  {formSubmissionActionable(selected, mode) ? (
                    <button className="pib-btn-secondary justify-center text-xs" type="button" onClick={() => formSubmissionAction(selected, 'archived')} disabled={!!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">archive</span>
                      Archive submission
                    </button>
                  ) : null}
                </div>

                {canSocialPostAct(selected) && socialActionStage(selected) ? (
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <label className="text-xs font-medium text-on-surface-variant" htmlFor="briefing-social-change">
                      Social change request
                    </label>
                    <textarea
                      id="briefing-social-change"
                      className="pib-input mt-2 min-h-20 w-full resize-y"
                      value={socialChangeText}
                      onChange={(event) => setSocialChangeText(event.target.value)}
                      placeholder="Describe what the agent should change before approval..."
                    />
                  </div>
                ) : null}

                {canMailboxAct(selected) ? (
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <label className="text-xs font-medium text-on-surface-variant" htmlFor="briefing-mailbox-reply">
                      Mailbox reply draft
                    </label>
                    <textarea
                      id="briefing-mailbox-reply"
                      className="pib-input mt-2 min-h-24 w-full resize-y"
                      value={mailboxReplyText}
                      onChange={(event) => setMailboxReplyText(event.target.value)}
                      placeholder="Draft a reply without sending it yet..."
                    />
                    <button className="pib-btn-primary mt-2 w-full justify-center text-xs" type="button" onClick={() => draftMailboxReply(selected)} disabled={!mailboxReplyText.trim() || mailboxReplyTo(selected).length === 0 || !selected.metadata?.accountId || !!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">draft</span>
                      Draft email reply
                    </button>
                  </div>
                ) : null}

                {canTaskAct(selected) || canDocumentAct(selected) || canConversationAct(selected) ? (
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <label className="text-xs font-medium text-on-surface-variant" htmlFor="briefing-reply">
                      {canDocumentCommentReplyAct(selected) ? 'Inline document comment reply' : canTaskAct(selected) ? 'Inline task reply' : canDocumentAct(selected) ? 'Inline document reply' : 'Inline conversation reply'}
                    </label>
                    <textarea
                      id="briefing-reply"
                      className="pib-input mt-2 min-h-24 w-full resize-y"
                      value={replyText}
                      onChange={(event) => setReplyText(event.target.value)}
                      placeholder="Reply with a decision, note, or instruction..."
                    />
                    <button className="pib-btn-primary mt-2 w-full justify-center text-xs" type="button" onClick={() => replyToSelected(selected)} disabled={!replyText.trim() || !!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">reply</span>
                      {canDocumentCommentReplyAct(selected) ? 'Reply to document comment' : canTaskAct(selected) ? 'Post reply to task' : canDocumentAct(selected) ? 'Post reply to document' : 'Post reply to conversation'}
                    </button>
                  </div>
                ) : null}

                {canActivityFollowUpAct(selected) ? (
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <label className="text-xs font-medium text-on-surface-variant" htmlFor="briefing-follow-up">
                      Follow-up note
                    </label>
                    <textarea
                      id="briefing-follow-up"
                      className="pib-input mt-2 min-h-24 w-full resize-y"
                      value={followUpText}
                      onChange={(event) => setFollowUpText(event.target.value)}
                      placeholder="Log the call, decision, blocker, or next step against this CRM contact..."
                    />
                    <button className="pib-btn-primary mt-2 w-full justify-center text-xs" type="button" onClick={() => logActivityFollowUp(selected)} disabled={!followUpText.trim() || !!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">add_notes</span>
                      Log follow-up note
                    </button>
                    {canContactFollowUpComplete(selected) ? (
                      <button className="pib-btn-secondary mt-2 w-full justify-center text-xs" type="button" onClick={() => completeContactFollowUp(selected)} disabled={!followUpText.trim() || !!busyAction}>
                        <span className="material-symbols-outlined text-[15px]" aria-hidden="true">done_all</span>
                        Mark contact followed up
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {canReportAct(selected) ? (
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <label className="text-xs font-medium text-on-surface-variant" htmlFor="briefing-report-recipients">
                      Report recipients
                    </label>
                    <input
                      id="briefing-report-recipients"
                      className="pib-input mt-2 w-full"
                      value={reportRecipients}
                      onChange={(event) => setReportRecipients(event.target.value)}
                      placeholder="client@example.com, team@example.com"
                    />
                    <button className="pib-btn-primary mt-2 w-full justify-center text-xs" type="button" onClick={() => sendReport(selected)} disabled={!reportRecipients.trim() || !!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">send</span>
                      Send report
                    </button>
                  </div>
                ) : null}

                {canSupportTicketAct(selected) ? (
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <label className="text-xs font-medium text-on-surface-variant" htmlFor="briefing-support-reply">
                      Support reply
                    </label>
                    <textarea
                      id="briefing-support-reply"
                      className="pib-input mt-2 min-h-24 w-full resize-y"
                      value={replyText}
                      onChange={(event) => setReplyText(event.target.value)}
                      placeholder="Reply to the client and keep the support thread moving..."
                    />
                    <button className="pib-btn-primary mt-2 w-full justify-center text-xs" type="button" onClick={() => replyToSupportTicket(selected, replyText)} disabled={!replyText.trim() || !!busyAction}>
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">support_agent</span>
                      Reply to support ticket
                    </button>
                  </div>
                ) : null}

                {invoicePaymentProofReviewable(selected, mode) ? (
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <label className="text-xs font-medium text-on-surface-variant" htmlFor="briefing-payment-method">
                      Payment method
                    </label>
                    <select
                      id="briefing-payment-method"
                      className="pib-input mt-2 w-full"
                      value={paymentMethod}
                      onChange={(event) => setPaymentMethod(event.target.value)}
                    >
                      <option value="eft">EFT</option>
                      <option value="paypal">PayPal</option>
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="other">Other</option>
                    </select>
                    <label className="mt-3 block text-xs font-medium text-on-surface-variant" htmlFor="briefing-payment-reference">
                      Payment reference
                    </label>
                    <input
                      id="briefing-payment-reference"
                      className="pib-input mt-2 w-full"
                      value={paymentReference}
                      onChange={(event) => setPaymentReference(event.target.value)}
                      placeholder="Bank reference or transaction id..."
                    />
                    <label className="mt-3 block text-xs font-medium text-on-surface-variant" htmlFor="briefing-payment-proof-rejection">
                      Payment proof rejection reason
                    </label>
                    <textarea
                      id="briefing-payment-proof-rejection"
                      className="pib-input mt-2 min-h-20 w-full resize-y"
                      value={paymentProofRejectReason}
                      onChange={(event) => setPaymentProofRejectReason(event.target.value)}
                      placeholder="Required only when rejecting this proof..."
                    />
                  </div>
                ) : null}

                {expenseReviewable(selected, mode) ? (
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <label className="text-xs font-medium text-on-surface-variant" htmlFor="briefing-expense-review-note">
                      Expense rejection note
                    </label>
                    <textarea
                      id="briefing-expense-review-note"
                      className="pib-input mt-2 min-h-20 w-full resize-y"
                      value={expenseReviewText}
                      onChange={(event) => setExpenseReviewText(event.target.value)}
                      placeholder="Required only when rejecting this expense..."
                    />
                  </div>
                ) : null}

                {seoContentReviewable(selected) ? (
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <label className="text-xs font-medium text-on-surface-variant" htmlFor="briefing-seo-change-request">
                      SEO change request
                    </label>
                    <textarea
                      id="briefing-seo-change-request"
                      className="pib-input mt-2 min-h-20 w-full resize-y"
                      value={seoChangeText}
                      onChange={(event) => setSeoChangeText(event.target.value)}
                      placeholder="Tell the writer what must change before this goes live..."
                    />
                  </div>
                ) : null}

                {seoTaskSkippable(selected, mode) ? (
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <label className="text-xs font-medium text-on-surface-variant" htmlFor="briefing-seo-task-skip-reason">
                      SEO task skip reason
                    </label>
                    <textarea
                      id="briefing-seo-task-skip-reason"
                      className="pib-input mt-2 min-h-20 w-full resize-y"
                      value={seoTaskSkipReason}
                      onChange={(event) => setSeoTaskSkipReason(event.target.value)}
                      placeholder="Explain why this sprint task should be skipped..."
                    />
                  </div>
                ) : null}

                {adCampaignReviewable(selected) ? (
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <label className="text-xs font-medium text-on-surface-variant" htmlFor="briefing-ad-campaign-change-request">
                      Ad campaign change request
                    </label>
                    <textarea
                      id="briefing-ad-campaign-change-request"
                      className="pib-input mt-2 min-h-20 w-full resize-y"
                      value={adCampaignChangeText}
                      onChange={(event) => setAdCampaignChangeText(event.target.value)}
                      placeholder="Tell the ads team what must change before launch..."
                    />
                  </div>
                ) : null}

                <dl className="space-y-3 text-sm">
                  <div><dt className="text-on-surface-variant">Actor</dt><dd className="text-on-surface">{titledId(selected.actor.name, selected.actor.id)}</dd></div>
                  <div><dt className="text-on-surface-variant">Workspace</dt><dd className="text-on-surface">{titledId(selected.context.orgName, selected.orgId)}</dd></div>
                  {selected.context.projectName || selected.context.projectId ? <div><dt className="text-on-surface-variant">Project</dt><dd className="text-on-surface">{titledId(selected.context.projectName, selected.context.projectId)}</dd></div> : null}
                  {selected.context.taskTitle || selected.context.taskId ? <div><dt className="text-on-surface-variant">Task</dt><dd className="text-on-surface">{titledId(selected.context.taskTitle, selected.context.taskId)}</dd></div> : null}
                  {selected.context.documentTitle || selected.context.documentId ? <div><dt className="text-on-surface-variant">Document</dt><dd className="text-on-surface">{titledId(selected.context.documentTitle, selected.context.documentId)}</dd></div> : null}
                  {selected.context.conversationTitle || selected.context.conversationId ? <div><dt className="text-on-surface-variant">Conversation</dt><dd className="text-on-surface">{titledId(selected.context.conversationTitle, selected.context.conversationId)}</dd></div> : null}
                  {selected.context.contactName || selected.context.contactId ? <div><dt className="text-on-surface-variant">Contact</dt><dd className="text-on-surface">{titledId(selected.context.contactName, selected.context.contactId)}</dd></div> : null}
                  {typeof selected.metadata?.contactStage === 'string' && selected.metadata.contactStage ? <div><dt className="text-on-surface-variant">Contact stage</dt><dd className="text-on-surface">{selected.metadata.contactStage}</dd></div> : null}
                  {typeof selected.metadata?.lastContactedAt === 'string' && selected.metadata.lastContactedAt ? <div><dt className="text-on-surface-variant">Last contacted</dt><dd className="text-on-surface">{selected.metadata.lastContactedAt.slice(0, 10)}</dd></div> : null}
                  {selected.context.dealTitle || selected.context.dealId ? <div><dt className="text-on-surface-variant">Deal</dt><dd className="text-on-surface">{titledId(selected.context.dealTitle, selected.context.dealId)}</dd></div> : null}
                  {selected.context.reportTitle || selected.context.reportId ? <div><dt className="text-on-surface-variant">Report</dt><dd className="text-on-surface">{titledId(selected.context.reportTitle, selected.context.reportId)}</dd></div> : null}
                  {selected.context.bookingName || selected.context.bookingId ? <div><dt className="text-on-surface-variant">Booking</dt><dd className="text-on-surface">{titledId(selected.context.bookingName, selected.context.bookingId ?? selected.source.id)}</dd></div> : null}
                  {selected.context.supportTicketSubject || selected.context.supportTicketId ? <div><dt className="text-on-surface-variant">Support ticket</dt><dd className="text-on-surface">{titledId(selected.context.supportTicketSubject, selected.context.supportTicketId)}</dd></div> : null}
                  {selected.context.invoiceNumber || selected.context.invoiceId ? <div><dt className="text-on-surface-variant">Invoice</dt><dd className="text-on-surface">{titledId(selected.context.invoiceNumber, selected.context.invoiceId ?? selected.source.id)}</dd></div> : null}
                  {selected.context.quoteNumber || selected.context.quoteId ? <div><dt className="text-on-surface-variant">Quote</dt><dd className="text-on-surface">{titledId(selected.context.quoteNumber, selected.context.quoteId ?? selected.source.id)}</dd></div> : null}
                  {selected.context.orderTitle || selected.context.orderId ? <div><dt className="text-on-surface-variant">Order</dt><dd className="text-on-surface">{titledId(selected.context.orderTitle, selected.context.orderId ?? selected.source.id)}</dd></div> : null}
                  {selected.context.inventoryItemName || selected.context.inventoryItemId ? <div><dt className="text-on-surface-variant">Inventory</dt><dd className="text-on-surface">{titledId(selected.context.inventoryItemName, selected.context.inventoryItemId ?? selected.source.id)}</dd></div> : null}
                  {selected.context.shipmentTrackingNumber || selected.context.shipmentId ? <div><dt className="text-on-surface-variant">Shipment</dt><dd className="text-on-surface">{titledId(selected.context.shipmentTrackingNumber, selected.context.shipmentId ?? selected.source.id)}</dd></div> : null}
                  {selected.context.expenseCategory || selected.context.expenseId ? <div><dt className="text-on-surface-variant">Expense</dt><dd className="text-on-surface">{titledId(selected.context.expenseCategory, selected.context.expenseId ?? selected.source.id)}</dd></div> : null}
                  {selected.context.seoContentTitle || selected.context.seoContentId ? <div><dt className="text-on-surface-variant">SEO content</dt><dd className="text-on-surface">{titledId(selected.context.seoContentTitle, selected.context.seoContentId ?? selected.source.id)}</dd></div> : null}
                  {selected.context.seoTaskTitle || selected.context.seoTaskId ? <div><dt className="text-on-surface-variant">SEO task</dt><dd className="text-on-surface">{titledId(selected.context.seoTaskTitle, selected.context.seoTaskId ?? selected.source.id)}</dd></div> : null}
                  {selected.context.adCampaignName || selected.context.adCampaignId ? <div><dt className="text-on-surface-variant">Ad campaign</dt><dd className="text-on-surface">{titledId(selected.context.adCampaignName, selected.context.adCampaignId ?? selected.source.id)}</dd></div> : null}
                  {selected.context.broadcastName || selected.context.broadcastId ? <div><dt className="text-on-surface-variant">Broadcast</dt><dd className="text-on-surface">{titledId(selected.context.broadcastName, selected.context.broadcastId ?? selected.source.id)}</dd></div> : null}
                  {selected.context.campaignName || selected.context.campaignId ? <div><dt className="text-on-surface-variant">Campaign</dt><dd className="text-on-surface">{titledId(selected.context.campaignName, selected.context.campaignId ?? selected.source.id)}</dd></div> : null}
                  {typeof selected.metadata?.sequenceId === 'string' && selected.metadata.sequenceId ? <div><dt className="text-on-surface-variant">Sequence</dt><dd className="text-on-surface">{selected.metadata.sequenceId}</dd></div> : null}
                  {typeof selected.metadata?.segmentId === 'string' && selected.metadata.segmentId ? <div><dt className="text-on-surface-variant">Segment</dt><dd className="text-on-surface">{selected.metadata.segmentId}</dd></div> : null}
                  {typeof selected.metadata?.subject === 'string' && selected.metadata.subject ? <div><dt className="text-on-surface-variant">Subject</dt><dd className="text-on-surface">{selected.metadata.subject}</dd></div> : null}
                  {typeof selected.metadata?.audienceSize === 'number' ? <div><dt className="text-on-surface-variant">Audience</dt><dd className="text-on-surface">{selected.metadata.audienceSize.toLocaleString('en-ZA')} recipients</dd></div> : null}
                  {selected.context.enquiryName || selected.context.enquiryId ? <div><dt className="text-on-surface-variant">Enquiry</dt><dd className="text-on-surface">{titledId(selected.context.enquiryName, selected.context.enquiryId ?? selected.source.id)}</dd></div> : null}
                  {selected.context.formName || selected.context.formId || selected.context.formSubmissionId ? <div><dt className="text-on-surface-variant">Form submission</dt><dd className="text-on-surface">{titledId(selected.context.formName ?? selected.context.formId, selected.context.formSubmissionId ?? selected.source.id)}</dd></div> : null}
                  {selected.context.socialInboxFrom || selected.context.socialInboxId ? <div><dt className="text-on-surface-variant">Social inbox</dt><dd className="text-on-surface">{titledId(selected.context.socialInboxFrom, selected.context.socialInboxId ?? selected.source.id)}</dd></div> : null}
                  {selected.context.mailboxFrom || selected.context.mailboxMessageId ? <div><dt className="text-on-surface-variant">Mailbox</dt><dd className="text-on-surface">{titledId(selected.context.mailboxFrom, selected.context.mailboxMessageId ?? selected.source.id)}</dd></div> : null}
                  {selected.context.agentProfile || selected.context.agentRunId ? <div><dt className="text-on-surface-variant">Agent run</dt><dd className="text-on-surface">{titledId(selected.context.agentProfile, selected.context.agentRunId ?? selected.source.id)}</dd></div> : null}
                  {typeof selected.metadata?.approvalToolName === 'string' && selected.metadata.approvalToolName ? <div><dt className="text-on-surface-variant">Approval tool</dt><dd className="text-on-surface">{selected.metadata.approvalToolName}</dd></div> : null}
                  {selected.context.workspaceBrokerOperation || selected.context.workspaceBrokerJobId ? <div><dt className="text-on-surface-variant">Workspace job</dt><dd className="text-on-surface">{titledId(selected.context.workspaceBrokerOperation, selected.context.workspaceBrokerJobId ?? selected.source.id)}</dd></div> : null}
                  {selected.context.workspaceArtifactTitle || selected.context.workspaceArtifactId ? <div><dt className="text-on-surface-variant">Workspace artifact</dt><dd className="text-on-surface">{titledId(selected.context.workspaceArtifactTitle, selected.context.workspaceArtifactId)}</dd></div> : null}
                  {selected.context.calendarEventTitle || selected.context.calendarEventId ? <div><dt className="text-on-surface-variant">Calendar event</dt><dd className="text-on-surface">{titledId(selected.context.calendarEventTitle, selected.context.calendarEventId ?? selected.source.id)}</dd></div> : null}
                  <div><dt className="text-on-surface-variant">Occurred</dt><dd className="text-on-surface">{new Date(selected.occurredAt).toLocaleString('en-ZA')}</dd></div>
                  <div><dt className="text-on-surface-variant">Source</dt><dd className="text-on-surface">{sourceLabel(selected)}</dd></div>
                </dl>

                {(mode === 'admin' ? adminSourceHref(selected) : sourceHref(selected, mode)) ? (
                  <a className="pib-btn-primary inline-flex w-full justify-center" href={(mode === 'admin' ? adminSourceHref(selected) : sourceHref(selected, mode)) ?? undefined} target="_blank" rel="noopener noreferrer">
                    <span className="material-symbols-outlined text-[16px]" aria-hidden="true">open_in_new</span>
                    Open source
                  </a>
                ) : null}
              </div>
            ) : (
              <p className="mt-4 text-sm text-on-surface-variant">Select a live card to inspect evidence and act on the source.</p>
            )}
          </aside>
        </section>
      </div>
    </div>
  )
}
