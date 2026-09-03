'use client'

import { Icon } from '@/components/studio'

import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import type { SoftwareBuildEvidenceRow, AgentOutputReviewStatus, AgentOutputReviewArtifact, AgentOutputQualityCheck, AgentOutputApprovalGate, AgentOutputReviewCard, AgentLearningReviewLink, AgentLearningReviewCard, BriefingCard, Mode } from './cockpit/cockpitTypes'
import { useBriefingFeed } from './cockpit/useBriefingFeed'
import { CockpitShell } from './cockpit/CockpitShell'
import { TodayRail } from './cockpit/TodayRail'
import { BriefingCardForKind, type BookCallInput, type BriefingCardActions } from './cards/BriefingCardForKind'
import type { BusyBlock } from './cards/types'
import { AgentGroupCard } from './cards/AgentGroupCard'
import { LaneEmptyState } from './cockpit/LaneEmptyState'
import { canStopAgentRun, harvestPipDraft } from './deskHelpers'
import { BRIEFING_WORK_LANES, resolveWorkKind, type BriefingWorkKind } from '@/lib/briefing/workKind'
import { sanitizeContextReferenceSeeds, type ContextReferenceSeed, type ContextReferenceType } from '@/lib/context-references/types'
import {
  briefingContactChannels,
  briefingDisplayFacts,
  briefingHandoffAgentId,
  briefingHasContactChannel,
  briefingPersonName,
  briefingUsefulSummary,
  isBoilerplateDisabledReason,
  isContactableSource,
  isCrmRelationshipSource,
  isGenericBriefingDecision,
} from '@/lib/briefing/cardFacts'

const ACTION_CONTROL_GRID_CLASS = 'mt-3 grid min-w-0 grid-cols-1 gap-2'
const ACTION_CONTEXT_GRID_CLASS = 'mt-2 grid min-w-0 grid-cols-1 gap-2'
const ACTION_CONTROL_CLASS = 'pib-btn-secondary min-w-0 w-full items-start justify-start whitespace-normal rounded-lg px-3 py-2 text-left text-xs leading-4'
const ACTION_CONTROL_LINK_CLASS = `${ACTION_CONTROL_CLASS} inline-flex`
const ACTION_CONTROL_ICON_CLASS = 'st-icon shrink-0 text-[15px]'
const SOURCE_ACTION_CONTROL_CLASS = 'pib-btn-secondary min-w-0 w-full items-center justify-center whitespace-normal rounded-lg px-3 py-2 text-center text-xs leading-4'

export function briefingContextSeed(item: BriefingCard, mode: Mode, portalScope?: PortalOrgRouteScope): ContextReferenceSeed {
  const supplied = item.metadata?.contextReference
  const orgId = item.orgId || item.context.orgId || undefined
  const base = {
    orgId,
    href: mode === 'admin' ? adminSourceHref(item) ?? undefined : sourceHref(item, mode, portalScope) ?? undefined,
    summary: humanReadableCopy(item.excerpt || item.summary),
  }
  const parsed = sanitizeContextReferenceSeeds([supplied])[0]
  if (parsed) {
    return { ...base, ...parsed, orgId, label: parsed.label || item.title }
  }
  const candidates: Array<[ContextReferenceType, string | null | undefined, string | null | undefined]> = [
    ['task', item.context.taskId, item.context.taskTitle],
    ['document', item.context.documentId, item.context.documentTitle],
    ['contact', item.context.contactId, item.context.contactName],
    ['company', item.context.companyId, item.context.companyName],
    ['deal', item.context.dealId, item.context.dealTitle],
    ['invoice', item.context.invoiceId, item.context.invoiceNumber],
    ['quote', item.context.quoteId, item.context.quoteNumber],
    ['report', item.context.reportId, item.context.reportTitle],
    ['workspace_artifact', item.context.workspaceArtifactId, item.context.workspaceArtifactTitle],
    ['calendar_event', item.context.calendarEventId, item.context.calendarEventTitle],
    ['project', item.context.projectId, item.context.projectName],
  ]
  const domain = candidates.find(([, id]) => typeof id === 'string' && id.trim())
  if (domain) {
    const [type, id, label] = domain
    return { ...base, type, id: id!.trim(), label: label?.trim() || item.title, metadata: { sourceType: item.source.type, sourceId: item.source.id } }
  }
  return { ...base, type: 'report', id: `briefing:${item.id}`, label: item.title, metadata: { sourceType: item.source.type, sourceId: item.source.id } }
}

function ActionControlLabel({ children }: { children: ReactNode }) {
  return (
    <span data-action-label className="min-w-0 flex-1 whitespace-normal break-words text-left leading-4">
      {children}
    </span>
  )
}

const SOURCES = [
  { value: 'all', label: 'All sources' },
  { value: 'task', label: 'Tasks' },
  { value: 'agent-learning-review', label: 'Agent learning' },
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
  { value: 'deal', label: 'Deals' },
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

const COLLAPSED_LANES_KEY = 'pib.briefings.collapsedLanes'
const DEFAULT_COLLAPSED_LANES: Record<BriefingWorkKind, boolean> = { meeting: false, reply: false, approval: false, agent: true, blocked: false }

function readCollapsedLanes(): Record<BriefingWorkKind, boolean> {
  if (typeof window === 'undefined') return DEFAULT_COLLAPSED_LANES
  try {
    const raw = window.localStorage.getItem(COLLAPSED_LANES_KEY)
    if (!raw) return DEFAULT_COLLAPSED_LANES
    const parsed = JSON.parse(raw) as Partial<Record<BriefingWorkKind, boolean>>
    return { ...DEFAULT_COLLAPSED_LANES, ...parsed }
  } catch {
    return DEFAULT_COLLAPSED_LANES
  }
}

function writeCollapsedLanes(value: Record<BriefingWorkKind, boolean>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(COLLAPSED_LANES_KEY, JSON.stringify(value))
  } catch {
    // Preference storage is best-effort.
  }
}

/** Lane collapsing is a desktop affordance; mobile always shows the selected lane in full. */
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(true)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(min-width: 1024px)')
    const update = () => setIsDesktop(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return isDesktop
}

function accentForLane(kind: BriefingWorkKind) {
  switch (kind) {
    case 'meeting':
      return '#10b981'
    case 'reply':
      return '#60a5fa'
    case 'approval':
      return 'var(--color-accent-v2)'
    case 'agent':
      return '#a78bfa'
    case 'blocked':
      return '#f97316'
    default:
      return 'var(--color-pib-line)'
  }
}

function titledId(title: string | null | undefined, id: string | null | undefined) {
  const cleanTitle = title?.trim()
  const cleanId = id?.trim()
  if (cleanTitle && cleanId && cleanTitle !== cleanId && !looksLikeOpaqueId(cleanId)) return `${cleanTitle} (${cleanId})`
  if (cleanTitle) return cleanTitle
  if (cleanId && !looksLikeOpaqueId(cleanId)) return cleanId
  return 'Unknown'
}

function sourceTypeLabel(type: string) {
  const option = SOURCES.find((source) => source.value === type)
  return option?.label.replace(/s$/, '') ?? type.replace(/-/g, ' ')
}

function looksLikeOpaqueId(value: string | null | undefined) {
  if (!value) return false
  const trimmed = value.trim()
  const withoutPrefix = trimmed.replace(/^(user|agent|crm|email|org):/i, '')
  return /^[A-Za-z0-9_-]{16,}$/.test(trimmed)
    || /^[A-Za-z0-9_-]{16,}$/.test(withoutPrefix)
    || /^[a-z]+_[A-Za-z0-9_-]{8,}$/i.test(trimmed)
}

function detailMetaValue(title: string | null | undefined, id?: string | null) {
  const value = titledId(title, id)
  return value && value !== 'Unknown' ? value : null
}

function humanReadableCopy(value: string | null | undefined) {
  if (!value) return ''
  let copy = value.replace(/(?:^|\.\s*)View:\s*\S+/g, '').replace(/\s{2,}/g, ' ').trim()
  copy = copy.replace(/^([A-Za-z0-9_-]{16,})\s+(approved|accepted)\s+/i, (_match, actorId: string, action: string) => {
    if (!looksLikeOpaqueId(actorId)) return `${actorId} ${action} `
    return `A user ${action} `
  })
  return copy.replace(/\s+\./g, '.').trim()
}

function viewHrefFromCopy(value: string | null | undefined) {
  if (!value) return null
  const match = value.match(/(?:^|\.\s*)View:\s*(\S+)/)
  return match?.[1] ?? null
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
  return sourceTypeLabel(item.source.type)
}

function hasPortalRouteScope(scope?: PortalOrgRouteScope) {
  return Boolean(
    cleanText(scope?.orgId)
    || cleanText(scope?.orgSlug)
    || cleanText(scope?.sourceCompanyId)
    || cleanText(scope?.sourceCompanyName),
  )
}

function portalSourceHref(href: string | null | undefined, scope?: PortalOrgRouteScope) {
  const path = href?.trim()
  if (!path) return null
  if (!path.startsWith('/portal')) return path
  if (!hasPortalRouteScope(scope)) return path
  if (/[?&](?:orgId|orgSlug|sourceCompanyId|sourceCompanyName)=/.test(path)) return path
  return scopedPortalPath(path, scope ?? {})
}

function sourceHref(item: BriefingCard, mode: Mode, portalScope?: PortalOrgRouteScope) {
  if (item.source.type === 'agent-run') return mode === 'admin' ? adminSourceHref(item) : null
  if (item.source.type === 'workspace-broker-job') return mode === 'admin' ? adminSourceHref(item) : null
  if (item.source.type === 'calendar-event') {
    return mode === 'admin'
      ? item.source.url || adminSourceHref(item)
      : portalSourceHref(item.source.url || `/portal/calendar/events/${encodeURIComponent(item.source.id)}`, portalScope)
  }
  if (item.source.type === 'booking') return mode === 'admin' ? adminSourceHref(item) : null
  if (item.source.type === 'form-submission') return mode === 'admin' ? adminSourceHref(item) : null
  if (item.source.type === 'social-inbox') return adminSourceHref(item)
  if (item.source.type === 'mailbox-message') {
    return mode === 'admin' ? adminSourceHref(item) : portalSourceHref(item.source.url || `/portal/email?message=${encodeURIComponent(item.source.id)}`, portalScope)
  }
  if (item.source.type === 'social-post') return portalSourceHref(`/portal/social/review/${encodeURIComponent(item.source.id)}`, portalScope)
  if (item.source.type === 'support-ticket') return mode === 'admin' ? `/admin/support?ticket=${encodeURIComponent(item.source.id)}` : portalSourceHref('/portal', portalScope)
  if (item.source.type === 'invoice') return mode === 'admin' ? `/admin/invoicing/${encodeURIComponent(item.source.id)}` : portalSourceHref(`/portal/payments?invoice=${encodeURIComponent(item.source.id)}`, portalScope)
  if (item.source.type === 'quote') return mode === 'admin' ? `/admin/quotes/${encodeURIComponent(item.source.id)}` : portalSourceHref(`/portal/payments?quote=${encodeURIComponent(item.source.id)}`, portalScope)
  if (item.source.type === 'order') return portalSourceHref(item.source.url || (item.context.companyId ? `/portal/companies/${encodeURIComponent(item.context.companyId)}?order=${encodeURIComponent(item.source.id)}` : `/portal/crm?order=${encodeURIComponent(item.source.id)}`), portalScope)
  if (item.source.type === 'inventory-item') return portalSourceHref(item.source.url || (item.context.companyId ? `/portal/companies/${encodeURIComponent(item.context.companyId)}?inventory=${encodeURIComponent(item.source.id)}` : `/portal/crm?inventory=${encodeURIComponent(item.source.id)}`), portalScope)
  if (item.source.type === 'shipment') return portalSourceHref(item.source.url || (item.context.companyId ? `/portal/companies/${encodeURIComponent(item.context.companyId)}?shipment=${encodeURIComponent(item.source.id)}` : `/portal/crm?shipment=${encodeURIComponent(item.source.id)}`), portalScope)
  if (item.source.type === 'expense') return mode === 'admin' ? `/admin/finance?expense=${encodeURIComponent(item.source.id)}` : null
  if (item.source.type === 'ad-campaign') return mode === 'admin' ? adminSourceHref(item) : portalSourceHref(`/portal/ads/campaigns/${encodeURIComponent(item.source.id)}`, portalScope)
  if (item.source.type === 'broadcast') return mode === 'admin' ? adminSourceHref(item) : portalSourceHref(item.source.url || `/portal/campaigns/broadcast/${encodeURIComponent(item.source.id)}`, portalScope)
  if (item.source.type === 'campaign') return mode === 'admin' ? adminSourceHref(item) : portalSourceHref(item.source.url || `/portal/campaigns/${encodeURIComponent(item.source.id)}`, portalScope)
  if (item.source.type === 'enquiry') return mode === 'admin' ? adminSourceHref(item) : null
  if (item.source.type === 'seo-content') {
    const sprintId = item.context.seoSprintId
    const contentId = encodeURIComponent(item.source.id)
    if (sprintId) {
      return mode === 'admin'
        ? `/portal/seo/sprints/${encodeURIComponent(sprintId)}/content?content=${contentId}`
        : portalSourceHref(`/portal/seo/sprints/${encodeURIComponent(sprintId)}/content?content=${contentId}`, portalScope)
    }
    return mode === 'admin'
      ? `/portal/seo?content=${contentId}`
      : portalSourceHref(`/portal/seo?content=${contentId}`, portalScope)
  }
  if (item.source.type === 'seo-task') {
    if (mode !== 'admin') return null
    const sprintId = item.context.seoSprintId
    const taskId = encodeURIComponent(item.source.id)
    if (sprintId) return `/portal/seo/sprints/${encodeURIComponent(sprintId)}/tasks?task=${taskId}`
    return `/portal/seo?task=${taskId}`
  }
  if (mode === 'admin') return item.source.url || null
  if (item.source.url?.startsWith('/portal')) return portalSourceHref(item.source.url, portalScope)
  if (item.context.conversationId) return portalSourceHref(`/portal/conversations?convId=${encodeURIComponent(item.context.conversationId)}`, portalScope)
  if (item.context.projectId) return portalSourceHref(`/portal/projects/${item.context.projectId}${item.context.taskId ? `?taskId=${encodeURIComponent(item.context.taskId)}` : ''}`, portalScope)
  if (item.context.documentId) return portalSourceHref(`/portal/documents/${item.context.documentId}`, portalScope)
  if (item.context.contactId) return portalSourceHref(`/portal/contacts/${encodeURIComponent(item.context.contactId)}`, portalScope)
  if (item.context.dealId) return portalSourceHref(`/portal/deals/${encodeURIComponent(item.context.dealId)}`, portalScope)
  if (item.source.type === 'report' && item.source.url) return item.source.url
  return item.source.url || null
}

function softwareBuildEvidenceRows(item: BriefingCard): SoftwareBuildEvidenceRow[] {
  const rows = item.metadata?.softwareBuildEvidence
  if (!Array.isArray(rows)) return []
  return rows.filter((row): row is SoftwareBuildEvidenceRow => {
    if (!row || typeof row !== 'object') return false
    const candidate = row as Record<string, unknown>
    return typeof candidate.kind === 'string'
      && typeof candidate.label === 'string'
      && typeof candidate.value === 'string'
      && (candidate.href === undefined || typeof candidate.href === 'string')
  })
}

function isReviewStatus(value: unknown): value is AgentOutputReviewStatus {
  return value === 'pass' || value === 'warning' || value === 'blocked'
}

function agentOutputReviewCard(item: BriefingCard): AgentOutputReviewCard | null {
  const card = item.metadata?.agentOutputReviewCard
  if (!card || typeof card !== 'object' || Array.isArray(card)) return null
  const candidate = card as Record<string, unknown>
  if (typeof candidate.summary !== 'string' || typeof candidate.nextAction !== 'string') return null

  const artifacts = Array.isArray(candidate.artifacts)
    ? candidate.artifacts.filter((artifact): artifact is AgentOutputReviewArtifact => {
      if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) return false
      const item = artifact as Record<string, unknown>
      return typeof item.type === 'string'
        && typeof item.label === 'string'
        && typeof item.ref === 'string'
        && (item.href === undefined || typeof item.href === 'string')
    })
    : []
  const qualityChecks = Array.isArray(candidate.qualityChecks)
    ? candidate.qualityChecks.filter((check): check is AgentOutputQualityCheck => {
      if (!check || typeof check !== 'object' || Array.isArray(check)) return false
      const item = check as Record<string, unknown>
      return typeof item.label === 'string'
        && isReviewStatus(item.status)
        && typeof item.detail === 'string'
    })
    : []
  const approvalGates = Array.isArray(candidate.approvalGates)
    ? candidate.approvalGates.filter((gate): gate is AgentOutputApprovalGate => {
      if (!gate || typeof gate !== 'object' || Array.isArray(gate)) return false
      const item = gate as Record<string, unknown>
      return typeof item.label === 'string'
        && isReviewStatus(item.status)
        && typeof item.value === 'string'
        && (item.href === undefined || typeof item.href === 'string')
    })
    : []

  return {
    summary: candidate.summary,
    nextAction: candidate.nextAction,
    evidence: softwareBuildEvidenceRows(item),
    artifacts,
    qualityChecks,
    approvalGates,
  }
}

function normalizeAgentLearningLinks(value: unknown): AgentLearningReviewLink[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const candidate = entry as Record<string, unknown>
    if (typeof candidate.label !== 'string' || typeof candidate.href !== 'string') return []
    return [{ label: candidate.label, href: candidate.href, type: typeof candidate.type === 'string' ? candidate.type : 'link' }]
  })
}

function normalizeAgentLearningText(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}

function agentLearningReviewCard(item: BriefingCard): AgentLearningReviewCard | null {
  const card = item.metadata?.agentLearningReview
  if (!card || typeof card !== 'object' || Array.isArray(card)) return null
  const candidate = card as Record<string, unknown>
  const automationGuard = typeof candidate.automationGuard === 'string' && candidate.automationGuard.trim().length
    ? candidate.automationGuard
    : 'No automatic skill or wiki rewrites. Proposed changes must be reviewed before any durable knowledge is changed.'
  return {
    automationGuard,
    skillLinks: normalizeAgentLearningLinks(candidate.skillLinks),
    wikiLinks: normalizeAgentLearningLinks(candidate.wikiLinks),
    taskLinks: normalizeAgentLearningLinks(candidate.taskLinks),
    proposedChanges: normalizeAgentLearningText(candidate.proposedChanges),
    sourceDocumentId: typeof candidate.sourceDocumentId === 'string' ? candidate.sourceDocumentId : null,
    approvalGateTaskId: typeof candidate.approvalGateTaskId === 'string' ? candidate.approvalGateTaskId : null,
  }
}

function statusToneClass(status: AgentOutputReviewStatus) {
  switch (status) {
    case 'pass':
      return 'border-emerald-300/35 bg-emerald-400/10 text-emerald-100'
    case 'blocked':
      return 'border-amber-300/45 bg-[var(--sc-surface)]/10 text-[var(--sc-ink-soft)]'
    default:
      return 'border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] text-[var(--color-pib-text-muted)]'
  }
}

function statusLabel(status: AgentOutputReviewStatus) {
  if (status === 'pass') return 'Pass'
  if (status === 'blocked') return 'Blocked'
  return 'Needs check'
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
    return `/portal/marketing?adCampaign=${encodeURIComponent(item.source.id)}`
  }
  if (item.source.type === 'broadcast') return `/admin/broadcasts/${encodeURIComponent(item.source.id)}`
  if (item.source.type === 'campaign') return `/portal/campaigns/${encodeURIComponent(item.source.id)}`
  if (item.source.type === 'form-submission') {
    const formId = item.context.formId
    // No submissions detail page exists yet (tracked in convergence tracker); land on the capture-sources workspace.
    if (formId) return `/portal/capture-sources?formId=${encodeURIComponent(formId)}`
    return item.source.url || null
  }
  if (item.source.type === 'enquiry') return item.source.url || `/admin/briefings?source=enquiry&id=${encodeURIComponent(item.source.id)}`
  if (item.source.type === 'social-inbox') {
    return item.source.url || `/admin/social/inbox?item=${encodeURIComponent(item.source.id)}`
  }
  if (item.source.type === 'mailbox-message') {
    return `/portal/email?message=${encodeURIComponent(item.source.id)}`
  }
  if (item.source.type === 'seo-content') {
    const sprintId = item.context.seoSprintId
    const contentId = encodeURIComponent(item.source.id)
    if (sprintId) return `/portal/seo/sprints/${encodeURIComponent(sprintId)}/content?content=${contentId}`
    return `/portal/seo?content=${contentId}`
  }
  if (item.source.type === 'seo-task') {
    const sprintId = item.context.seoSprintId
    const taskId = encodeURIComponent(item.source.id)
    if (sprintId) return `/portal/seo/sprints/${encodeURIComponent(sprintId)}/tasks?task=${taskId}`
    return `/portal/seo?task=${taskId}`
  }
  if (item.context.conversationId) {
    const query = `convId=${encodeURIComponent(item.context.conversationId)}`
    if (item.context.orgSlug) return `/admin/org/${item.context.orgSlug}/messages?${query}`
    return `/portal/communications?${query}`
  }
  if (item.source.type === 'social-post') {
    if (socialActionStage(item) === 'qa') return `/portal/social/qa/${encodeURIComponent(item.source.id)}`
    if (item.context.orgSlug) return `/admin/org/${item.context.orgSlug}/social/${encodeURIComponent(item.source.id)}`
    return `/portal/social?postId=${encodeURIComponent(item.source.id)}`
  }
  if (item.context.contactId) return `/portal/crm/contacts/${encodeURIComponent(item.context.contactId)}`
  if (item.context.dealId) return `/portal/deals?dealId=${encodeURIComponent(item.context.dealId)}`
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
  return (item.source.type === 'activity' || item.source.type === 'contact' || item.source.type === 'deal')
    && Boolean(item.context.contactId || item.metadata?.contactId)
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

function briefingStateLabel(item: BriefingCard) {
  if (item.userState?.status === 'handled') return 'Marked reviewed'
  if (item.userState?.status === 'snoozed') return 'Snoozed'
  if (item.requiresAction) return 'Needs action'
  return 'Active'
}

function phase2StateChips(item: BriefingCard, mode: Mode) {
  const chips = [`State: ${briefingStateLabel(item)}`]
  if (reviewable(item)) chips.push('Review pending')
  if (approvalGateReviewable(item)) chips.push('Approval gate pending')
  if (documentReviewable(item)) chips.push('Document approval')
  if (canSocialPostAct(item) && socialActionStage(item)) chips.push(socialActionStage(item) === 'qa' ? 'QA approval' : 'Client approval')
  if (canAgentRunApprove(item, mode)) chips.push('Agent approval gate')
  if (canWorkspaceBrokerAct(item, mode)) chips.push('Workspace approval gate')
  if (canConvertToCrmActivity(item)) chips.push('CRM-ready')
  if (softwareBuildEvidenceRows(item).length) chips.push('Evidence attached')
  return chips
}

function phase2NextActionCopy(item: BriefingCard, mode: Mode) {
  if (reviewable(item)) return 'Next action: review the evidence, then approve the work or reject it back to the assigned agent.'
  if (approvalGateReviewable(item)) return 'Next action: approve the gate if the request is safe, or reject it with direction for the agent.'
  if (documentReviewable(item)) return 'Next action: approve the document, or request changes with a clear note.'
  if (canSocialPostAct(item) && socialActionStage(item)) return 'Next action: approve the content for its current review stage, or request changes without publishing.'
  if (canConvertToCrmActivity(item) || isContactableSource(item.source.type)) {
    const channels = briefingContactChannels(item)
    const person = briefingPersonName(item)
    if (channels.phone || channels.email) {
      return `Next action: call or email ${person ?? 'the contact'}, then log the next follow-up.`
    }
    if (isCrmRelationshipSource(item.source.type) || canConvertToCrmActivity(item)) {
      return 'Next action: convert this signal into a CRM activity or schedule the next follow-up task.'
    }
  }
  if (canAgentRunApprove(item, mode) || canWorkspaceBrokerAct(item, mode)) return 'Next action: review the approval request and only approve the scoped operation if it is safe.'
  if (canTaskAct(item)) return 'Next action: reply on the task, create a follow-up task, assign an agent, or snooze this signal.'
  return 'Next action: open the source for more context, create a follow-up task when supported, or snooze the card.'
}

function phase2AgentId(item: BriefingCard) {
  return briefingHandoffAgentId(item)
}

function phase2AgentLabel(item: BriefingCard) {
  const agentId = phase2AgentId(item)
  return agentId ? agentId.charAt(0).toUpperCase() + agentId.slice(1) : 'Specialist'
}

function canConvertToCrmActivity(item: BriefingCard) {
  return Boolean(item.context.contactId || item.metadata?.contactId)
}

function contractNearestValidActions(item: BriefingCard) {
  return (item.nearestValidActions ?? []).filter((action) => action.label?.trim())
}

function evidenceHref(item: BriefingCard, mode: Mode, portalScope?: PortalOrgRouteScope) {
  const evidence = softwareBuildEvidenceRows(item).find((row) => row.href)?.href
  return evidence || sourceHref(item, mode, portalScope)
}

function briefingActionEndpoint(item: BriefingCard) {
  return `/api/v1/briefings/items/${encodeURIComponent(item.id)}/actions`
}

function briefingActionSourcePayload(item: BriefingCard, mode: Mode, portalScope?: PortalOrgRouteScope) {
  return {
    orgId: item.orgId || item.context.orgId,
    context: item.context,
    source: { ...item.source, url: sourceHref(item, mode, portalScope) || item.source.url || undefined },
    metadata: item.metadata ?? {},
  }
}

function briefingProjectLine(item: BriefingCard) {
  if (!item.context.projectName && !item.context.projectId) return null
  return `Project: ${item.context.projectName ?? 'Unknown project'}${item.context.projectId ? ` (${item.context.projectId})` : ''}`
}

function briefingTaskLine(item: BriefingCard) {
  if (!item.context.taskTitle && !item.context.taskId) return null
  return `Task: ${item.context.taskTitle ?? 'Unknown task'}${item.context.taskId ? ` (${item.context.taskId})` : ''}`
}

function briefingEvidenceLines(item: BriefingCard) {
  const rows = softwareBuildEvidenceRows(item)
  if (rows.length === 0) return ['Evidence: none attached']
  return rows.map((row) => `${row.label}: ${row.href || row.value}`)
}

function briefingContextLines(item: BriefingCard, mode: Mode, portalScope?: PortalOrgRouteScope) {
  return [
    `Ask: ${item.title}`,
    item.summary ? `Summary: ${item.summary}` : null,
    item.excerpt ? `Excerpt: ${item.excerpt}` : null,
    item.context.orgName || item.context.orgId ? `Workspace: ${item.context.orgName ?? 'Unknown workspace'} (${item.context.orgId || item.orgId})` : null,
    briefingProjectLine(item),
    briefingTaskLine(item),
    item.context.documentTitle || item.context.documentId ? `Document: ${item.context.documentTitle ?? 'Unknown document'}${item.context.documentId ? ` (${item.context.documentId})` : ''}` : null,
    `Source: ${item.source.type}/${item.source.id}`,
    sourceHref(item, mode, portalScope) ? `Source URL: ${sourceHref(item, mode, portalScope)}` : null,
  ].filter((line): line is string => Boolean(line))
}

function briefingCopyText(item: BriefingCard, kind: 'exact-ask' | 'full-briefing' | 'agent-handoff' | 'blocker-summary' | 'evidence-links', mode: Mode, portalScope?: PortalOrgRouteScope) {
  const context = briefingContextLines(item, mode, portalScope)
  if (kind === 'exact-ask') return context.join('\n')
  if (kind === 'evidence-links') return briefingEvidenceLines(item).join('\n')
  if (kind === 'blocker-summary') {
    const blockers = softwareBuildEvidenceRows(item).filter((row) => row.kind === 'blocker').map((row) => `${row.label}: ${row.value}`)
    const gates = item.safetyGate?.gatedActions?.length ? [`Gated actions: ${item.safetyGate.gatedActions.join(', ')}`] : []
    return [...context, ...(blockers.length ? blockers : ['Blockers: none listed on this card']), ...gates, 'Approval gates remain explicit before external send, public publish, paid spend, production deploy, finance, secret/config, or destructive actions.'].join('\n')
  }
  if (kind === 'agent-handoff') {
    const target = item.agentHandoff?.targetAgentId || phase2AgentId(item)
    return [
      `Agent handoff target: ${target}`,
      ...context,
      item.agentHandoff?.summary ? `Handoff summary: ${item.agentHandoff.summary}` : null,
      ...briefingEvidenceLines(item),
    ].filter((line): line is string => Boolean(line)).join('\n')
  }
  return [...context, 'Evidence:', ...briefingEvidenceLines(item)].join('\n')
}


function defaultSnoozeDate() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
}

function formatSnoozeUntil(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'later'
  const sameDay = date.toDateString() === new Date().toDateString()
  const time = date.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false })
  return sameDay ? time : `${date.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`
}

export { canStopAgentRun, harvestPipDraft } from './deskHelpers'

type PipDraft = { conversationId: string; text: string; harvestedAt: number }

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
  const isDocumentSignal = item.source.type === 'client-document'
    || item.source.type === 'approval'
    || (item.source.type === 'notification'
      && Boolean(
        cleanText(item.context.documentId)
        || cleanText(item.context.documentTitle)
        || cleanText(item.metadata?.documentId)
        || cleanText(item.metadata?.documentTitle)
        || cleanText(item.metadata?.notificationType).startsWith('client_document.'),
      ))
  if (isDocumentSignal) row.documents += 1
  row.latestAt = Math.max(row.latestAt, new Date(item.occurredAt).getTime())
}

function accountPulseIdentity(item: BriefingCard): { id: string; name: string } {
  const companyName = cleanText(item.context.companyName) || cleanText(item.metadata?.company) || cleanText(item.metadata?.recipientCompanyName)
  const companyId = cleanText(item.context.companyId)
  if (companyName) return { id: `company-name:${slugKey(companyName)}`, name: companyName }
  if (companyId) return { id: `company-id:${companyId}`, name: `Company ${companyId}` }
  return { id: WORKSPACE_OPERATIONS_KEY, name: 'Workspace operations' }
}

export function BriefingControlDesk({ mode, portalScope, currentUser }: { mode: Mode; portalScope?: PortalOrgRouteScope; currentUser?: { uid: string; displayName: string } }) {
  const { orgs, orgId, setOrgId, priority, sourceType, feed, setFeed, selectedId, setSelectedId, loading, autoRefresh, setAutoRefresh, flash, setFlash, loadFeed } = useBriefingFeed(mode)
  const [accountPulseId, setAccountPulseId] = useState('')
  const [mobileLane, setMobileLane] = useState<BriefingWorkKind>('meeting')
  // Agent work is background movement; it starts folded so the desk opens on human work.
  const [collapsedLanes, setCollapsedLanes] = useState<Record<BriefingWorkKind, boolean>>(DEFAULT_COLLAPSED_LANES)
  const isDesktop = useIsDesktop()
  useEffect(() => {
    setCollapsedLanes(readCollapsedLanes())
  }, [])
  const [pinnedLane, setPinnedLane] = useState<BriefingWorkKind | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatSeedId, setChatSeedId] = useState<string | null>(null)
  const [pipDraft, setPipDraft] = useState<PipDraft | null>(null)
  const [expandedAgentGroups, setExpandedAgentGroups] = useState<Record<string, boolean>>({})
  const [refreshKey, setRefreshKey] = useState(0)
  const [showMoreActions, setShowMoreActions] = useState(false)
  const [snapshotting, setSnapshotting] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [socialChangeText, setSocialChangeText] = useState('')
  const [followUpText, setFollowUpText] = useState('')
  const [nextFollowUpTaskTitle, setNextFollowUpTaskTitle] = useState('')
  const [nextFollowUpTaskDueDate, setNextFollowUpTaskDueDate] = useState('')
  const [mailboxReplyText, setMailboxReplyText] = useState('')
  const [reportRecipients, setReportRecipients] = useState('')
  const [expenseReviewText, setExpenseReviewText] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('eft')
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentProofRejectReason, setPaymentProofRejectReason] = useState('')
  const [seoChangeText, setSeoChangeText] = useState('')
  const [seoTaskSkipReason, setSeoTaskSkipReason] = useState('')
  const [decisionChoices, setDecisionChoices] = useState<Record<string, string>>({})
  const [decisionOtherText, setDecisionOtherText] = useState<Record<string, string>>({})
  const [adCampaignChangeText, setAdCampaignChangeText] = useState('')
  const [busyAction, setBusyAction] = useState<string | null>(null)

  useEffect(() => {
    setAccountPulseId('')
  }, [mode, orgId])

  const allItems = useMemo(() => feed?.items ?? [], [feed?.items])
  const pulseScopedItems = useMemo(() => {
    if (mode !== 'portal' || !accountPulseId) return allItems
    return allItems.filter((item) => accountPulseIdentity(item).id === accountPulseId)
  }, [accountPulseId, allItems, mode])
  
  const laneItems = useMemo(() => {
    const buckets: Record<BriefingWorkKind, BriefingCard[]> = { meeting: [], reply: [], approval: [], agent: [], blocked: [] }
    for (const item of pulseScopedItems) buckets[resolveWorkKind(item)].push(item)
    return buckets
  }, [pulseScopedItems])

  // Agent work is one card per agent: a single agent with many runs collapses into one group.
  const agentGroups = useMemo(() => {
    const groups = new Map<string, { key: string; agentId: string; agentName: string; items: BriefingCard[] }>()
    for (const item of laneItems.agent) {
      const metaAgentId = typeof item.metadata?.agentId === 'string' ? item.metadata.agentId : null
      const agentId = (item.actor?.type === 'agent' ? item.actor.id.replace(/^agent:/, '') : null) ?? metaAgentId ?? item.actor?.id ?? 'unknown'
      const agentName = item.actor?.name || (agentId.charAt(0).toUpperCase() + agentId.slice(1))
      const key = `${item.orgId || item.context.orgId || ''}:${agentId}`
      const existing = groups.get(key)
      if (existing) existing.items.push(item)
      else groups.set(key, { key, agentId, agentName, items: [item] })
    }
    return [...groups.values()].sort((a, b) => b.items.length - a.items.length)
  }, [laneItems.agent])

  const laneCounts = useMemo(() => ({
    meeting: laneItems.meeting.length,
    reply: laneItems.reply.length,
    approval: laneItems.approval.length,
    agent: laneItems.agent.length,
    blocked: laneItems.blocked.length,
  }), [laneItems])

  const selected = pulseScopedItems.find((item) => item.id === selectedId) ?? null
  const selectedReviewCard = selected ? agentOutputReviewCard(selected) : null
  const selectedLearningReview = selected ? agentLearningReviewCard(selected) : null
  const chatSeedItem = chatSeedId ? allItems.find((item) => item.id === chatSeedId) ?? null : null

  // Bump the Today rail (calendar + inbox) whenever the feed refreshes.
  const generatedAt = feed?.generatedAt ?? null
  useEffect(() => {
    if (!generatedAt) return
    setRefreshKey((value) => value + 1)
  }, [generatedAt])

  // Work lane for the selected item
  const selectedKind = selected ? resolveWorkKind(selected) : null

  function selectLane(kind: BriefingWorkKind) {
    setMobileLane(kind)
    setPinnedLane((current) => (current === kind ? null : kind))
    setCollapsedLanes((current) => (current[kind] ? { ...current, [kind]: false } : current))
    if (typeof document !== 'undefined') {
      document.getElementById(`briefing-lane-${kind}`)?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
    }
  }

  function toggleLaneCollapsed(kind: BriefingWorkKind) {
    setCollapsedLanes((current) => {
      const next = { ...current, [kind]: !current[kind] }
      writeCollapsedLanes(next)
      return next
    })
  }

  function askPip(item: BriefingCard) {
    setChatSeedId(item.id)
    setChatOpen(true)
  }

  // When Pip finishes a turn in the dock, keep her reply handy as a one-click draft for the reply box.
  function handleChatLifecycle(event: { conversationId: string; phase: 'running' | 'completed' | 'idle' }) {
    if (event.phase !== 'completed') return
    void harvestPipDraft(event.conversationId).then((text) => {
      if (!text) return
      setPipDraft({ conversationId: event.conversationId, text, harvestedAt: Date.now() })
    }).catch(() => { /* draft harvesting is best-effort */ })
  }

  function adoptPipDraft(setter: (value: string) => void) {
    if (!pipDraft) return
    setter(pipDraft.text)
    setFlash({ kind: 'ok', message: "Pip's draft copied into the reply box. Edit before sending." })
  }

  function pipDraftButton(setter: (value: string) => void) {
    if (!pipDraft) return null
    return (
      <button type="button" className="pib-btn-secondary mt-2 w-full justify-center text-xs" onClick={() => adoptPipDraft(setter)} title={pipDraft.text.slice(0, 200)}>
        <Icon name="smart_toy" />
        Use Pip&apos;s draft
      </button>
    )
  }

  /** Busy blocks for a calendar day, used by the Book call picker to flag conflicts. */
  async function loadBusy(dateYmd: string): Promise<BusyBlock[]> {
    const params = new URLSearchParams({ date: dateYmd })
    const scopedOrg = orgId || portalScope?.orgId
    if (scopedOrg) params.set('orgId', scopedOrg)
    const res = await fetch(`/api/v1/workspace/calendar/today?${params.toString()}`)
    if (!res.ok) return []
    const body = await res.json().catch(() => null) as { data?: unknown } | null
    const data = body?.data
    const rows = Array.isArray(data)
      ? data
      : data && typeof data === 'object' && Array.isArray((data as { meetings?: unknown }).meetings)
        ? (data as { meetings: unknown[] }).meetings
        : data && typeof data === 'object' && Array.isArray((data as { events?: unknown }).events)
          ? (data as { events: unknown[] }).events
          : []
    return rows.flatMap((row) => {
      const event = row as { start?: unknown; end?: unknown; title?: unknown; summary?: unknown; allDay?: unknown; busy?: unknown }
      if (typeof event.start !== 'string' || typeof event.end !== 'string') return []
      if (event.allDay === true || event.busy === false) return []
      const title = typeof event.title === 'string' ? event.title : typeof event.summary === 'string' ? event.summary : null
      return [{ start: event.start, end: event.end, title }]
    })
  }

  async function stopAgentRun(item: BriefingCard) {
    if (!canStopAgentRun(item, mode)) return
    const runId = item.context.agentRunId ?? String(item.metadata?.hermesRunId ?? '')
    const runOrgId = item.orgId || item.context.orgId
    setBusyAction('stop-run')
    try {
      const res = await fetch(`/api/v1/admin/hermes/profiles/${encodeURIComponent(runOrgId)}/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Stop run failed')
      setFlash({ kind: 'ok', message: `Stop requested for ${item.actor?.name ?? 'the agent'}.` })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Stop run failed' })
    } finally {
      setBusyAction(null)
    }
  }

  function selectedDecisionOptionId(item: BriefingCard) {
    return decisionChoices[item.id]
      || item.recommendedOption?.id
      || item.options?.find((option) => option.recommended && !option.disabled)?.id
      || item.options?.find((option) => !option.disabled)?.id
      || ''
  }

  function selectedDecisionOption(item: BriefingCard) {
    const optionId = selectedDecisionOptionId(item)
    return item.options?.find((option) => option.id === optionId) ?? null
  }

  function decisionSubmitAction(item: BriefingCard): 'handled' | 'pending-review' | 'follow-up-created' {
    const nextStatus = item.afterSubmit?.nextStatus
    if (nextStatus === 'pending-review' || nextStatus === 'follow-up-created') return nextStatus
    return 'handled'
  }

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

  async function setItemState(item: BriefingCard, action: 'handled' | 'snoozed' | 'active', snoozedUntil?: string) {
    setBusyAction(action)
    try {
      const until = action === 'snoozed' ? (snoozedUntil ?? defaultSnoozeDate()) : undefined
      const res = await fetch(`/api/v1/briefings/items/${encodeURIComponent(item.id)}/state`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orgId: item.orgId || item.context.orgId,
          action,
          snoozedUntil: until,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'State update failed')
      setFeed((current) => current ? { ...current, items: current.items.filter((row) => row.id !== item.id), total: Math.max(0, current.total - 1) } : current)
      setFlash({
        kind: 'ok',
        message: action === 'snoozed'
          ? (snoozedUntil ? `Snoozed until ${formatSnoozeUntil(snoozedUntil)}.` : 'Snoozed for 24 hours.')
          : action === 'handled' ? 'Marked handled.' : 'Returned to active.',
      })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'State update failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function submitInlineDecision(item: BriefingCard) {
    const option = selectedDecisionOption(item)
    if (!item.decisionRequest || !item.inputTarget || !item.afterSubmit || !option) return
    const otherText = decisionOtherText[item.id]?.trim() ?? ''
    if (option.id === 'other' && !otherText) {
      setFlash({ kind: 'error', message: 'Add the custom keyword/theme before submitting Other.' })
      return
    }
    const action = decisionSubmitAction(item)
    setBusyAction('submit-decision')
    try {
      const res = await fetch(`/api/v1/briefings/items/${encodeURIComponent(item.id)}/state`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orgId: item.orgId || item.context.orgId || item.inputTarget.orgId,
          action,
          note: option.id === 'other' ? `Decision submitted: ${option.label}. Other: ${otherText}` : `Decision submitted: ${option.label}`,
          approvalState: 'decision_submitted',
          approvalCopy: item.afterSubmit.consequence,
          decisionSubmission: {
            optionId: option.id,
            optionLabel: option.label,
            otherText: option.id === 'other' ? otherText : null,
            decisionRequest: item.decisionRequest,
            inputTarget: item.inputTarget,
            afterSubmit: item.afterSubmit,
            agentHandoff: item.agentHandoff ?? null,
            safetyGate: item.safetyGate ?? null,
            sideEffectPerformed: false,
            noSideEffectCopy: 'No publish, send, spend, deploy, finance, secret/config, or destructive action was performed.',
          },
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Decision submission failed')
      setFeed((current) => current ? { ...current, items: current.items.filter((row) => row.id !== item.id), total: Math.max(0, current.total - 1) } : current)
      setDecisionOtherText((current) => ({ ...current, [item.id]: '' }))
      setFlash({ kind: 'ok', message: item.afterSubmit.releasesAgentId ? `Choice submitted. ${item.afterSubmit.releasesAgentId} can continue from the auditable handoff.` : 'Choice submitted and recorded for audit.' })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Decision submission failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function approvePhase2Item(item: BriefingCard) {
    if (reviewable(item)) {
      await taskPatch(item, { reviewStatus: 'approved', columnId: 'done', agentStatus: 'done' }, 'Approved and moved to done.')
      return
    }
    if (approvalGateReviewable(item)) {
      await taskPatch(item, { reviewStatus: 'approved', approvalStatus: 'approved', columnId: 'done', agentStatus: 'done' }, 'Approval gate approved.')
      return
    }
    if (documentReviewable(item)) {
      await approveDocument(item)
      return
    }
    if (canSocialPostAct(item) && socialActionStage(item)) {
      await socialPostAction(item, 'approve')
      return
    }
    await setItemState(item, 'handled')
  }

  async function rejectPhase2Item(item: BriefingCard) {
    if (reviewable(item)) {
      await taskPatch(item, { reviewStatus: 'changes-requested', agentStatus: 'pending', columnId: 'todo' }, 'Sent back to the assigned agent.')
      return
    }
    if (approvalGateReviewable(item)) {
      await taskPatch(item, { reviewStatus: 'changes-requested', approvalStatus: 'rejected', agentStatus: 'pending', columnId: 'todo' }, 'Approval gate rejected and sent back.')
      return
    }
    if (documentReviewable(item)) {
      await requestDocumentChanges(item)
      return
    }
    if (canSocialPostAct(item) && socialActionStage(item) && socialChangeText.trim()) {
      await socialPostAction(item, 'reject')
    }
  }

  async function createPhase2Task(item: BriefingCard) {
    const title = `Follow up: ${item.title}`
    const payload = {
      action: 'create-task',
      ...briefingActionSourcePayload(item, mode, portalScope),
      title,
      description: item.summary,
      spec: item.summary,
      priority: item.priority === 'critical' ? 'high' : 'medium',
      sourceTitle: item.title,
    }
    setBusyAction('phase2-create-task')
    try {
      const res = await fetch(briefingActionEndpoint(item), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Follow-up task creation failed')
      setFlash({ kind: 'ok', message: 'Follow-up task created from the briefing.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Follow-up task creation failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function copyBriefingAction(item: BriefingCard, kind: 'exact-ask' | 'full-briefing' | 'agent-handoff' | 'blocker-summary' | 'evidence-links') {
    try {
      await navigator.clipboard.writeText(briefingCopyText(item, kind, mode, portalScope))
      setFlash({ kind: 'ok', message: 'Briefing context copied.' })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Clipboard copy failed' })
    }
  }

  async function createRoutedBriefingTask(item: BriefingCard, action: 'ask-specialist-triage' | 'create-routed-task' | 'link-existing-task') {
    const agentId = phase2AgentId(item)
    const isTriage = action === 'ask-specialist-triage'
    const title = action === 'link-existing-task'
      ? `Link existing task: ${item.title}`
      : isTriage
        ? `Triage briefing: ${item.title}`
        : `Routed ${agentId} task: ${item.title}`
    setBusyAction(`phase2-${action}`)
    try {
      const res = await fetch(briefingActionEndpoint(item), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          ...briefingActionSourcePayload(item, mode, portalScope),
          title,
          description: item.summary,
          spec: `${title}\n\n${briefingCopyText(item, 'full-briefing', mode, portalScope)}`,
          priority: item.priority === 'critical' ? 'high' : 'medium',
          assigneeAgentId: agentId,
          labels: ['briefing-action', action, 'internal-only'],
          sourceTitle: item.title,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Routed briefing task creation failed')
      setFlash({ kind: 'ok', message: isTriage ? `${agentId} triage task created from the briefing.` : 'Routed internal task created from the briefing.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Routed briefing task creation failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function assignPhase2Agent(item: BriefingCard) {
    if (!canTaskAct(item)) return
    const agentId = phase2AgentId(item)
    setBusyAction('phase2-assign-agent')
    try {
      const res = await fetch(briefingActionEndpoint(item), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'assign-agent',
          ...briefingActionSourcePayload(item, mode, portalScope),
          title: `Assign ${agentId}: ${item.title}`,
          spec: item.summary,
          assigneeAgentId: agentId,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Agent assignment failed')
      setFlash({ kind: 'ok', message: `Assigned ${agentId} to the source task.` })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Agent assignment failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function convertToCrmActivity(item: BriefingCard) {
    const contactId = typeof item.context.contactId === 'string' && item.context.contactId
      ? item.context.contactId
      : typeof item.metadata?.contactId === 'string' ? item.metadata.contactId : ''
    const dealId = typeof item.context.dealId === 'string' && item.context.dealId
      ? item.context.dealId
      : typeof item.metadata?.dealId === 'string' ? item.metadata.dealId : ''
    if (!contactId && !dealId) return
    setBusyAction('phase2-crm-activity')
    try {
      const res = await fetch(briefingActionEndpoint(item), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'create-crm-activity',
          ...briefingActionSourcePayload(item, mode, portalScope),
          contactId,
          dealId,
          summary: `Follow up: ${item.summary}`,
          crmActivityInternalOnly: true,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'CRM activity conversion failed')
      setFlash({ kind: 'ok', message: 'Briefing converted to a CRM activity.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'CRM activity conversion failed' })
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

  function canAddMeetLink(item: BriefingCard) {
    if (item.source.type !== 'booking' || !bookingActionable(item, mode)) return false
    const status = typeof item.metadata?.bookingStatus === 'string' ? item.metadata.bookingStatus : typeof item.metadata?.status === 'string' ? item.metadata.status : ''
    return status === 'confirmed' || /needs meet link/i.test(item.title)
  }

  async function addMeetLink(item: BriefingCard) {
    if (!canAddMeetLink(item)) return
    setBusyAction('booking-repair')
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(item.source.id)}/repair`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not create the Meet link')
      const errors = Array.isArray(body.errors) ? body.errors : []
      setFlash(errors.length
        ? { kind: 'error', message: `Booking repaired with warnings: ${errors.join('; ')}` }
        : { kind: 'ok', message: 'Calendar event and Meet link created for the booking.' })
      await loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Could not create the Meet link' })
    } finally {
      setBusyAction(null)
    }
  }

  function canBookCall(item: BriefingCard) {
    if (!['contact', 'deal', 'activity', 'enquiry', 'form-submission'].includes(item.source.type)) return false
    const contactId = typeof item.context.contactId === 'string' ? item.context.contactId : typeof item.metadata?.contactId === 'string' ? item.metadata.contactId : ''
    return Boolean(contactId) && Boolean(briefingContactChannels(item).email)
  }

  async function bookCall(item: BriefingCard, input: BookCallInput) {
    if (!canBookCall(item)) return
    const contactId = (typeof item.context.contactId === 'string' && item.context.contactId) || String(item.metadata?.contactId ?? '')
    const scopeOrgId = item.context.orgId || item.orgId || orgId
    setBusyAction('book-call')
    try {
      const query = scopeOrgId ? `?orgId=${encodeURIComponent(scopeOrgId)}` : ''
      const res = await fetch(`/api/v1/crm/contacts/${encodeURIComponent(contactId)}/schedule-meeting${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          startAt: input.startAt,
          endAt: input.endAt,
          title: input.title,
          description: `Booked from Briefings: ${item.title}`,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Johannesburg',
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not book the call')
      setFlash({ kind: 'ok', message: `Call booked with ${briefingPersonName(item) || 'the contact'}. Invite sent.` })
      await setItemState(item, 'handled')
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Could not book the call' })
      throw err
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
      await createNextFollowUpTask(item, { contactId, dealId, summary })
      setFollowUpText('')
      setNextFollowUpTaskTitle('')
      setNextFollowUpTaskDueDate('')
      setFlash({
        kind: 'ok',
        message: nextFollowUpTaskTitle.trim()
          ? 'Follow-up note logged and next task scheduled.'
          : 'Follow-up note logged to the CRM contact.',
      })
      void loadFeed({ quiet: true })
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Follow-up note failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function createNextFollowUpTask(
    item: BriefingCard,
    input: { contactId: string; dealId: string; summary: string },
  ) {
    const title = nextFollowUpTaskTitle.trim()
    if (!title) return

    const orgId = typeof item.orgId === 'string' && item.orgId
      ? item.orgId
      : typeof item.context.orgId === 'string' ? item.context.orgId : ''
    if (!orgId) throw new Error('Workspace is required to schedule the next task')

    const res = await fetch('/api/v1/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgId,
        title,
        description: input.summary,
        status: 'todo',
        priority: 'normal',
        dueDate: nextFollowUpTaskDueDate || null,
        contactId: input.contactId,
        dealId: input.dealId,
        tags: ['crm-follow-up'],
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || 'Next task scheduling failed')
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

      await createNextFollowUpTask(item, {
        contactId,
        dealId: typeof item.context.dealId === 'string' ? item.context.dealId : '',
        summary,
      })
      setFollowUpText('')
      setNextFollowUpTaskTitle('')
      setNextFollowUpTaskDueDate('')
      setFlash({
        kind: 'ok',
        message: nextFollowUpTaskTitle.trim()
          ? 'Contact follow-up logged, cleared, and next task scheduled.'
          : 'Contact follow-up logged and cleared.',
      })
      void loadFeed({ quiet: true })
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
        ? { action: ['convert', 'to', 'invoice'].join('-') }
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

  async function broadcastAction(item: BriefingCard, action: 'pause' | 'resume') {
    if (!canBroadcastAct(item)) return
    if (action === 'pause' && !broadcastPausable(item)) return
    if (action === 'resume' && !broadcastResumable(item)) return
    setBusyAction(`broadcast-${action}`)
    try {
      const res = await fetch(`/api/v1/broadcasts/${encodeURIComponent(item.source.id)}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Broadcast action failed')
      const message = action === 'pause'
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

  const cardActions: BriefingCardActions = {
    mode,
    busy: Boolean(busyAction),
    select: (item) => setSelectedId(item.id),
    openMore: (item) => {
      setSelectedId(item.id)
      setShowMoreActions(true)
    },
    snooze: (item) => { void setItemState(item, 'snoozed') },
    snoozeUntil: (item, untilIso) => { void setItemState(item, 'snoozed', untilIso) },
    canStopRun: (item) => canStopAgentRun(item, mode),
    stopRun: (item) => { void stopAgentRun(item) },
    loadBusy,
    done: (item) => { void setItemState(item, 'handled') },
    sourceHref: (item) => (mode === 'admin' ? adminSourceHref(item) : sourceHref(item, mode, portalScope)) ?? null,
    askPip,
    canApprove: (item) => reviewable(item) || approvalGateReviewable(item) || documentReviewable(item) || (canSocialPostAct(item) && Boolean(socialActionStage(item))),
    approve: (item) => { void approvePhase2Item(item) },
    sendBack: (item) => {
      if (reviewable(item) || approvalGateReviewable(item) || documentReviewable(item)) {
        void rejectPhase2Item(item)
        return
      }
      setSelectedId(item.id)
      setShowMoreActions(true)
    },
    canUnblock: (item) => canTaskUnblock(item),
    unblock: (item) => { void unblockTask(item) },
    canAssignAgent: (item) => canTaskAct(item),
    assignAgent: (item) => { void assignPhase2Agent(item) },
    agentLabel: (item) => phase2AgentLabel(item),
    createFollowUp: (item) => { void createPhase2Task(item) },
    canAddMeetLink,
    addMeetLink: (item) => { void addMeetLink(item) },
    canBookCall,
    bookCall,
  }

  const rail = (
    <TodayRail
      mode={mode}
      orgId={orgId || portalScope?.orgId || undefined}
      portalScope={portalScope}
      laneCounts={laneCounts}
      activeLane={pinnedLane}
      onSelectLane={selectLane}
      autoRefresh={autoRefresh}
      onToggleLive={() => setAutoRefresh((value) => !value)}
      onSnapshot={() => { void createSnapshot() }}
      snapshotting={snapshotting}
      refreshKey={refreshKey}
    />
  )

  const workFeedContent = (
    <div className="flex h-full min-h-0 w-full flex-col gap-2 text-[var(--color-pib-text)]">
        {flash ? (
          <div
            role="status"
            className={`pointer-events-auto fixed bottom-4 right-4 z-[60] max-w-sm rounded-lg border px-4 py-3 text-sm shadow-lg ${flash.kind === 'ok' ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-100' : 'border-red-400/40 bg-red-500/10 text-red-700 dark:text-red-100'}`}
          >
            <div className="flex items-start gap-2">
              <span className="min-w-0 flex-1">{flash.message}</span>
              <button type="button" aria-label="Dismiss message" className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100" onClick={() => setFlash(null)}>
                <Icon name="close" />
              </button>
            </div>
          </div>
        ) : null}

        {mode === 'admin' ? (
          <section className="flex h-8 shrink-0 items-center gap-1.5" aria-label="Workspace">
            <label className="sr-only" htmlFor="briefing-workspace-filter">Workspace</label>
            <select id="briefing-workspace-filter" aria-label="Workspace" className="h-7 max-w-52 rounded-md border border-[var(--color-pib-line)] bg-transparent px-2 text-xs text-[var(--color-pib-text)]" value={orgId} onChange={(event) => setOrgId(event.target.value)}>
              <option value="">All visible workspaces</option>
              {orgs.map((org) => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
          </section>
        ) : null}

        <section className="flex h-8 shrink-0 min-w-0 items-center gap-1 overflow-x-auto" aria-label={mode === 'portal' ? 'Account pulse' : 'Workspace pulse'}>
          <div className="sr-only">
              <p>{mode === 'portal' ? 'Account pulse' : 'Workspace pulse'}</p>
              <p>
                {mode === 'portal'
                  ? 'Jump between CRM companies and workspace operations by action pressure, blockers, approvals, and agent signals.'
                  : 'Jump between organisations by action pressure, blockers, document approvals, and agent signals.'}
              </p>
          </div>
            {pulseSelectionId ? (
              <button type="button" className="h-7 shrink-0 rounded border border-[var(--color-pib-line)] px-2.5 text-[11px] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]" onClick={clearPulseSelection}>
                {mode === 'portal' ? 'All accounts' : 'All workspaces'}
              </button>
            ) : null}
          <div className="flex min-w-0 items-center gap-1">
            {pulseRows.length === 0 ? (
              <div className="px-2 text-xs text-[var(--color-pib-text-muted)]">
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
                className={`flex h-7 shrink-0 items-center gap-1.5 rounded border px-2.5 text-[11px] transition ${pulseSelectionId === row.id ? 'border-primary/30 bg-primary/10 text-primary' : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]'}`}
              >
                <span className="max-w-40 truncate">{row.name}</span>
                <span className={row.action > 0 ? 'text-[var(--sc-ink-soft)]' : 'text-emerald-300'}>{row.action}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Mobile: filter to one work lane so cards stay visible */}
        <nav
          aria-label="Briefings work lanes"
          className="grid shrink-0 grid-cols-5 gap-1 rounded-[6px] border border-[var(--color-pib-line)] bg-[var(--color-card)]/65 p-1 lg:hidden"
        >
          {BRIEFING_WORK_LANES.map((lane) => {
            const count = laneCounts[lane.id]
            const isSelected = mobileLane === lane.id
            return (
              <button
                key={lane.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setMobileLane(lane.id)}
                title={lane.label}
                className={`flex h-9 min-w-0 flex-col items-center justify-center rounded-lg px-1 text-[10px] font-medium leading-3 transition ${
                  isSelected
                    ? 'bg-[var(--color-row-hover)] text-[var(--color-pib-text)]'
                    : 'text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]'
                }`}
              >
                <span className="flex items-center gap-1">
                  <Icon name={lane.icon} className="text-[14px]" />
                  <span className="tabular-nums">{count}</span>
                </span>
                <span className="truncate">{lane.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Work lanes  -  one lane on mobile, a scroll-snap row of columns on desktop */}
        <section aria-label="Daily briefings desk" className="flex min-h-0 min-w-0 flex-1 gap-2 overflow-x-auto overflow-y-hidden lg:snap-x lg:snap-mandatory">
          {BRIEFING_WORK_LANES.map((lane) => {
            const items = laneItems[lane.id]
            const showOnMobile = mobileLane === lane.id
            const collapsed = isDesktop && collapsedLanes[lane.id]
            const pinned = pinnedLane === lane.id
            const accent = accentForLane(lane.id)
            if (collapsed) {
              return (
                <button
                  key={lane.id}
                  id={`briefing-lane-${lane.id}`}
                  type="button"
                  onClick={() => toggleLaneCollapsed(lane.id)}
                  aria-expanded={false}
                  aria-label={`Expand ${lane.label} lane (${items.length})`}
                  className={`${showOnMobile ? 'flex' : 'hidden'} h-full w-12 shrink-0 snap-start flex-col items-center gap-2 rounded-[6px] border border-[var(--color-pib-line)] bg-[var(--color-card)]/45 py-3 text-[var(--color-pib-text-muted)] transition hover:bg-[var(--color-pib-surface-muted)] hover:text-[var(--color-pib-text)] lg:flex`}
                >
                  <span style={{ color: accent }} className="grid place-items-center"><Icon name={lane.icon} className="text-[16px]" /></span>
                  <span className="rounded bg-[var(--color-pib-surface-muted)] px-1.5 py-0.5 text-[11px] tabular-nums text-[var(--color-pib-text)]">{items.length}</span>
                  <span className="mt-1 text-[11px] font-medium [writing-mode:vertical-rl]">{lane.label}</span>
                  <Icon name="unfold_more" className="mt-auto text-[16px]" />
                </button>
              )
            }
            return (
              <div
                key={lane.id}
                id={`briefing-lane-${lane.id}`}
                data-testid={`briefing-lane-${lane.id}`}
                className={`${showOnMobile ? 'flex' : 'hidden'} h-full min-h-0 w-full shrink-0 snap-start flex-col rounded-[6px] border bg-[var(--color-card)]/45 lg:flex lg:w-[min(100%,320px)] lg:flex-1 lg:basis-72 ${pinned ? 'border-primary/40' : 'border-[var(--color-pib-line)]'}`}
              >
                {/* Column header */}
                <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--color-pib-line)] px-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span style={{ color: accent }} className="grid place-items-center"><Icon name={lane.icon} className="text-[16px]" /></span>
                    <span className="truncate text-sm font-medium text-[var(--color-pib-text)]" title={lane.description}>{lane.label}</span>
                    <span className="rounded bg-[var(--color-pib-surface-muted)] px-2 py-0.5 text-[11px] tabular-nums text-[var(--color-pib-text-muted)]">{items.length}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleLaneCollapsed(lane.id)}
                    aria-label={`Collapse ${lane.label} lane`}
                    className="hidden rounded p-1 text-[var(--color-pib-text-muted)] transition hover:bg-[var(--color-pib-surface-muted)] hover:text-[var(--color-pib-text)] lg:grid"
                  >
                    <Icon name="unfold_less" className="text-[16px]" />
                  </button>
                </div>

                {/* Cards in this column */}
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
                  {loading ? (
                    <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-card)] p-4 text-center text-xs text-[var(--color-pib-text-muted)]">Loading…</div>
                  ) : items.length === 0 ? (
                    <LaneEmptyState kind={lane.id} />
                  ) : lane.id === 'agent' ? (
                    agentGroups.map((group) => group.items.length === 1 ? (
                      <BriefingCardForKind key={group.items[0].id} item={group.items[0]} kind="agent" actions={cardActions} />
                    ) : (
                      <AgentGroupCard
                        key={group.key}
                        agentId={group.agentId}
                        agentName={group.agentName}
                        items={group.items}
                        actions={cardActions}
                        expanded={expandedAgentGroups[group.key] ?? group.items.length <= 3}
                        onToggle={() => setExpandedAgentGroups((current) => ({ ...current, [group.key]: !(current[group.key] ?? group.items.length <= 3) }))}
                      />
                    ))
                  ) : (
                    items.map((item) => (
                      <BriefingCardForKind key={item.id} item={item} kind={lane.id} actions={cardActions} />
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </section>

        {/* Detail panel modal for selected item */}
        {selected ? (
          <div className="fixed inset-0 z-50 flex items-start justify-end bg-[color-mix(in_srgb,var(--sc-ink)_50%,transparent)] pt-16" onClick={() => setSelectedId(null)}>
            <aside 
              className="h-full w-full max-w-2xl overflow-y-auto border-l border-[var(--color-pib-line)] bg-[var(--color-card)]" 
              onClick={(e) => e.stopPropagation()}
              aria-label="Selected briefing detail panel"
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--color-pib-line)] bg-[var(--color-card)] px-4 py-3">
                <p className="sc-tiny !text-[10px] text-brand">Detail panel</p>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  aria-label="Close detail panel"
                  className="rounded-md p-1 text-[var(--color-pib-text-muted)] transition hover:bg-[var(--color-pib-surface-muted)] hover:text-[var(--color-pib-text)]"
                >
                  <Icon name="close" />
                </button>
              </div>
              <div className="p-4 sm:p-5 space-y-5">
                  <h2 data-testid="selected-briefing-title" className="break-words text-xl text-[var(--color-pib-text)]">{selected.title}</h2>
                  {(() => {
                    const summary = briefingUsefulSummary(selected)
                    const fallback = humanReadableCopy(selected.excerpt || selected.summary)
                    const copy = humanReadableCopy(summary && !selected.title.includes(summary) ? summary : fallback)
                    if (!copy || copy === selected.title) return null
                    return (
                      <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                        {copy}
                        {viewHrefFromCopy(selected.excerpt || selected.summary) || viewHrefFromCopy(selected.summary) ? (
                          <>
                            {' '}
                            <a
                              className="font-medium text-[var(--color-accent-text)] underline underline-offset-4"
                              href={(viewHrefFromCopy(selected.excerpt || selected.summary) || viewHrefFromCopy(selected.summary)) ?? undefined}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              View
                            </a>
                          </>
                        ) : null}
                      </p>
                    )
                  })()}

                {briefingDisplayFacts(selected).length ? (
                  <div className="rounded-lg border border-[var(--color-accent-v2)]/35 bg-[var(--color-accent-subtle)] p-3" aria-label="Card details">
                    <p className="text-xs uppercase tracking-[0.16em] text-brand">This card</p>
                    <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {briefingDisplayFacts(selected).map((fact) => (
                        <div key={fact.id} className="min-w-0">
                          <dt className="sr-only">{fact.label}</dt>
                          <dd className="break-words text-sm text-[var(--color-pib-text)]">
                            <span className="text-[var(--color-pib-text-muted)]">{fact.label}: </span>
                            {fact.href ? (
                              <a className="underline underline-offset-2" href={fact.href}>{fact.value}</a>
                            ) : fact.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {isContactableSource(selected.source.type) || briefingHasContactChannel(selected) ? (
                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {briefingContactChannels(selected).email ? (
                          <a href={`mailto:${briefingContactChannels(selected).email}`} className="pib-btn-secondary min-w-0 justify-center px-3 py-2.5 text-xs">
                            <Icon name="mail" />
                            Email {briefingPersonName(selected) || 'contact'}
                          </a>
                        ) : null}
                        {briefingContactChannels(selected).phone ? (
                          <a href={`tel:${briefingContactChannels(selected).phone}`} className="pib-btn-secondary min-w-0 justify-center px-3 py-2.5 text-xs">
                            <Icon name="call" />
                            Call {briefingPersonName(selected) || 'contact'}
                          </a>
                        ) : null}
                        <button
                          type="button"
                          className="pib-btn-secondary min-w-0 justify-center px-3 py-2.5 text-xs"
                          onClick={() => selected.context.projectId
                            ? createRoutedBriefingTask(selected, 'ask-specialist-triage')
                            : copyBriefingAction(selected, 'agent-handoff')}
                          disabled={!!busyAction}
                        >
                          <Icon name="smart_toy" />
                          Hand off to {phase2AgentLabel(selected)}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* Primary actions - context-aware based on current stack */}
                <div className="space-y-2" aria-label="Primary actions">
                  {(selectedKind === 'meeting' || briefingHasContactChannel(selected)) && (briefingContactChannels(selected).email || briefingContactChannels(selected).phone) ? (
                    <div className="grid grid-cols-2 gap-2">
                      {briefingContactChannels(selected).phone ? (
                        <a href={`tel:${briefingContactChannels(selected).phone}`} className="pib-btn-primary min-w-0 justify-center px-3 py-2.5 text-xs">
                          <Icon name="call" />
                          Call
                        </a>
                      ) : null}
                      {briefingContactChannels(selected).email ? (
                        <a href={`mailto:${briefingContactChannels(selected).email}`} className="pib-btn-primary min-w-0 justify-center px-3 py-2.5 text-xs">
                          <Icon name="mail" />
                          Email
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                  
                  {selectedKind === 'blocked' || selectedKind === 'approval' ? (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        className="pib-btn-primary min-w-0 justify-center px-3 py-2.5 text-xs"
                        onClick={() => (reviewable(selected) || approvalGateReviewable(selected) || documentReviewable(selected)) ? approvePhase2Item(selected) : unblockTask(selected)}
                        disabled={!!busyAction}
                      >
                        <Icon name={reviewable(selected) || approvalGateReviewable(selected) || documentReviewable(selected) ? 'verified' : 'play_arrow'} />
                        {reviewable(selected) || approvalGateReviewable(selected) || documentReviewable(selected) ? 'Approve' : 'Unblock'}
                      </button>
                      {(mode === 'admin' ? adminSourceHref(selected) : sourceHref(selected, mode, portalScope)) ? (
                        <a className="pib-btn-secondary min-w-0 justify-center px-3 py-2.5 text-xs" href={(mode === 'admin' ? adminSourceHref(selected) : sourceHref(selected, mode, portalScope)) ?? undefined} target="_blank" rel="noopener noreferrer">
                          <Icon name="open_in_new" />
                          Open
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                  
                  {selectedKind === 'reply' || selectedKind === 'agent' || selectedKind === 'meeting' ? (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        className="pib-btn-primary min-w-0 justify-center px-3 py-2.5 text-xs"
                        onClick={() => setItemState(selected, 'handled')}
                        disabled={!!busyAction}
                      >
                        <Icon name="done" />
                        Done
                      </button>
                      {(mode === 'admin' ? adminSourceHref(selected) : sourceHref(selected, mode, portalScope)) ? (
                        <a className="pib-btn-secondary min-w-0 justify-center px-3 py-2.5 text-xs" href={(mode === 'admin' ? adminSourceHref(selected) : sourceHref(selected, mode, portalScope)) ?? undefined} target="_blank" rel="noopener noreferrer">
                          <Icon name="open_in_new" />
                          Open
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                  
                  {/* Universal secondary action */}
                  <button type="button" className="pib-btn-secondary w-full min-w-0 justify-center px-3 py-2 text-xs" onClick={() => setItemState(selected, 'snoozed')} disabled={!!busyAction}>
                    <Icon name="snooze" />
                    Later
                  </button>
                  
                  {/* Toggle for more actions */}
                  <button
                    type="button"
                    onClick={() => setShowMoreActions(!showMoreActions)}
                    className="flex w-full items-center justify-center gap-1 rounded-md border border-[var(--color-pib-line)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-[var(--color-pib-surface-muted)] hover:text-[var(--color-pib-text)]"
                  >
                    <span>{showMoreActions ? 'Less' : 'More'}</span>
                    <Icon name={showMoreActions ? 'expand_less' : 'expand_more'} />
                  </button>
                </div>

                {/* Kitchen sink actions - behind More toggle */}
                {showMoreActions ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Additional actions">
                    {selected.context.projectId ? (
                      <button
                        type="button"
                        className="pib-btn-secondary min-w-0 justify-center px-3 py-2 text-xs"
                        onClick={() => createRoutedBriefingTask(selected, 'ask-specialist-triage')}
                        disabled={!!busyAction}
                        title={`Send this briefing to ${phase2AgentLabel(selected)}`}
                      >
                        <Icon name="smart_toy" />
                        Ask {phase2AgentLabel(selected)}
                      </button>
                    ) : null}
                    {selected.context.projectId ? (
                      <button type="button" className="pib-btn-secondary min-w-0 justify-center px-3 py-2 text-xs" onClick={() => createPhase2Task(selected)} disabled={!!busyAction}>
                        <Icon name="add_task" />
                        Follow-up task
                      </button>
                    ) : null}
                    <button className="pib-btn-secondary min-w-0 justify-center px-3 py-2 text-xs" type="button" onClick={() => copyBriefingAction(selected, 'exact-ask')} disabled={!!busyAction}>
                      <Icon name="content_copy" />
                      Copy ask
                    </button>
                    <button className="pib-btn-secondary min-w-0 justify-center px-3 py-2 text-xs" type="button" onClick={() => setItemState(selected, 'handled')} disabled={!!busyAction}>
                      <Icon name="done_all" />
                      Mark reviewed
                    </button>
                  </div>
                ) : null}

                <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] p-3">
                  <div className="flex flex-wrap gap-2">
                    {phase2StateChips(selected, mode).map((chip) => (
                      <span key={chip} className="rounded border border-[var(--color-accent-v2)]/30 bg-[var(--color-accent-subtle)] px-2.5 py-1 text-xs font-medium text-[var(--color-accent-text)]">
                        {chip}
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[var(--color-pib-text-muted)]">{phase2NextActionCopy(selected, mode)}</p>
                </div>

                {selected.decisionRequest && selected.options?.length && selected.inputTarget && selected.afterSubmit && !isGenericBriefingDecision(selected) ? (
                  <div className="rounded-lg border border-[var(--color-accent-v2)]/35 bg-[var(--color-accent-subtle)] p-3" aria-label="Inline decision submission">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-brand">Decision required</p>
                      <span className="rounded border border-emerald-300/30 bg-emerald-300/10 px-2 py-1 text-[11px] text-emerald-100">Auditable internal write</span>
                    </div>
                    <p className="mt-2 text-sm font-medium text-[var(--color-pib-text)]">{selected.decisionRequest.prompt}</p>
                    {selected.decisionRequest.reason ? <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">{selected.decisionRequest.reason}</p> : null}
                    <div className="mt-3 space-y-2" role="radiogroup" aria-label="Decision options">
                      {selected.options.map((option) => {
                        const checked = selectedDecisionOptionId(selected) === option.id
                        const recommended = option.recommended || selected.recommendedOption?.id === option.id
                        return (
                          <label key={option.id} className={`block rounded-lg border p-3 text-sm ${checked ? 'border-[var(--color-accent-v2)] bg-[var(--color-pib-surface-muted)]' : 'border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)]'} ${option.disabled ? 'opacity-60' : ''}`}>
                            <span className="flex items-start gap-2">
                              <input
                                type="radio"
                                name={`decision-${selected.id}`}
                                checked={checked}
                                disabled={option.disabled || !!busyAction}
                                onChange={() => setDecisionChoices((current) => ({ ...current, [selected.id]: option.id }))}
                               aria-label="Input"/>
                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-2 font-medium text-[var(--color-pib-text)]">
                                  {option.label}
                                  {recommended ? <span className="rounded border border-emerald-300/30 bg-emerald-300/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-100">Recommended</span> : null}
                                </span>
                                {option.description ? <span className="mt-1 block text-xs leading-5 text-[var(--color-pib-text-muted)]">{option.description}</span> : null}
                                {option.disabledReason ? <span className="mt-1 block text-xs leading-5 text-[var(--sc-ink-soft)]">{option.disabledReason}</span> : null}
                              </span>
                            </span>
                          </label>
                        )
                      })}
                    </div>
                    {selectedDecisionOptionId(selected) === 'other' ? (
                      <label className="mt-3 block text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor={`decision-other-${selected.id}`}>
                        Other keyword/theme
                        <textarea
                          id={`decision-other-${selected.id}`}
                          className="pib-input mt-2 min-h-20 w-full resize-y"
                          value={decisionOtherText[selected.id] ?? ''}
                          onChange={(event) => setDecisionOtherText((current) => ({ ...current, [selected.id]: event.target.value }))}
                          placeholder="Describe the custom keyword/theme direction..."
                         aria-label="Describe the custom keyword/theme direction..."/>
                      </label>
                    ) : null}
                    <div className="mt-3 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-3 text-xs leading-5 text-[var(--color-pib-text-muted)]">
                      <p><span className="text-[var(--color-pib-text)]">After submit:</span> {selected.afterSubmit.consequence}</p>
                      {selected.afterSubmit.releasesAgentId ? <p className="mt-1">Handoff: unblocks/continues {selected.afterSubmit.releasesAgentId} with source {selected.agentHandoff?.sourceTaskId ?? selected.inputTarget.resourceId}.</p> : null}
                      <p className="mt-1">No publish, send, spend, deploy, finance, secret/config, or destructive action is performed.</p>
                    </div>
                    <button className="pib-btn-primary mt-3 w-full justify-center text-xs" type="button" onClick={() => submitInlineDecision(selected)} disabled={!!busyAction || !selectedDecisionOption(selected) || (selectedDecisionOptionId(selected) === 'other' && !decisionOtherText[selected.id]?.trim())}>
                      <Icon name="rule_settings" />
                      Submit choice
                    </button>
                  </div>
                ) : null}

                <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-brand">Safe moves</p>
                    <span className="rounded border border-emerald-300/30 bg-emerald-300/10 px-2 py-1 text-[11px] text-emerald-100">No external side effects</span>
                  </div>
                  {selected.disabledReason && !isBoilerplateDisabledReason(selected.disabledReason) ? (
                    <div className="mt-3 rounded-lg border border-amber-300/25 bg-[var(--sc-surface)]/10 p-3 text-xs leading-5 text-[var(--sc-ink-soft)]">
                      <p><span>Disabled action reason:</span> {selected.disabledReason}</p>
                    </div>
                  ) : null}
                  {contractNearestValidActions(selected).length ? (
                    <div className="mt-3 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-3 text-xs leading-5 text-[var(--color-pib-text-muted)]">
                      <p className="text-[var(--color-pib-text)]">Useful next steps</p>
                      <ul className="mt-1 space-y-1">
                        {contractNearestValidActions(selected).map((action) => (
                          <li key={`${action.action}-${action.label}`}>
                            {action.href ? (
                              <a className="font-medium text-[var(--color-accent-text)] underline underline-offset-2" href={action.href}>{action.label}</a>
                            ) : (
                              <span className="font-medium text-[var(--color-pib-text)]">{action.label}</span>
                            )}
                            {action.reason ? `  -  ${action.reason}` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <div className={ACTION_CONTROL_GRID_CLASS} aria-label="Internal review action controls">
                    {reviewable(selected) || approvalGateReviewable(selected) || documentReviewable(selected) ? (
                      <button className={ACTION_CONTROL_CLASS} type="button" onClick={() => approvePhase2Item(selected)} disabled={!!busyAction} aria-label="Approve">
                        <Icon name="verified" className={ACTION_CONTROL_ICON_CLASS} />
                        <ActionControlLabel>Approve</ActionControlLabel>
                      </button>
                    ) : null}
                    {reviewable(selected) || approvalGateReviewable(selected) || documentReviewable(selected) || (canSocialPostAct(selected) && !!socialActionStage(selected)) ? (
                      <button className={ACTION_CONTROL_CLASS} type="button" onClick={() => rejectPhase2Item(selected)} disabled={!!busyAction || (canSocialPostAct(selected) && !!socialActionStage(selected) && !socialChangeText.trim())} aria-label="Send back">
                        <Icon name="assignment_return" className={ACTION_CONTROL_ICON_CLASS} />
                        <ActionControlLabel>Send back</ActionControlLabel>
                      </button>
                    ) : null}
                    <button className={ACTION_CONTROL_CLASS} type="button" onClick={() => setItemState(selected, 'snoozed')} disabled={!!busyAction} aria-label="Snooze internal review item">
                      <Icon name="snooze" className={ACTION_CONTROL_ICON_CLASS} />
                      <ActionControlLabel>Snooze 24h</ActionControlLabel>
                    </button>
                    {selected.context.projectId ? (
                      <button className={ACTION_CONTROL_CLASS} type="button" onClick={() => createPhase2Task(selected)} disabled={!!busyAction}>
                        <Icon name="add_task" className={ACTION_CONTROL_ICON_CLASS} />
                        <ActionControlLabel>Create follow-up</ActionControlLabel>
                      </button>
                    ) : null}
                    {selected.context.projectId ? (
                      <button className={ACTION_CONTROL_CLASS} type="button" onClick={() => createRoutedBriefingTask(selected, 'ask-specialist-triage')} aria-label={`Ask ${phase2AgentLabel(selected)} to triage`}>
                        <Icon name="support_agent" className={ACTION_CONTROL_ICON_CLASS} />
                        <ActionControlLabel>Ask {phase2AgentLabel(selected)} to triage</ActionControlLabel>
                      </button>
                    ) : null}
                    {selected.context.projectId ? (
                      <button className={ACTION_CONTROL_CLASS} type="button" onClick={() => createRoutedBriefingTask(selected, 'create-routed-task')} aria-label={`Create routed ${phase2AgentLabel(selected)} task`}>
                        <Icon name="route" className={ACTION_CONTROL_ICON_CLASS} />
                        <ActionControlLabel>Create routed {phase2AgentLabel(selected)} task</ActionControlLabel>
                      </button>
                    ) : null}
                    {selected.context.projectId ? (
                      <button className={ACTION_CONTROL_CLASS} type="button" onClick={() => createRoutedBriefingTask(selected, 'link-existing-task')} aria-label="Link existing task">
                        <Icon name="add_link" className={ACTION_CONTROL_ICON_CLASS} />
                        <ActionControlLabel>Link existing task</ActionControlLabel>
                      </button>
                    ) : null}
                    {canTaskAct(selected) ? (
                      <button className={ACTION_CONTROL_CLASS} type="button" onClick={() => assignPhase2Agent(selected)} disabled={!!busyAction}>
                        <Icon name="smart_toy" className={ACTION_CONTROL_ICON_CLASS} />
                        <ActionControlLabel>Assign {phase2AgentId(selected)}</ActionControlLabel>
                      </button>
                    ) : null}
                    {evidenceHref(selected, mode, portalScope) ? (
                      <a className={ACTION_CONTROL_LINK_CLASS} href={evidenceHref(selected, mode, portalScope) ?? undefined} target="_blank" rel="noopener noreferrer">
                        <Icon name="fact_check" className={ACTION_CONTROL_ICON_CLASS} />
                        <ActionControlLabel>View evidence</ActionControlLabel>
                      </a>
                    ) : null}
                    {canConvertToCrmActivity(selected) ? (
                      <button className={ACTION_CONTROL_CLASS} type="button" onClick={() => convertToCrmActivity(selected)} disabled={!!busyAction}>
                        <Icon name="add_notes" className={ACTION_CONTROL_ICON_CLASS} />
                        <ActionControlLabel>Log to CRM</ActionControlLabel>
                      </button>
                    ) : null}
                  </div>
                  <details className="mt-3 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-3">
                    <summary className="cursor-pointer text-[10px] font-label uppercase tracking-[0.16em] text-brand">Secondary actions and routing notes</summary>
                    <div className="mt-3 space-y-3">
                      <div>
                        <p className="text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">Copy or ask an agent</p>
                        <div className={ACTION_CONTEXT_GRID_CLASS} aria-label="Copy or ask an agent controls">
                          <button className={ACTION_CONTROL_CLASS} type="button" onClick={() => copyBriefingAction(selected, 'exact-ask')} disabled={!!busyAction}>
                            <Icon name="content_copy" className={ACTION_CONTROL_ICON_CLASS} />
                            <ActionControlLabel>Copy ask</ActionControlLabel>
                          </button>
                          <button className={ACTION_CONTROL_CLASS} type="button" onClick={() => copyBriefingAction(selected, 'full-briefing')} disabled={!!busyAction}>
                            <Icon name="description" className={ACTION_CONTROL_ICON_CLASS} />
                            <ActionControlLabel>Copy brief</ActionControlLabel>
                          </button>
                          <button className={ACTION_CONTROL_CLASS} type="button" onClick={() => copyBriefingAction(selected, 'agent-handoff')} disabled={!!busyAction}>
                            <Icon name="quick_reference" className={ACTION_CONTROL_ICON_CLASS} />
                            <ActionControlLabel>Copy handoff</ActionControlLabel>
                          </button>
                          <button className={ACTION_CONTROL_CLASS} type="button" onClick={() => copyBriefingAction(selected, 'blocker-summary')} disabled={!!busyAction}>
                            <Icon name="front_hand" className={ACTION_CONTROL_ICON_CLASS} />
                            <ActionControlLabel>Copy blocker</ActionControlLabel>
                          </button>
                          <button className={ACTION_CONTROL_CLASS} type="button" onClick={() => copyBriefingAction(selected, 'evidence-links')} disabled={!!busyAction}>
                            <Icon name="link" className={ACTION_CONTROL_ICON_CLASS} />
                            <ActionControlLabel>Copy evidence</ActionControlLabel>
                          </button>
                          {/* Chat link removed  -  docked chat in CockpitShell replaces this */}
                        </div>
                      </div>
                    </div>
                  </details>
                </div>

                <div className={ACTION_CONTROL_GRID_CLASS} aria-label="Source action controls">
                  <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => setItemState(selected, 'handled')} disabled={!!busyAction}>
                    <Icon name="done_all" />
                    Mark reviewed
                  </button>
                  <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => setItemState(selected, 'snoozed')} disabled={!!busyAction}>
                    <Icon name="snooze" />
                    Snooze 24h
                  </button>
                  {canTaskUnblock(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => unblockTask(selected)} disabled={!!busyAction}>
                      <Icon name="play_arrow" />
                      Unblock
                    </button>
                  ) : null}
                  {reviewable(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => taskPatch(selected, { reviewStatus: 'approved', columnId: 'done', agentStatus: 'done' }, 'Approved and moved to done.')} disabled={!!busyAction}>
                      <Icon name="verified" />
                      Approve
                    </button>
                  ) : null}
                  {reviewable(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => taskPatch(selected, { reviewStatus: 'changes-requested', agentStatus: 'pending', columnId: 'todo' }, 'Sent back to the assigned agent.')} disabled={!!busyAction}>
                      <Icon name="assignment_return" />
                      Send back to agent
                    </button>
                  ) : null}
                  {approvalGateReviewable(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => taskPatch(selected, { reviewStatus: 'approved', approvalStatus: 'approved', columnId: 'done', agentStatus: 'done' }, 'Approval gate approved.')} disabled={!!busyAction}>
                      <Icon name="verified" />
                      Approve approval
                    </button>
                  ) : null}
                  {approvalGateReviewable(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => taskPatch(selected, { reviewStatus: 'changes-requested', approvalStatus: 'rejected', agentStatus: 'pending', columnId: 'todo' }, 'Approval gate rejected and sent back.')} disabled={!!busyAction}>
                      <Icon name="assignment_return" />
                      Reject approval
                    </button>
                  ) : null}
                  {documentReviewable(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => approveDocument(selected)} disabled={!!busyAction}>
                      <Icon name="approval" />
                      Approve document
                    </button>
                  ) : null}
                  {documentReviewable(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => requestDocumentChanges(selected)} disabled={!!busyAction}>
                      <Icon name="edit_note" />
                      Request changes
                    </button>
                  ) : null}
                  {canDocumentCommentResolveAct(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => resolveDocumentComment(selected)} disabled={!!busyAction}>
                      <Icon name="task_alt" />
                      Resolve document comment
                    </button>
                  ) : null}
                  {canSocialPostAct(selected) && socialActionStage(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => socialPostAction(selected, 'approve')} disabled={!!busyAction}>
                      <Icon name="thumb_up" />
                      Approve social post
                    </button>
                  ) : null}
                  {canSocialPostAct(selected) && socialActionStage(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => socialPostAction(selected, 'reject')} disabled={!socialChangeText.trim() || !!busyAction}>
                      <Icon name="thumb_down" />
                      Request social changes
                    </button>
                  ) : null}
                  {canSocialInboxAct(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => socialInboxAction(selected, 'read')} disabled={!!busyAction}>
                      <Icon name="mark_chat_read" />
                      Mark engagement read
                    </button>
                  ) : null}
                  {canSocialInboxAct(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => socialInboxAction(selected, 'replied')} disabled={!!busyAction}>
                      <Icon name="forum" />
                      Mark engagement replied
                    </button>
                  ) : null}
                  {canSocialInboxAct(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => socialInboxAction(selected, 'archived')} disabled={!!busyAction}>
                      <Icon name="archive" />
                      Archive engagement
                    </button>
                  ) : null}
                  {canMailboxAct(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => mailboxPatch(selected, { read: true }, 'Email marked read.')} disabled={!!busyAction}>
                      <Icon name="mark_email_read" />
                      Mark email read
                    </button>
                  ) : null}
                  {canMailboxAct(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => mailboxPatch(selected, { folder: 'archive' }, 'Email archived.')} disabled={!!busyAction}>
                      <Icon name="archive" />
                      Archive email
                    </button>
                  ) : null}
                  {canAgentRunApprove(selected, mode) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => agentRunApprovalAction(selected, 'once')} disabled={!!busyAction}>
                      <Icon name="play_circle" />
                      Approve run once
                    </button>
                  ) : null}
                  {canAgentRunApprove(selected, mode) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => agentRunApprovalAction(selected, 'deny')} disabled={!!busyAction}>
                      <Icon name="block" />
                      Deny run
                    </button>
                  ) : null}
                  {canWorkspaceBrokerAct(selected, mode) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => workspaceBrokerAction(selected, 'approve')} disabled={!!busyAction}>
                      <Icon name="verified" />
                      Approve workspace job
                    </button>
                  ) : null}
                  {canWorkspaceBrokerAct(selected, mode) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => workspaceBrokerAction(selected, 'reject')} disabled={!!busyAction}>
                      <Icon name="block" />
                      Reject workspace job
                    </button>
                  ) : null}
                  {canCalendarRsvpAct(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => calendarRsvpAction(selected, 'accepted')} disabled={!!busyAction}>
                      <Icon name="event_available" />
                      Accept meeting
                    </button>
                  ) : null}
                  {canCalendarRsvpAct(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => calendarRsvpAction(selected, 'declined')} disabled={!!busyAction}>
                      <Icon name="event_busy" />
                      Decline meeting
                    </button>
                  ) : null}
                  {canNotificationAct(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => notificationAction(selected, 'read')} disabled={!!busyAction}>
                      <Icon name="mark_email_read" />
                      Mark notification read
                    </button>
                  ) : null}
                  {canNotificationAct(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => notificationAction(selected, 'archived')} disabled={!!busyAction}>
                      <Icon name="archive" />
                      Archive notification
                    </button>
                  ) : null}
                  {invoiceSendable(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => sendInvoice(selected)} disabled={!!busyAction}>
                      <Icon name="send" />
                      Send invoice
                    </button>
                  ) : null}
                  {invoicePaymentProofReviewable(selected, mode) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => paymentProofAction(selected, 'confirm')} disabled={!!busyAction}>
                      <Icon name="price_check" />
                      Confirm payment proof
                    </button>
                  ) : null}
                  {invoicePaymentProofReviewable(selected, mode) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => paymentProofAction(selected, 'reject')} disabled={!paymentProofRejectReason.trim() || !!busyAction}>
                      <Icon name="block" />
                      Reject payment proof
                    </button>
                  ) : null}
                  {quoteDecisionable(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => quoteAction(selected, 'accept')} disabled={!!busyAction}>
                      <Icon name="verified" />
                      Accept quote
                    </button>
                  ) : null}
                  {quoteDecisionable(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => quoteAction(selected, 'decline')} disabled={!!busyAction}>
                      <Icon name="block" />
                      Decline quote
                    </button>
                  ) : null}
                  {quoteConvertible(selected, mode) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => quoteAction(selected, 'convert')} disabled={!!busyAction}>
                      <Icon name="receipt_long" />
                      Convert to invoice
                    </button>
                  ) : null}
                  {orderActive(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => orderAction(selected, 'in_progress')} disabled={!!busyAction}>
                      <Icon name="play_arrow" />
                      Mark order in progress
                    </button>
                  ) : null}
                  {orderActive(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => orderAction(selected, 'fulfilled')} disabled={!!busyAction}>
                      <Icon name="task_alt" />
                      Mark order fulfilled
                    </button>
                  ) : null}
                  {orderActive(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => orderAction(selected, 'cancelled')} disabled={!!busyAction}>
                      <Icon name="block" />
                      Cancel order
                    </button>
                  ) : null}
                  {inventoryActive(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => inventoryAction(selected, 'active')} disabled={!!busyAction}>
                      <Icon name="inventory_2" />
                      Mark inventory restocked
                    </button>
                  ) : null}
                  {inventoryActive(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => inventoryAction(selected, 'archived')} disabled={!!busyAction}>
                      <Icon name="archive" />
                      Archive inventory item
                    </button>
                  ) : null}
                  {shipmentActive(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => shipmentAction(selected, 'delivered')} disabled={!!busyAction}>
                      <Icon name="inventory_2" />
                      Mark delivered
                    </button>
                  ) : null}
                  {shipmentActive(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => shipmentAction(selected, 'failed')} disabled={!!busyAction}>
                      <Icon name="report" />
                      Mark shipment failed
                    </button>
                  ) : null}
                  {expenseReviewable(selected, mode) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => expenseAction(selected, 'approve')} disabled={!!busyAction}>
                      <Icon name="verified" />
                      Approve expense
                    </button>
                  ) : null}
                  {expenseReviewable(selected, mode) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => expenseAction(selected, 'reject')} disabled={!expenseReviewText.trim() || !!busyAction}>
                      <Icon name="block" />
                      Reject expense
                    </button>
                  ) : null}
                  {seoContentReviewable(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => seoContentAction(selected, 'approve')} disabled={!!busyAction}>
                      <Icon name="published_with_changes" />
                      Approve SEO content
                    </button>
                  ) : null}
                  {seoContentReviewable(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => seoContentAction(selected, 'changes')} disabled={!seoChangeText.trim() || !!busyAction}>
                      <Icon name="edit_note" />
                      Request SEO changes
                    </button>
                  ) : null}
                  {seoTaskSkippable(selected, mode) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => seoTaskAction(selected, 'execute')} disabled={!!busyAction}>
                      <Icon name="play_arrow" />
                      Execute SEO task
                    </button>
                  ) : null}
                  {seoTaskSkippable(selected, mode) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => seoTaskAction(selected, 'complete')} disabled={!!busyAction}>
                      <Icon name="task_alt" />
                      Complete SEO task
                    </button>
                  ) : null}
                  {seoTaskSkippable(selected, mode) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => seoTaskAction(selected, 'skip')} disabled={!seoTaskSkipReason.trim() || !!busyAction}>
                      <Icon name="skip_next" />
                      Skip SEO task
                    </button>
                  ) : null}
                  {adCampaignReviewable(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => adCampaignAction(selected, 'approve')} disabled={!!busyAction}>
                      <Icon name="verified" />
                      Approve ad campaign
                    </button>
                  ) : null}
                  {adCampaignReviewable(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => adCampaignAction(selected, 'reject')} disabled={!adCampaignChangeText.trim() || !!busyAction}>
                      <Icon name="assignment_return" />
                      Request ad campaign changes
                    </button>
                  ) : null}
                  {broadcastSendable(selected) ? (
                    <div className="rounded-lg border border-amber-300/25 bg-[var(--sc-surface)]/10 p-3">
                      <button className="pib-btn-secondary w-full justify-center text-xs" type="button" disabled aria-label="Send broadcast requires approval">
                        <Icon name="lock" />
                        Send broadcast requires approval
                      </button>
                      <p className="mt-2 text-xs leading-5 text-[var(--sc-ink-soft)]">External broadcast sending requires a separate explicit approval gate before any recipient-visible email is queued.</p>
                    </div>
                  ) : null}
                  {broadcastPausable(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => broadcastAction(selected, 'pause')} disabled={!!busyAction}>
                      <Icon name="pause_circle" />
                      Pause broadcast
                    </button>
                  ) : null}
                  {broadcastResumable(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => broadcastAction(selected, 'resume')} disabled={!!busyAction}>
                      <Icon name="play_circle" />
                      Resume broadcast
                    </button>
                  ) : null}
                  {canCampaignAct(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => campaignAction(selected, 'approve-all')} disabled={!!busyAction}>
                      <Icon name="done_all" />
                      Approve campaign assets
                    </button>
                  ) : null}
                  {campaignLaunchable(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => campaignAction(selected, 'launch')} disabled={!!busyAction}>
                      <Icon name="rocket_launch" />
                      Launch campaign
                    </button>
                  ) : null}
                  {campaignArchivable(selected) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => campaignAction(selected, 'archive')} disabled={!!busyAction}>
                      <Icon name="archive" />
                      Archive campaign
                    </button>
                  ) : null}
                  {enquiryActionable(selected, mode) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => enquiryAction(selected, 'reviewing')} disabled={!!busyAction}>
                      <Icon name="pageview" />
                      Mark enquiry reviewing
                    </button>
                  ) : null}
                  {enquiryActionable(selected, mode) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => enquiryAction(selected, 'active')} disabled={!!busyAction}>
                      <Icon name="person_check" />
                      Mark enquiry active
                    </button>
                  ) : null}
                  {enquiryActionable(selected, mode) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => enquiryAction(selected, 'closed')} disabled={!!busyAction}>
                      <Icon name="check_circle" />
                      Close enquiry
                    </button>
                  ) : null}
                  {bookingActionable(selected, mode) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => bookingAction(selected, 'completed')} disabled={!!busyAction}>
                      <Icon name="event_available" />
                      Mark booking completed
                    </button>
                  ) : null}
                  {bookingActionable(selected, mode) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => bookingAction(selected, 'cancelled')} disabled={!!busyAction}>
                      <Icon name="event_busy" />
                      Cancel booking
                    </button>
                  ) : null}
                  {formSubmissionActionable(selected, mode) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => formSubmissionAction(selected, 'read')} disabled={!!busyAction}>
                      <Icon name="mark_email_read" />
                      Mark submission read
                    </button>
                  ) : null}
                  {formSubmissionActionable(selected, mode) ? (
                    <button className={SOURCE_ACTION_CONTROL_CLASS} type="button" onClick={() => formSubmissionAction(selected, 'archived')} disabled={!!busyAction}>
                      <Icon name="archive" />
                      Archive submission
                    </button>
                  ) : null}
                </div>

                {canSocialPostAct(selected) && socialActionStage(selected) ? (
                  <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-3">
                    <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="briefing-social-change">
                      Social change request
                    </label>
                    <textarea
                      id="briefing-social-change"
                      className="pib-input mt-2 min-h-20 w-full resize-y"
                      value={socialChangeText}
                      onChange={(event) => setSocialChangeText(event.target.value)}
                      placeholder="Describe what the agent should change before approval..."
                     aria-label="Describe what the agent should change before approval..."/>
                  </div>
                ) : null}

                {canMailboxAct(selected) ? (
                  <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-3">
                    <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="briefing-mailbox-reply">
                      Mailbox reply draft
                    </label>
                    <textarea
                      id="briefing-mailbox-reply"
                      className="pib-input mt-2 min-h-24 w-full resize-y"
                      value={mailboxReplyText}
                      onChange={(event) => setMailboxReplyText(event.target.value)}
                      placeholder="Draft a reply without sending it yet..."
                     aria-label="Draft a reply without sending it yet..."/>
                    {pipDraftButton(setMailboxReplyText)}
                    <button className="pib-btn-primary mt-2 w-full justify-center text-xs" type="button" onClick={() => draftMailboxReply(selected)} disabled={!mailboxReplyText.trim() || mailboxReplyTo(selected).length === 0 || !selected.metadata?.accountId || !!busyAction}>
                      <Icon name="draft" />
                      Draft email reply
                    </button>
                  </div>
                ) : null}

                {canTaskAct(selected) || canDocumentAct(selected) || canConversationAct(selected) ? (
                  <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-3">
                    <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="briefing-reply">
                      {canDocumentCommentReplyAct(selected) ? 'Inline document comment reply' : canTaskAct(selected) ? 'Inline task reply' : canDocumentAct(selected) ? 'Inline document reply' : 'Inline conversation reply'}
                    </label>
                    <textarea
                      id="briefing-reply"
                      className="pib-input mt-2 min-h-24 w-full resize-y"
                      value={replyText}
                      onChange={(event) => setReplyText(event.target.value)}
                      placeholder="Reply with a decision, note, or instruction..."
                     aria-label="Reply with a decision, note, or instruction..."/>
                    {pipDraftButton(setReplyText)}
                    <button className="pib-btn-primary mt-2 w-full justify-center text-xs" type="button" onClick={() => replyToSelected(selected)} disabled={!replyText.trim() || !!busyAction}>
                      <Icon name="reply" />
                      {canDocumentCommentReplyAct(selected) ? 'Reply to document comment' : canTaskAct(selected) ? 'Post reply to task' : canDocumentAct(selected) ? 'Post reply to document' : 'Post reply to conversation'}
                    </button>
                  </div>
                ) : null}

                {canActivityFollowUpAct(selected) ? (
                  <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-3">
                    <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="briefing-follow-up">
                      Follow-up note
                    </label>
                    <textarea
                      id="briefing-follow-up"
                      className="pib-input mt-2 min-h-24 w-full resize-y"
                      value={followUpText}
                      onChange={(event) => setFollowUpText(event.target.value)}
                      placeholder={
                        selected.context.contactName || selected.context.dealTitle
                          ? `Log the call, decision, or next step for ${[selected.context.contactName, selected.context.dealTitle].filter(Boolean).join(' · ')}...`
                          : 'Log the call, decision, blocker, or next step against this CRM contact...'
                      }
                     aria-label="Input"/>
                    <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
                      <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="briefing-next-follow-up-task">
                        Next follow-up task
                        <input
                          id="briefing-next-follow-up-task"
                          className="pib-input mt-1 w-full"
                          value={nextFollowUpTaskTitle}
                          onChange={(event) => setNextFollowUpTaskTitle(event.target.value)}
                          placeholder={selected.context.dealTitle ? `Follow up on ${selected.context.dealTitle}` : 'Optional next step'}
                         aria-label="Input"/>
                      </label>
                      <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="briefing-next-follow-up-task-due">
                        Next task due date
                        <input
                          id="briefing-next-follow-up-task-due"
                          className="pib-input mt-1 w-full"
                          type="date"
                          value={nextFollowUpTaskDueDate}
                          onChange={(event) => setNextFollowUpTaskDueDate(event.target.value)}
                         aria-label="Input"/>
                      </label>
                    </div>
                    <button className="pib-btn-primary mt-2 w-full justify-center text-xs" type="button" onClick={() => canContactFollowUpComplete(selected) ? completeContactFollowUp(selected) : logActivityFollowUp(selected)} disabled={!followUpText.trim() || !!busyAction}>
                      <Icon name="add_notes" />
                      {nextFollowUpTaskTitle.trim() ? 'Log note and schedule task' : 'Log follow-up note'}
                    </button>
                    {canContactFollowUpComplete(selected) ? (
                      <button className="pib-btn-secondary mt-2 w-full justify-center text-xs" type="button" onClick={() => completeContactFollowUp(selected)} disabled={!followUpText.trim() || !!busyAction}>
                        <Icon name="done_all" />
                        {nextFollowUpTaskTitle.trim() ? 'Mark followed up and schedule task' : 'Mark contact followed up'}
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {canReportAct(selected) ? (
                  <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-3">
                    <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="briefing-report-recipients">
                      Report recipients
                    </label>
                    <input
                      id="briefing-report-recipients"
                      className="pib-input mt-2 w-full"
                      value={reportRecipients}
                      onChange={(event) => setReportRecipients(event.target.value)}
                      placeholder="client@example.com, team@example.com"
                     aria-label="client@example.com, team@example.com"/>
                    <button className="pib-btn-primary mt-2 w-full justify-center text-xs" type="button" onClick={() => sendReport(selected)} disabled={!reportRecipients.trim() || !!busyAction}>
                      <Icon name="send" />
                      Send report
                    </button>
                  </div>
                ) : null}

                {canSupportTicketAct(selected) ? (
                  <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-3">
                    <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="briefing-support-reply">
                      Support reply
                    </label>
                    <textarea
                      id="briefing-support-reply"
                      className="pib-input mt-2 min-h-24 w-full resize-y"
                      value={replyText}
                      onChange={(event) => setReplyText(event.target.value)}
                      placeholder="Reply to the client and keep the support thread moving..."
                     aria-label="Reply to the client and keep the support thread moving..."/>
                    {pipDraftButton(setReplyText)}
                    <button className="pib-btn-primary mt-2 w-full justify-center text-xs" type="button" onClick={() => replyToSupportTicket(selected, replyText)} disabled={!replyText.trim() || !!busyAction}>
                      <Icon name="support_agent" />
                      Reply to support ticket
                    </button>
                  </div>
                ) : null}

                {invoicePaymentProofReviewable(selected, mode) ? (
                  <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-3">
                    <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="briefing-payment-method">
                      Payment method
                    </label>
                    <select
                      id="briefing-payment-method"
                      className="pib-input mt-2 w-full"
                      value={paymentMethod}
                      onChange={(event) => setPaymentMethod(event.target.value)}
                     aria-label="Input">
                      <option value="eft">EFT</option>
                      <option value="paypal">PayPal</option>
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="other">Other</option>
                    </select>
                    <label className="mt-3 block text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="briefing-payment-reference">
                      Payment reference
                    </label>
                    <input
                      id="briefing-payment-reference"
                      className="pib-input mt-2 w-full"
                      value={paymentReference}
                      onChange={(event) => setPaymentReference(event.target.value)}
                      placeholder="Bank reference or transaction id..."
                     aria-label="Bank reference or transaction id..."/>
                    <label className="mt-3 block text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="briefing-payment-proof-rejection">
                      Payment proof rejection reason
                    </label>
                    <textarea
                      id="briefing-payment-proof-rejection"
                      className="pib-input mt-2 min-h-20 w-full resize-y"
                      value={paymentProofRejectReason}
                      onChange={(event) => setPaymentProofRejectReason(event.target.value)}
                      placeholder="Required only when rejecting this proof..."
                     aria-label="Required only when rejecting this proof..."/>
                  </div>
                ) : null}

                {expenseReviewable(selected, mode) ? (
                  <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-3">
                    <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="briefing-expense-review-note">
                      Expense rejection note
                    </label>
                    <textarea
                      id="briefing-expense-review-note"
                      className="pib-input mt-2 min-h-20 w-full resize-y"
                      value={expenseReviewText}
                      onChange={(event) => setExpenseReviewText(event.target.value)}
                      placeholder="Required only when rejecting this expense..."
                     aria-label="Required only when rejecting this expense..."/>
                  </div>
                ) : null}

                {seoContentReviewable(selected) ? (
                  <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-3">
                    <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="briefing-seo-change-request">
                      SEO change request
                    </label>
                    <textarea
                      id="briefing-seo-change-request"
                      className="pib-input mt-2 min-h-20 w-full resize-y"
                      value={seoChangeText}
                      onChange={(event) => setSeoChangeText(event.target.value)}
                      placeholder="Tell the writer what must change before this goes live..."
                     aria-label="Tell the writer what must change before this goes live..."/>
                  </div>
                ) : null}

                {seoTaskSkippable(selected, mode) ? (
                  <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-3">
                    <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="briefing-seo-task-skip-reason">
                      SEO task skip reason
                    </label>
                    <textarea
                      id="briefing-seo-task-skip-reason"
                      className="pib-input mt-2 min-h-20 w-full resize-y"
                      value={seoTaskSkipReason}
                      onChange={(event) => setSeoTaskSkipReason(event.target.value)}
                      placeholder="Explain why this sprint task should be skipped..."
                     aria-label="Explain why this sprint task should be skipped..."/>
                  </div>
                ) : null}

                {adCampaignReviewable(selected) ? (
                  <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-3">
                    <label className="text-xs font-medium text-[var(--color-pib-text-muted)]" htmlFor="briefing-ad-campaign-change-request">
                      Ad campaign change request
                    </label>
                    <textarea
                      id="briefing-ad-campaign-change-request"
                      className="pib-input mt-2 min-h-20 w-full resize-y"
                      value={adCampaignChangeText}
                      onChange={(event) => setAdCampaignChangeText(event.target.value)}
                      placeholder="Tell the ads team what must change before launch..."
                     aria-label="Tell the ads team what must change before launch..."/>
                  </div>
                ) : null}

                {selectedLearningReview ? (
                  <div className="rounded-lg border border-violet-300/25 bg-[var(--sc-surface)]/10 p-3" aria-label="Agent Learning Review">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium text-[var(--sc-ink-soft)]">Weekly Agent Learning Review</p>
                        <p className="mt-2 text-sm text-[var(--color-pib-text)]">{selectedLearningReview.automationGuard}</p>
                      </div>
                      <span className="rounded border border-amber-300/35 bg-[var(--sc-surface)]/10 px-2 py-1 text-[11px] text-[var(--sc-ink-soft)]">
                        Review before rewrite
                      </span>
                    </div>
                    {selectedLearningReview.proposedChanges.length ? (
                      <div className="mt-4 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-3">
                        <p className="text-xs font-medium text-[var(--color-pib-text-muted)]">Proposed learning items</p>
                        <ul className="mt-2 space-y-1 text-sm text-[var(--color-pib-text)]">
                          {selectedLearningReview.proposedChanges.map((change) => <li key={change}>• {change}</li>)}
                        </ul>
                      </div>
                    ) : null}
                    <div className="mt-4 grid gap-3 lg:grid-cols-3">
                      {[
                        { label: 'Skills', links: selectedLearningReview.skillLinks },
                        { label: 'Wiki', links: selectedLearningReview.wikiLinks },
                        { label: 'Tasks', links: selectedLearningReview.taskLinks },
                      ].map((group) => (
                        <div key={group.label} className="rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-3">
                          <p className="text-xs font-medium text-[var(--color-pib-text-muted)]">{group.label}</p>
                          <div className="mt-2 space-y-1 text-sm">
                            {group.links.length ? group.links.map((link) => (
                              <a key={`${group.label}:${link.href}:${link.label}`} className="block truncate text-brand underline-offset-4 hover:underline" href={link.href} target="_blank" rel="noopener noreferrer">
                                {link.label}
                              </a>
                            )) : <span className="text-[var(--color-pib-text-muted)]">No links attached</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                    {(selectedLearningReview.sourceDocumentId || selectedLearningReview.approvalGateTaskId) ? (
                      <p className="mt-3 text-xs text-[var(--color-pib-text-muted)]">
                        {selectedLearningReview.sourceDocumentId ? `Source doc: ${selectedLearningReview.sourceDocumentId}` : null}
                        {selectedLearningReview.sourceDocumentId && selectedLearningReview.approvalGateTaskId ? ' · ' : null}
                        {selectedLearningReview.approvalGateTaskId ? `Approval gate task: ${selectedLearningReview.approvalGateTaskId}` : null}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {selectedReviewCard ? (
                  <div className="rounded-lg border border-sky-300/25 bg-sky-400/10 p-3" aria-label="Structured review card">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium text-sky-100">Structured review card</p>
                        <p className="mt-2 text-sm text-[var(--color-pib-text)]">{selectedReviewCard.summary}</p>
                      </div>
                      <span className="rounded border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] px-2 py-1 text-[11px] text-[var(--color-pib-text-muted)]">
                        Internal review
                      </span>
                    </div>
                    <div className="mt-4 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-3">
                      <p className="text-xs font-medium text-[var(--color-pib-text-muted)]">Recommended reviewer next step</p>
                      <p className="mt-1 text-sm text-[var(--color-pib-text)]">{selectedReviewCard.nextAction}</p>
                    </div>
                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                      <div>
                        <p className="text-xs font-medium text-[var(--color-pib-text-muted)]">Quality checks</p>
                        <div className="mt-2 space-y-2">
                          {selectedReviewCard.qualityChecks.map((check) => (
                            <div key={`${check.label}:${check.status}`} className={`rounded-md border px-3 py-2 ${statusToneClass(check.status)}`}>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium">{check.label}</span>
                                <span className="text-[11px] uppercase tracking-wide">{statusLabel(check.status)}</span>
                              </div>
                              <p className="mt-1 text-xs opacity-90">{check.detail}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-[var(--color-pib-text-muted)]">Artifacts</p>
                        {selectedReviewCard.artifacts.length ? (
                          <dl className="mt-2 space-y-2 text-sm">
                            {selectedReviewCard.artifacts.map((artifact) => (
                              <div key={`${artifact.type}:${artifact.ref}`}>
                                <dt className="text-[var(--color-pib-text-muted)]">{artifact.label}</dt>
                                <dd className="text-[var(--color-pib-text)]">
                                  {artifact.href ? (
                                    <a className="break-all underline-offset-2 hover:underline" href={artifact.href} target="_blank" rel="noopener noreferrer">{artifact.ref}</a>
                                  ) : (
                                    <span className="break-all">{artifact.ref}</span>
                                  )}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        ) : (
                          <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">No explicit artifacts were linked.</p>
                        )}
                      </div>
                    </div>
                    {selectedReviewCard.approvalGates.length ? (
                      <div className="mt-4">
                        <p className="text-xs font-medium text-[var(--color-pib-text-muted)]">Approval gates</p>
                        <dl className="mt-2 space-y-2 text-sm">
                          {selectedReviewCard.approvalGates.map((gate) => (
                            <div key={`${gate.label}:${gate.value}`} className={`rounded-md border px-3 py-2 ${statusToneClass(gate.status)}`}>
                              <dt className="flex items-center justify-between gap-2">
                                <span className="font-medium">{gate.label}</span>
                                <span className="text-[11px] uppercase tracking-wide">{statusLabel(gate.status)}</span>
                              </dt>
                              <dd className="mt-1">
                                {gate.href ? (
                                  <a className="break-all underline-offset-2 hover:underline" href={gate.href} target="_blank" rel="noopener noreferrer">{gate.value}</a>
                                ) : (
                                  <span className="break-all">{gate.value}</span>
                                )}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {softwareBuildEvidenceRows(selected).length ? (
                  <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-3" aria-label="Software build evidence">
                    <p className="text-xs font-medium text-[var(--color-pib-text-muted)]">Software build evidence</p>
                    <dl className="mt-3 space-y-2 text-sm">
                      {softwareBuildEvidenceRows(selected).map((row) => (
                        <div key={`${row.kind}:${row.label}:${row.value}`}>
                          <dt className="text-[var(--color-pib-text-muted)]">{row.label}</dt>
                          <dd className={row.kind === 'blocker' ? 'text-[var(--sc-ink-soft)]' : 'text-[var(--color-pib-text)]'}>
                            {row.href ? (
                              <a className="break-all underline-offset-2 hover:underline" href={row.href} target="_blank" rel="noopener noreferrer">{row.value}</a>
                            ) : (
                              <span className="break-all">{row.value}</span>
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ) : null}

                <dl className="space-y-3 text-sm">
                  {detailMetaValue(selected.actor.name, selected.actor.id) ? <div><dt className="text-[var(--color-pib-text-muted)]">Actor</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.actor.name, selected.actor.id)}</dd></div> : null}
                  {detailMetaValue(selected.context.orgName, selected.orgId) ? <div><dt className="text-[var(--color-pib-text-muted)]">Workspace</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.orgName, selected.orgId)}</dd></div> : null}
                  {detailMetaValue(selected.context.projectName, selected.context.projectId) ? <div><dt className="text-[var(--color-pib-text-muted)]">Project</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.projectName, selected.context.projectId)}</dd></div> : null}
                  {detailMetaValue(selected.context.taskTitle, selected.context.taskId) ? <div><dt className="text-[var(--color-pib-text-muted)]">Task</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.taskTitle, selected.context.taskId)}</dd></div> : null}
                  {detailMetaValue(selected.context.documentTitle, selected.context.documentId) ? <div><dt className="text-[var(--color-pib-text-muted)]">Document</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.documentTitle, selected.context.documentId)}</dd></div> : null}
                  {detailMetaValue(selected.context.conversationTitle, selected.context.conversationId) ? <div><dt className="text-[var(--color-pib-text-muted)]">Conversation</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.conversationTitle, selected.context.conversationId)}</dd></div> : null}
                  {detailMetaValue(selected.context.contactName, selected.context.contactId) ? <div><dt className="text-[var(--color-pib-text-muted)]">Contact</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.contactName, selected.context.contactId)}</dd></div> : null}
                  {typeof selected.metadata?.contactStage === 'string' && selected.metadata.contactStage ? <div><dt className="text-[var(--color-pib-text-muted)]">Contact stage</dt><dd className="text-[var(--color-pib-text)]">{selected.metadata.contactStage}</dd></div> : null}
                  {typeof selected.metadata?.lastContactedAt === 'string' && selected.metadata.lastContactedAt ? <div><dt className="text-[var(--color-pib-text-muted)]">Last contacted</dt><dd className="text-[var(--color-pib-text)]">{selected.metadata.lastContactedAt.slice(0, 10)}</dd></div> : null}
                  {detailMetaValue(selected.context.dealTitle, selected.context.dealId) ? <div><dt className="text-[var(--color-pib-text-muted)]">Deal</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.dealTitle, selected.context.dealId)}</dd></div> : null}
                  {detailMetaValue(selected.context.reportTitle, selected.context.reportId) ? <div><dt className="text-[var(--color-pib-text-muted)]">Report</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.reportTitle, selected.context.reportId)}</dd></div> : null}
                  {detailMetaValue(selected.context.bookingName, selected.context.bookingId ?? selected.source.id) ? <div><dt className="text-[var(--color-pib-text-muted)]">Booking</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.bookingName, selected.context.bookingId ?? selected.source.id)}</dd></div> : null}
                  {detailMetaValue(selected.context.supportTicketSubject, selected.context.supportTicketId) ? <div><dt className="text-[var(--color-pib-text-muted)]">Support ticket</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.supportTicketSubject, selected.context.supportTicketId)}</dd></div> : null}
                  {detailMetaValue(selected.context.invoiceNumber, selected.context.invoiceId ?? selected.source.id) ? <div><dt className="text-[var(--color-pib-text-muted)]">Invoice</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.invoiceNumber, selected.context.invoiceId ?? selected.source.id)}</dd></div> : null}
                  {detailMetaValue(selected.context.quoteNumber, selected.context.quoteId ?? selected.source.id) ? <div><dt className="text-[var(--color-pib-text-muted)]">Quote</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.quoteNumber, selected.context.quoteId ?? selected.source.id)}</dd></div> : null}
                  {detailMetaValue(selected.context.orderTitle, selected.context.orderId ?? selected.source.id) ? <div><dt className="text-[var(--color-pib-text-muted)]">Order</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.orderTitle, selected.context.orderId ?? selected.source.id)}</dd></div> : null}
                  {detailMetaValue(selected.context.inventoryItemName, selected.context.inventoryItemId ?? selected.source.id) ? <div><dt className="text-[var(--color-pib-text-muted)]">Inventory</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.inventoryItemName, selected.context.inventoryItemId ?? selected.source.id)}</dd></div> : null}
                  {detailMetaValue(selected.context.shipmentTrackingNumber, selected.context.shipmentId ?? selected.source.id) ? <div><dt className="text-[var(--color-pib-text-muted)]">Shipment</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.shipmentTrackingNumber, selected.context.shipmentId ?? selected.source.id)}</dd></div> : null}
                  {detailMetaValue(selected.context.expenseCategory, selected.context.expenseId ?? selected.source.id) ? <div><dt className="text-[var(--color-pib-text-muted)]">Expense</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.expenseCategory, selected.context.expenseId ?? selected.source.id)}</dd></div> : null}
                  {detailMetaValue(selected.context.seoContentTitle, selected.context.seoContentId ?? selected.source.id) ? <div><dt className="text-[var(--color-pib-text-muted)]">SEO content</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.seoContentTitle, selected.context.seoContentId ?? selected.source.id)}</dd></div> : null}
                  {detailMetaValue(selected.context.seoTaskTitle, selected.context.seoTaskId ?? selected.source.id) ? <div><dt className="text-[var(--color-pib-text-muted)]">SEO task</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.seoTaskTitle, selected.context.seoTaskId ?? selected.source.id)}</dd></div> : null}
                  {detailMetaValue(selected.context.adCampaignName, selected.context.adCampaignId ?? selected.source.id) ? <div><dt className="text-[var(--color-pib-text-muted)]">Ad campaign</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.adCampaignName, selected.context.adCampaignId ?? selected.source.id)}</dd></div> : null}
                  {detailMetaValue(selected.context.broadcastName, selected.context.broadcastId ?? selected.source.id) ? <div><dt className="text-[var(--color-pib-text-muted)]">Broadcast</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.broadcastName, selected.context.broadcastId ?? selected.source.id)}</dd></div> : null}
                  {detailMetaValue(selected.context.campaignName, selected.context.campaignId ?? selected.source.id) ? <div><dt className="text-[var(--color-pib-text-muted)]">Campaign</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.campaignName, selected.context.campaignId ?? selected.source.id)}</dd></div> : null}
                  {typeof selected.metadata?.sequenceId === 'string' && selected.metadata.sequenceId ? <div><dt className="text-[var(--color-pib-text-muted)]">Sequence</dt><dd className="text-[var(--color-pib-text)]">{selected.metadata.sequenceId}</dd></div> : null}
                  {typeof selected.metadata?.segmentId === 'string' && selected.metadata.segmentId ? <div><dt className="text-[var(--color-pib-text-muted)]">Segment</dt><dd className="text-[var(--color-pib-text)]">{selected.metadata.segmentId}</dd></div> : null}
                  {typeof selected.metadata?.subject === 'string' && selected.metadata.subject ? <div><dt className="text-[var(--color-pib-text-muted)]">Subject</dt><dd className="text-[var(--color-pib-text)]">{selected.metadata.subject}</dd></div> : null}
                  {typeof selected.metadata?.audienceSize === 'number' ? <div><dt className="text-[var(--color-pib-text-muted)]">Audience</dt><dd className="text-[var(--color-pib-text)]">{selected.metadata.audienceSize.toLocaleString('en-ZA')} recipients</dd></div> : null}
                  {detailMetaValue(selected.context.enquiryName, selected.context.enquiryId ?? selected.source.id) ? <div><dt className="text-[var(--color-pib-text-muted)]">Enquiry</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.enquiryName, selected.context.enquiryId ?? selected.source.id)}</dd></div> : null}
                  {detailMetaValue(selected.context.formName ?? selected.context.formId, selected.context.formSubmissionId ?? selected.source.id) ? <div><dt className="text-[var(--color-pib-text-muted)]">Form submission</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.formName ?? selected.context.formId, selected.context.formSubmissionId ?? selected.source.id)}</dd></div> : null}
                  {detailMetaValue(selected.context.socialInboxFrom, selected.context.socialInboxId ?? selected.source.id) ? <div><dt className="text-[var(--color-pib-text-muted)]">Social inbox</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.socialInboxFrom, selected.context.socialInboxId ?? selected.source.id)}</dd></div> : null}
                  {detailMetaValue(selected.context.mailboxFrom, selected.context.mailboxMessageId ?? selected.source.id) ? <div><dt className="text-[var(--color-pib-text-muted)]">Mailbox</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.mailboxFrom, selected.context.mailboxMessageId ?? selected.source.id)}</dd></div> : null}
                  {detailMetaValue(selected.context.agentProfile, selected.context.agentRunId ?? selected.source.id) ? <div><dt className="text-[var(--color-pib-text-muted)]">Agent run</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.agentProfile, selected.context.agentRunId ?? selected.source.id)}</dd></div> : null}
                  {typeof selected.metadata?.approvalToolName === 'string' && selected.metadata.approvalToolName ? <div><dt className="text-[var(--color-pib-text-muted)]">Approval tool</dt><dd className="text-[var(--color-pib-text)]">{selected.metadata.approvalToolName}</dd></div> : null}
                  {detailMetaValue(selected.context.workspaceBrokerOperation, selected.context.workspaceBrokerJobId ?? selected.source.id) ? <div><dt className="text-[var(--color-pib-text-muted)]">Workspace job</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.workspaceBrokerOperation, selected.context.workspaceBrokerJobId ?? selected.source.id)}</dd></div> : null}
                  {detailMetaValue(selected.context.workspaceArtifactTitle, selected.context.workspaceArtifactId) ? <div><dt className="text-[var(--color-pib-text-muted)]">Workspace artifact</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.workspaceArtifactTitle, selected.context.workspaceArtifactId)}</dd></div> : null}
                  {detailMetaValue(selected.context.calendarEventTitle, selected.context.calendarEventId ?? selected.source.id) ? <div><dt className="text-[var(--color-pib-text-muted)]">Calendar event</dt><dd className="text-[var(--color-pib-text)]">{detailMetaValue(selected.context.calendarEventTitle, selected.context.calendarEventId ?? selected.source.id)}</dd></div> : null}
                  <div><dt className="text-[var(--color-pib-text-muted)]">Occurred</dt><dd className="text-[var(--color-pib-text)]">{new Date(selected.occurredAt).toLocaleString('en-ZA')}</dd></div>
                  <div><dt className="text-[var(--color-pib-text-muted)]">Source</dt><dd className="text-[var(--color-pib-text)]">{sourceLabel(selected)}</dd></div>
                </dl>

                {(mode === 'admin' ? adminSourceHref(selected) : sourceHref(selected, mode, portalScope)) ? (
                  <a className="pib-btn-primary inline-flex w-full justify-center" href={(mode === 'admin' ? adminSourceHref(selected) : sourceHref(selected, mode, portalScope)) ?? undefined} target="_blank" rel="noopener noreferrer">
                    <Icon name="open_in_new" />
                    Open source
                  </a>
                ) : null}
              </div>
            </aside>
          </div>
        ) : null}
    </div>
  )

  return (
    <CockpitShell
      mode={mode}
      portalScope={portalScope}
      currentUser={currentUser}
      orgId={orgId}
      orgName={orgs.find((org) => org.id === orgId)?.name ?? (mode === 'portal' ? activeWorkspaceName : orgId ? undefined : 'All workspaces')}
      itemCount={pulseScopedItems.length}
      generatedAt={feed?.generatedAt}
      loading={loading}
      onRefresh={() => { void loadFeed() }}
      selectedContextSeed={selected ? briefingContextSeed(selected, mode, portalScope) : chatSeedItem ? briefingContextSeed(chatSeedItem, mode, portalScope) : null}
      chatOpen={chatOpen}
      onChatOpenChange={(open) => {
        setChatOpen(open)
        if (!open) setChatSeedId(null)
      }}
      onChatConversationLifecycle={handleChatLifecycle}
      rail={rail}
      workFeedContent={workFeedContent}
    />
  )
}
