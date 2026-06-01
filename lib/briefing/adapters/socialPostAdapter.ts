import type { BriefingPriority, BriefingSourceAdapter } from '../types'
import { extractMultiFieldExcerpt, extractOrgId, hashSourceDocument, normalizeTimestamp } from '../utils'

interface SocialPostDocument extends Record<string, unknown> {
  id: string
  orgId: string
  status?: string
  platform?: string
  platforms?: unknown
  content?: unknown
  caption?: string
  title?: string
  campaign?: string | null
  source?: string
  assignedTo?: string | null
  createdBy?: string | null
  updatedBy?: string | null
  scheduledAt?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

function contentText(doc: SocialPostDocument): string | null {
  if (typeof doc.content === 'string') return doc.content
  if (doc.content && typeof doc.content === 'object') {
    const text = (doc.content as Record<string, unknown>).text
    if (typeof text === 'string') return text
  }
  return typeof doc.caption === 'string' ? doc.caption : typeof doc.title === 'string' ? doc.title : null
}

function platforms(doc: SocialPostDocument): string[] {
  if (Array.isArray(doc.platforms)) {
    return doc.platforms.filter((value): value is string => typeof value === 'string' && value.length > 0)
  }
  return typeof doc.platform === 'string' && doc.platform.length > 0 ? [doc.platform] : []
}

function platformLabel(doc: SocialPostDocument): string {
  const names = platforms(doc)
  if (names.length === 0) return 'social'
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

function actionStage(status?: string): 'qa' | 'client' | 'publish' | 'risk' | null {
  if (status === 'qa_review') return 'qa'
  if (status === 'client_review' || status === 'pending_approval') return 'client'
  if (status === 'approved' || status === 'scheduled') return 'publish'
  if (status === 'failed') return 'risk'
  return null
}

function sourceUrl(docId: string, stage: ReturnType<typeof actionStage>) {
  if (stage === 'qa') return `/admin/social/qa/${docId}`
  if (stage === 'client') return `/portal/social/review/${docId}`
  return `/admin/social?postId=${encodeURIComponent(docId)}`
}

export const socialPostAdapter: BriefingSourceAdapter<SocialPostDocument> = {
  sourceType: 'social-post',
  collectionPath: 'social_posts',

  hashSource(doc: SocialPostDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['status', 'content', 'caption', 'platform', 'platforms', 'scheduledAt', 'updatedAt'])
  },

  shouldGenerate(doc: SocialPostDocument): boolean {
    return actionStage(doc.status) !== null
  },

  extractPriority(doc: SocialPostDocument): BriefingPriority {
    const stage = actionStage(doc.status)
    if (stage === 'client') return 'needs-peet'
    if (stage === 'qa') return 'review'
    if (stage === 'risk') return 'client-risk'
    return 'progress'
  },

  extractActor(doc: SocialPostDocument) {
    const assigned = typeof doc.assignedTo === 'string' ? doc.assignedTo : null
    const createdBy = typeof doc.createdBy === 'string' ? doc.createdBy : null
    const updatedBy = typeof doc.updatedBy === 'string' ? doc.updatedBy : null
    const source = typeof doc.source === 'string' ? doc.source : null
    const actorId = assigned || createdBy || updatedBy || (source === 'ai_agent' ? 'agent:maya' : 'system')
    const isAgent = actorId.startsWith('agent:') || source === 'ai_agent'

    return {
      id: isAgent && !actorId.startsWith('agent:') ? `agent:${actorId}` : actorId,
      name: isAgent ? actorId.replace(/^agent:/, '') : null,
      role: isAgent ? 'ai' as const : actorId === 'system' ? 'system' as const : 'admin' as const,
      type: isAgent ? 'agent' as const : actorId === 'system' ? 'system' as const : 'user' as const,
    }
  },

  extractContext(doc: SocialPostDocument) {
    return { orgId: extractOrgId(doc) ?? '' }
  },

  extractTitle(doc: SocialPostDocument): string {
    const stage = actionStage(doc.status)
    if (stage === 'qa') return 'Social post awaiting QA review'
    if (stage === 'client') return 'Social post awaiting client approval'
    if (stage === 'risk') return 'Social post needs publishing attention'
    return 'Social post changed'
  },

  extractSummary(doc: SocialPostDocument): string {
    const parts = [`Status: ${doc.status ?? 'unknown'}`, `Platforms: ${platformLabel(doc)}`]
    if (doc.campaign) parts.push(`Campaign: ${doc.campaign}`)
    const scheduled = normalizeTimestamp(doc.scheduledAt)
    if (scheduled) parts.push(`Scheduled: ${scheduled.toLocaleString('en-ZA')}`)
    const excerpt = contentText(doc)
    if (excerpt) parts.push(`Copy: ${extractMultiFieldExcerpt({ copy: excerpt }, ['copy'], { maxLength: 140 })}`)
    return parts.join('. ')
  },

  extractExcerpt(doc: SocialPostDocument, _docId: string, maxLength = 300): string | null {
    return extractMultiFieldExcerpt({ copy: contentText(doc) }, ['copy'], { maxLength })
  },

  extractOccurredAt(doc: SocialPostDocument): Date | null {
    return normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.createdAt) ?? normalizeTimestamp(doc.scheduledAt)
  },

  extractMetadata(doc: SocialPostDocument): Record<string, unknown> | null {
    return {
      status: doc.status,
      actionStage: actionStage(doc.status),
      platforms: platforms(doc),
      campaign: doc.campaign ?? null,
      scheduledAt: normalizeTimestamp(doc.scheduledAt)?.toISOString() ?? null,
    }
  },

  toItem(doc: SocialPostDocument, docId: string) {
    const orgId = extractOrgId(doc) ?? ''
    const stage = actionStage(doc.status)
    const occurredAt = this.extractOccurredAt(doc, docId) ?? new Date()

    return {
      orgId,
      source: {
        type: this.sourceType,
        id: docId,
        collectionPath: this.collectionPath,
        url: sourceUrl(docId, stage),
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
