/**
 * Source adapter for reports.
 *
 * Generates briefing items for:
 * - Stored snapshot reports
 * - Report generation events
 */

import type { BriefingSourceAdapter, BriefingPriority } from '../types'
import { normalizeActor, hashSourceDocument, extractMultiFieldExcerpt, normalizeTimestamp, extractOrgId } from '../utils'

/**
 * Report document shape.
 */
interface ReportDocument {
  id: string
  orgId: string
  type: string
  title: string
  description?: string | null
  status: string
  generatedBy: string
  generatedAt?: unknown
  expiresAt?: unknown
  data?: Record<string, unknown> | null
  filters?: Record<string, unknown> | null
  projectId?: string | null
  clientId?: string | null
  priority?: string
}

/**
 * Adapter for report briefing items.
 */
export const reportAdapter: BriefingSourceAdapter<ReportDocument> = {
  sourceType: 'report',
  collectionPath: 'reports',

  hashSource(doc: ReportDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['type', 'title', 'status', 'generatedAt', 'priority'])
  },

  shouldGenerate(doc: ReportDocument, _docId: string): boolean {
    // Only show generated or failed reports
    if (doc.status !== 'generated' && doc.status !== 'failed' && doc.status !== 'completed') {
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

  extractPriority(doc: ReportDocument, _docId: string): BriefingPriority {
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

    // Default to FYI
    return 'fyi'
  },

  extractActor(doc: ReportDocument, _docId: string) {
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
      reportTitle: doc.title,
    }
  },

  extractTitle(doc: ReportDocument, _docId: string): string {
    const status = doc.status.toLowerCase()

    if (status === 'failed') {
      return `Report failed: ${doc.title}`
    }

    if (status === 'generated' || status === 'completed') {
      return `Report available: ${doc.title}`
    }

    return `Report: ${doc.title}`
  },

  extractSummary(doc: ReportDocument, _docId: string): string {
    const parts: string[] = []

    parts.push(`Type: ${doc.type}`)
    parts.push(`Status: ${doc.status}`)

    if (doc.description) {
      const excerpt = extractMultiFieldExcerpt(doc, ['description'], { maxLength: 100 })
      if (excerpt) parts.push(excerpt)
    }

    // Add key metrics if available in data
    if (doc.data && typeof doc.data === 'object') {
      const data = doc.data as Record<string, unknown>
      const metrics: string[] = []

      if (typeof data.totalCount === 'number') metrics.push(`${data.totalCount} items`)
      if (typeof data.revenue === 'number') metrics.push(`$${data.revenue.toFixed(2)}`)
      if (typeof data.errorCount === 'number') metrics.push(`${data.errorCount} errors`)

      if (metrics.length > 0) {
        parts.push(`Metrics: ${metrics.join(', ')}`)
      }
    }

    return parts.join('. ') || 'No details.'
  },

  extractExcerpt(doc: ReportDocument, _docId: string, maxLength = 300): string | null {
    return extractMultiFieldExcerpt(doc, ['description'], { maxLength })
  },

  extractOccurredAt(doc: ReportDocument, _docId: string): Date | null {
    return normalizeTimestamp(doc.generatedAt)
  },

  extractMetadata(doc: ReportDocument, _docId: string): Record<string, unknown> | null {
    return {
      reportType: doc.type,
      status: doc.status,
      priority: doc.priority,
      generatedBy: doc.generatedBy,
      expiresAt: doc.expiresAt,
      hasFilters: doc.filters !== null,
      hasData: doc.data !== null,
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
        url: `/admin/reports/${docId}`,
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