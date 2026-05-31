/**
 * Source adapter for SEO sprint tasks.
 *
 * Turns active SEO work into admin control cards so the operations desk can
 * execute, complete, or skip tasks from the briefing surface.
 */

import type { BriefingPriority, BriefingSourceAdapter } from '../types'
import { extractMultiFieldExcerpt, extractOrgId, hashSourceDocument, normalizeTimestamp } from '../utils'

interface SeoTaskDocument extends Record<string, unknown> {
  orgId?: string | null
  orgSlug?: string | null
  sprintId?: string | null
  week?: number | string | null
  phase?: number | string | null
  focus?: string | null
  title?: string | null
  description?: string | null
  taskType?: string | null
  status?: string | null
  blockerReason?: string | null
  autopilotEligible?: boolean | null
  source?: string | null
  createdBy?: string | null
  createdByType?: string | null
  updatedAt?: unknown
  createdAt?: unknown
  dueAt?: unknown
  deleted?: boolean | null
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function seoOrgId(doc: SeoTaskDocument): string {
  return clean(doc.orgId) ?? extractOrgId(doc) ?? ''
}

function title(doc: SeoTaskDocument, docId: string): string {
  return clean(doc.title) ?? docId
}

function sourceUrl(doc: SeoTaskDocument, docId: string): string {
  const sprintId = clean(doc.sprintId)
  if (sprintId) return `/admin/seo/sprints/${encodeURIComponent(sprintId)}/tasks?task=${encodeURIComponent(docId)}`
  if (doc.orgSlug) return `/admin/org/${encodeURIComponent(doc.orgSlug)}/seo?task=${encodeURIComponent(docId)}`
  return `/admin/seo?task=${encodeURIComponent(docId)}`
}

function statusLabel(status: string | null): string {
  switch (status) {
    case 'blocked':
      return 'Blocked'
    case 'in_progress':
      return 'In-flight'
    case 'not_started':
      return 'Queued'
    default:
      return 'Active'
  }
}

export const seoTaskAdapter: BriefingSourceAdapter<SeoTaskDocument> = {
  sourceType: 'seo-task',
  collectionPath: 'seo_tasks',

  hashSource(doc: SeoTaskDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['title', 'status', 'blockerReason', 'taskType', 'updatedAt'])
  },

  shouldGenerate(doc: SeoTaskDocument): boolean {
    if (doc.deleted === true) return false
    return ['blocked', 'in_progress', 'not_started'].includes(clean(doc.status) ?? '')
  },

  extractPriority(doc: SeoTaskDocument): BriefingPriority {
    if (doc.status === 'blocked') return 'critical'
    if (doc.status === 'not_started') return 'needs-peet'
    return 'progress'
  },

  extractActor(doc: SeoTaskDocument) {
    const createdBy = clean(doc.createdBy)
    const createdByType = clean(doc.createdByType)
    const isAgent = createdByType === 'agent' || createdBy?.startsWith('agent:')
    return {
      id: createdBy ?? 'system',
      role: isAgent ? 'ai' as const : createdBy ? 'admin' as const : 'system' as const,
      type: isAgent ? 'agent' as const : createdBy ? 'user' as const : 'system' as const,
    }
  },

  extractContext(doc: SeoTaskDocument, docId: string) {
    return {
      orgId: seoOrgId(doc),
      orgSlug: clean(doc.orgSlug),
      seoTaskId: docId,
      seoTaskTitle: title(doc, docId),
      seoSprintId: clean(doc.sprintId),
    }
  },

  extractTitle(doc: SeoTaskDocument, docId: string): string {
    return `${statusLabel(clean(doc.status))} SEO task: ${title(doc, docId)}`
  },

  extractSummary(doc: SeoTaskDocument): string {
    const parts: string[] = []
    const focus = clean(doc.focus)
    const taskType = clean(doc.taskType)
    const status = clean(doc.status)
    if (focus && taskType) parts.push(`${focus} ${taskType} task is ${status ?? 'active'}`)
    else if (focus) parts.push(`${focus} SEO task is ${status ?? 'active'}`)
    else parts.push(`SEO task is ${status ?? 'active'}`)
    const blocker = clean(doc.blockerReason)
    if (blocker) parts.push(blocker)
    const week = numeric(doc.week)
    const phase = numeric(doc.phase)
    if (week) parts.push(`Week ${week}${phase ? `, phase ${phase}` : ''}`)
    return parts.join('. ')
  },

  extractExcerpt(doc: SeoTaskDocument, docId: string, maxLength = 300): string | null {
    const summary = this.extractSummary(doc, docId)
    const text = [doc.blockerReason, doc.description, summary].filter((value) => typeof value === 'string' && value.trim().length > 0).join('. ')
    return extractMultiFieldExcerpt({ text }, ['text'], { maxLength })
  },

  extractOccurredAt(doc: SeoTaskDocument): Date | null {
    return normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.dueAt) ?? normalizeTimestamp(doc.createdAt)
  },

  extractMetadata(doc: SeoTaskDocument): Record<string, unknown> | null {
    return {
      seoTaskStatus: clean(doc.status),
      taskType: clean(doc.taskType),
      focus: clean(doc.focus),
      week: numeric(doc.week),
      phase: numeric(doc.phase),
      autopilotEligible: doc.autopilotEligible === true,
      blockerReason: clean(doc.blockerReason),
      sprintId: clean(doc.sprintId),
      source: clean(doc.source),
    }
  },

  toItem(doc: SeoTaskDocument, docId: string) {
    const orgId = seoOrgId(doc)
    const occurredAt = this.extractOccurredAt(doc, docId) ?? new Date()
    return {
      orgId,
      source: {
        type: this.sourceType,
        id: docId,
        collectionPath: this.collectionPath,
        url: sourceUrl(doc, docId),
      },
      priority: this.extractPriority(doc, docId),
      status: 'active',
      title: this.extractTitle(doc, docId),
      summary: this.extractSummary(doc, docId),
      excerpt: this.extractExcerpt(doc, docId),
      actor: this.extractActor(doc, docId),
      context: this.extractContext(doc, docId),
      occurredAt,
      sourceHash: this.hashSource(doc, docId),
      metadata: this.extractMetadata?.(doc, docId),
      createdAt: occurredAt,
      updatedAt: occurredAt,
    }
  },
}
