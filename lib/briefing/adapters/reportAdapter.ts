/**
 * Source adapter for reports.
 *
 * Generates briefing items for:
 * - Stored snapshot reports
 * - Report generation events
 */

import type { BriefingSourceAdapter, BriefingPriority } from '../types'
import { hashSourceDocument, extractMultiFieldExcerpt, normalizeTimestamp, extractOrgId } from '../utils'

/**
 * Report document shape.
 */
interface ReportDocument extends Record<string, unknown> {
  id: string
  orgId: string
  type: string
  title: string
  description?: string | null
  exec_summary?: string | null
  highlights?: string[] | null
  status: string
  generatedBy: string
  generatedAt?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  sentAt?: unknown
  expiresAt?: unknown
  data?: Record<string, unknown> | null
  kpis?: Record<string, unknown> | null
  filters?: Record<string, unknown> | null
  publicToken?: string | null
  period?: { start?: string; end?: string; tz?: string } | null
  brand?: { orgName?: string | null } | null
  projectId?: string | null
  clientId?: string | null
  priority?: string
}

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function reportTitle(doc: ReportDocument): string {
  return cleanString(doc.title) ?? cleanString(doc.brand?.orgName) ?? 'Performance report'
}

function reportSourceUrl(doc: ReportDocument, docId: string): string {
  const token = cleanString(doc.publicToken)
  if (token) return `/reports/${encodeURIComponent(token)}`
  return `/portal/reports?reportId=${encodeURIComponent(docId)}`
}

/**
 * Adapter for report briefing items.
 */
export const reportAdapter: BriefingSourceAdapter<ReportDocument> = {
  sourceType: 'report',
  collectionPath: 'reports',

  hashSource(doc: ReportDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['type', 'title', 'status', 'generatedAt', 'createdAt', 'updatedAt', 'sentAt', 'priority'])
  },

  shouldGenerate(doc: ReportDocument, docId: string): boolean {
    void docId
    // Only show report states that represent something a user can review or audit.
    if (!['generated', 'failed', 'completed', 'rendered', 'sent'].includes(doc.status)) {
      return false
    }

    // Skip expired reports
    if (doc.expiresAt) {
      const expiresAt = normalizeTimestamp(doc.expiresAt)
      if (expiresAt && expiresAt < new Date()) {
        return false
      }
    }

    return true
  },

  extractPriority(doc: ReportDocument, docId: string): BriefingPriority {
    void docId
    const type = doc.type.toLowerCase()

    // Failed reports are critical
    if (doc.status === 'failed') {
      return 'critical'
    }

    // Security reports are critical
    if (type.includes('security') || type.includes('incident') || type.includes('compliance')) {
      return 'critical'
    }

    // Financial/billing reports are client-risk
    if (type.includes('billing') || type.includes('financial') || type.includes('invoice')) {
      return 'client-risk'
    }

    // Report priority from document
    if (doc.priority === 'urgent') {
      return 'critical'
    }

    if (doc.priority === 'high') {
      return 'needs-peet'
    }

    if (doc.status === 'rendered' || doc.status === 'generated' || doc.status === 'completed') {
      return 'review'
    }

    // Default to FYI
    return 'fyi'
  },

  extractActor(doc: ReportDocument, docId: string) {
    void docId
    const generatedBy = typeof doc.generatedBy === 'string' ? doc.generatedBy : 'system'

    // Check if it's an agent
    if (generatedBy.startsWith('agent:')) {
      const agentId = generatedBy.replace('agent:', '')
      const agentName = agentId.charAt(0).toUpperCase() + agentId.slice(1)
      return {
        id: generatedBy,
        name: agentName,
        role: 'ai' as const,
        type: 'agent' as const,
      }
    }

    // System-generated
    if (generatedBy === 'system') {
      return {
        id: 'system',
        name: 'System',
        role: 'system' as const,
        type: 'system' as const,
      }
    }

    // User-generated
    const userName = generatedBy.includes('@') ? generatedBy.split('@')[0] : generatedBy
    return {
      id: generatedBy,
      name: userName,
      role: 'admin' as const,
      type: 'user' as const,
    }
  },

  extractContext(doc: ReportDocument, _docId: string) {
    const orgId = extractOrgId(doc) ?? ''
    const projectId = typeof doc.projectId === 'string' ? doc.projectId : null
    const clientId = typeof doc.clientId === 'string' ? doc.clientId : null

    return {
      orgId,
      projectId,
      clientId,
      reportId: _docId,
      reportTitle: reportTitle(doc),
    }
  },

  extractTitle(doc: ReportDocument, docId: string): string {
    void docId
    const status = doc.status.toLowerCase()
    const title = reportTitle(doc)

    if (status === 'failed') {
      return `Report failed: ${title}`
    }

    if (status === 'rendered' || status === 'generated' || status === 'completed') {
      return `Report ready to review: ${title}`
    }

    if (status === 'sent') {
      return `Report sent: ${title}`
    }

    return `Report: ${title}`
  },

  extractSummary(doc: ReportDocument, docId: string): string {
    void docId
    const parts: string[] = []

    parts.push(`Type: ${doc.type}`)
    parts.push(`Status: ${doc.status}`)

    if (doc.description || doc.exec_summary) {
      const excerpt = extractMultiFieldExcerpt(doc, ['description', 'exec_summary'], { maxLength: 160 })
      if (excerpt) parts.push(excerpt)
    }

    if (doc.period?.start && doc.period?.end) {
      parts.push(`Period: ${doc.period.start} to ${doc.period.end}`)
    }

    // Add key metrics if available in data
    const metricSource = doc.kpis ?? doc.data
    if (metricSource && typeof metricSource === 'object') {
      const data = metricSource as Record<string, unknown>
      const metrics: string[] = []

      if (typeof data.totalCount === 'number') metrics.push(`${data.totalCount} items`)
      if (typeof data.total_revenue === 'number') metrics.push(`Revenue R${data.total_revenue.toFixed(0)}`)
      if (typeof data.revenue === 'number') metrics.push(`Revenue R${data.revenue.toFixed(0)}`)
      if (typeof data.mrr === 'number') metrics.push(`MRR R${data.mrr.toFixed(0)}`)
      if (typeof data.errorCount === 'number') metrics.push(`${data.errorCount} errors`)

      if (metrics.length > 0) {
        parts.push(`Metrics: ${metrics.join(', ')}`)
      }
    }

    return parts.join('. ') || 'No details.'
  },

  extractExcerpt(doc: ReportDocument, docId: string, maxLength = 300): string | null {
    void docId
    return extractMultiFieldExcerpt(doc, ['description', 'exec_summary'], { maxLength })
  },

  extractOccurredAt(doc: ReportDocument, docId: string): Date | null {
    void docId
    return normalizeTimestamp(doc.sentAt) ?? normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.generatedAt) ?? normalizeTimestamp(doc.createdAt)
  },

  extractMetadata(doc: ReportDocument, docId: string): Record<string, unknown> | null {
    void docId
    const kpis = doc.kpis ?? {}
    return {
      reportType: doc.type,
      status: doc.status,
      priority: doc.priority,
      generatedBy: doc.generatedBy,
      publicToken: cleanString(doc.publicToken),
      expiresAt: doc.expiresAt,
      hasFilters: doc.filters !== null,
      hasData: doc.data !== null || doc.kpis !== null,
      periodStart: doc.period?.start,
      periodEnd: doc.period?.end,
      totalRevenue: typeof kpis.total_revenue === 'number' ? kpis.total_revenue : undefined,
      mrr: typeof kpis.mrr === 'number' ? kpis.mrr : undefined,
    }
  },

  toItem(doc: ReportDocument, docId: string) {
    const orgId = extractOrgId(doc) ?? ''
    const priority = this.extractPriority(doc, docId)
    const actor = this.extractActor(doc, docId)
    const context = this.extractContext(doc, docId)
    const title = this.extractTitle(doc, docId)
    const summary = this.extractSummary(doc, docId)
    const excerpt = this.extractExcerpt(doc, docId)
    const occurredAt = this.extractOccurredAt(doc, docId) ?? new Date()
    const metadata = this.extractMetadata?.(doc, docId)
    const sourceHash = this.hashSource(doc, docId)

    return {
      orgId,
      source: {
        type: this.sourceType,
        id: docId,
        collectionPath: this.collectionPath,
        url: reportSourceUrl(doc, docId),
      },
      priority,
      status: 'active',
      title,
      summary,
      excerpt,
      actor,
      context,
      occurredAt,
      sourceHash,
      metadata,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    }
  },
}
