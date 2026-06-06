import { FieldValue } from 'firebase-admin/firestore'

import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'
import {
  normalizeResourceRelationshipLinks,
} from '@/lib/client-documents/linkedValidation'
import type {
  ResearchConfidence,
  ResearchFinding,
  ResearchItem,
  ResearchKind,
  ResearchLinked,
  ResearchRecommendation,
  ResearchSource,
  ResearchSourceType,
  ResearchStatus,
  ResearchVisibility,
} from '@/lib/research/types'
import {
  RESEARCH_CONFIDENCES,
  RESEARCH_FINDING_STATUSES,
  RESEARCH_KINDS,
  RESEARCH_RECOMMENDATION_PRIORITIES,
  RESEARCH_RECOMMENDATION_STATUSES,
  RESEARCH_SOURCE_TYPES,
  RESEARCH_STATUSES,
  RESEARCH_VISIBILITIES,
} from '@/lib/research/types'

export const RESEARCH_COLLECTION = 'research_items'

type FindingInput = Partial<Omit<ResearchFinding, 'id'>> & { id?: string; title?: string; body?: string }
type RecommendationInput = Partial<Omit<ResearchRecommendation, 'id'>> & { id?: string; title?: string; body?: string }

export type ResearchCreateInput = {
  orgId: string
  title: string
  kind?: ResearchKind
  status?: ResearchStatus
  visibility?: ResearchVisibility
  summary?: string
  notesMarkdown?: string
  tags?: string[]
  linked?: ResearchLinked
  findings?: FindingInput[]
  recommendations?: RecommendationInput[]
  user: ApiUser
}

export type ResearchUpdateInput = Partial<Omit<ResearchCreateInput, 'orgId' | 'user'>> & {
  orgId?: string
}

export type ResearchSourceInput = {
  type?: ResearchSourceType
  title: string
  url?: string
  excerpt?: string
  mediaUrl?: string
  sourceDate?: string
  publisher?: string
  confidence?: ResearchConfidence
  verified?: boolean
  rawText?: string
  metadata?: Record<string, unknown>
}

export type ResearchListFilters = {
  orgId: string
  status?: ResearchStatus
  kind?: ResearchKind
  visibility?: ResearchVisibility
  q?: string
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback
}

function optionalOneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : undefined
}

export function slugifyResearchTitle(title: string) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'research'
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean)))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function withoutUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((item) => withoutUndefinedDeep(item))
      .filter((item) => item !== undefined) as T
  }

  if (!isPlainObject(value)) return value

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key, withoutUndefinedDeep(entry)] as const)
      .filter(([, entry]) => entry !== undefined),
  ) as T
}

function linked(value: unknown): ResearchLinked {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const input = value as Record<string, unknown>
  const result: ResearchLinked = {}
  const relationshipInput = Object.fromEntries(Object.entries(input).filter(([key]) => [
    'companyId',
    'contactId',
    'clientOrgId',
    'projectId',
    'dealId',
    'companyIds',
    'contactIds',
    'clientOrgIds',
    'projectIds',
    'dealIds',
    'socialPostIds',
    'emailThreadIds',
    'supportTicketIds',
    'contextRefs',
  ].includes(key)))
  const relationship = normalizeResourceRelationshipLinks(relationshipInput)
  if (relationship.ok === false) throw new Error(relationship.error)
  Object.assign(result, relationship.value)
  for (const key of ['campaignId', 'seoSprintId'] as const) {
    if (typeof input[key] === 'string' && input[key].trim()) result[key] = input[key].trim()
  }
  const documentIds = strings(input.documentIds)
  if (documentIds.length) result.documentIds = documentIds
  return result
}

function normalizeFindings(input: FindingInput[] | undefined): ResearchFinding[] {
  return (input ?? [])
    .filter((finding) => typeof finding.title === 'string' && finding.title.trim())
    .map((finding, index) => ({
      id: typeof finding.id === 'string' && finding.id.trim() ? finding.id.trim() : `finding-${index + 1}`,
      title: finding.title!.trim(),
      body: typeof finding.body === 'string' ? finding.body.trim() : '',
      confidence: oneOf(finding.confidence, RESEARCH_CONFIDENCES, 'medium'),
      status: oneOf(finding.status, RESEARCH_FINDING_STATUSES, 'open'),
      sourceIds: strings(finding.sourceIds),
      tags: strings(finding.tags),
    }))
}

function normalizeRecommendations(input: RecommendationInput[] | undefined): ResearchRecommendation[] {
  return (input ?? [])
    .filter((recommendation) => typeof recommendation.title === 'string' && recommendation.title.trim())
    .map((recommendation, index) => ({
      id: typeof recommendation.id === 'string' && recommendation.id.trim() ? recommendation.id.trim() : `recommendation-${index + 1}`,
      title: recommendation.title!.trim(),
      body: typeof recommendation.body === 'string' ? recommendation.body.trim() : '',
      priority: oneOf(recommendation.priority, RESEARCH_RECOMMENDATION_PRIORITIES, 'medium'),
      status: oneOf(recommendation.status, RESEARCH_RECOMMENDATION_STATUSES, 'open'),
      sourceIds: strings(recommendation.sourceIds),
    }))
}

export function validateResearchFilters(searchParams: URLSearchParams): {
  ok: true
  filters: Omit<ResearchListFilters, 'orgId'>
} | { ok: false; error: string } {
  const kind = searchParams.get('kind')
  const status = searchParams.get('status')
  const visibility = searchParams.get('visibility')
  if (kind && !RESEARCH_KINDS.includes(kind as ResearchKind)) return { ok: false, error: `kind must be one of: ${RESEARCH_KINDS.join(', ')}` }
  if (status && !RESEARCH_STATUSES.includes(status as ResearchStatus)) return { ok: false, error: `status must be one of: ${RESEARCH_STATUSES.join(', ')}` }
  if (visibility && !RESEARCH_VISIBILITIES.includes(visibility as ResearchVisibility)) return { ok: false, error: `visibility must be one of: ${RESEARCH_VISIBILITIES.join(', ')}` }
  return {
    ok: true,
    filters: {
      kind: kind as ResearchKind | undefined,
      status: status as ResearchStatus | undefined,
      visibility: visibility as ResearchVisibility | undefined,
      q: searchParams.get('q')?.trim() || undefined,
    },
  }
}

export async function createResearchItem(input: ResearchCreateInput): Promise<{ id: string }> {
  const title = input.title.trim()
  if (!title) throw new Error('title is required')
  if (!input.orgId) throw new Error('orgId is required')

  const ref = adminDb.collection(RESEARCH_COLLECTION).doc()
  const now = FieldValue.serverTimestamp()
  await ref.set({
    orgId: input.orgId,
    title,
    slug: slugifyResearchTitle(title),
    kind: oneOf(input.kind, RESEARCH_KINDS, 'other'),
    status: oneOf(input.status, RESEARCH_STATUSES, 'draft'),
    visibility: oneOf(input.visibility, RESEARCH_VISIBILITIES, 'internal'),
    summary: input.summary?.trim() ?? '',
    notesMarkdown: input.notesMarkdown?.trim() ?? '',
    tags: strings(input.tags),
    linked: linked(input.linked),
    findings: normalizeFindings(input.findings),
    recommendations: normalizeRecommendations(input.recommendations),
    obsidian: { exported: false },
    createdAt: now,
    createdBy: input.user.uid,
    updatedAt: now,
    updatedBy: input.user.uid,
    deleted: false,
  })
  return { id: ref.id }
}

export async function listResearchItems(filters: ResearchListFilters): Promise<ResearchItem[]> {
  // Query only by tenant to avoid composite-index blockers; filter in memory.
  const snap = await adminDb.collection(RESEARCH_COLLECTION).where('orgId', '==', filters.orgId).get()
  const q = filters.q?.toLowerCase()
  return snap.docs
    .map((doc: FirebaseFirestore.QueryDocumentSnapshot) => ({ id: doc.id, ...doc.data() }) as ResearchItem)
    .filter((item) => item.deleted !== true)
    .filter((item) => !filters.kind || item.kind === filters.kind)
    .filter((item) => !filters.status || item.status === filters.status)
    .filter((item) => !filters.visibility || item.visibility === filters.visibility)
    .filter((item) => {
      if (!q) return true
      const haystack = [
        item.title,
        item.summary,
        item.notesMarkdown,
        ...(item.tags ?? []),
        ...(item.findings ?? []).flatMap((finding) => [finding.title, finding.body, ...(finding.tags ?? [])]),
        ...(item.recommendations ?? []).flatMap((recommendation) => [recommendation.title, recommendation.body]),
      ].join(' ').toLowerCase()
      return haystack.includes(q)
    })
}

export async function getResearchItem(id: string, expectedOrgId?: string, includeDeleted = false): Promise<ResearchItem | null> {
  const snap = await adminDb.collection(RESEARCH_COLLECTION).doc(id).get()
  if (!snap.exists) return null
  const item = { id: snap.id, ...snap.data() } as ResearchItem
  if (!includeDeleted && item.deleted === true) return null
  if (expectedOrgId && item.orgId !== expectedOrgId) return null
  return item
}

export async function updateResearchItem(id: string, input: ResearchUpdateInput, user: ApiUser): Promise<void> {
  const updates: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: user.uid,
  }
  if (typeof input.title === 'string' && input.title.trim()) {
    updates.title = input.title.trim()
    updates.slug = slugifyResearchTitle(input.title)
  }
  const kind = optionalOneOf(input.kind, RESEARCH_KINDS)
  if (kind) updates.kind = kind
  const status = optionalOneOf(input.status, RESEARCH_STATUSES)
  if (status) updates.status = status
  const visibility = optionalOneOf(input.visibility, RESEARCH_VISIBILITIES)
  if (visibility) updates.visibility = visibility
  if (typeof input.summary === 'string') updates.summary = input.summary.trim()
  if (typeof input.notesMarkdown === 'string') updates.notesMarkdown = input.notesMarkdown.trim()
  if (Array.isArray(input.tags)) updates.tags = strings(input.tags)
  if (input.linked !== undefined) updates.linked = linked(input.linked)
  if (Array.isArray(input.findings)) updates.findings = normalizeFindings(input.findings)
  if (Array.isArray(input.recommendations)) updates.recommendations = normalizeRecommendations(input.recommendations)
  await adminDb.collection(RESEARCH_COLLECTION).doc(id).update(updates)
}

export async function archiveResearchItem(id: string, user: ApiUser): Promise<void> {
  await adminDb.collection(RESEARCH_COLLECTION).doc(id).update({
    status: 'archived',
    deleted: true,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: user.uid,
  })
}

export async function listResearchSources(researchItemId: string): Promise<ResearchSource[]> {
  const snap = await adminDb.collection(RESEARCH_COLLECTION).doc(researchItemId).collection('sources').get()
  return snap.docs
    .map((doc: FirebaseFirestore.QueryDocumentSnapshot) => ({ id: doc.id, researchItemId, ...doc.data() }) as ResearchSource)
    .filter((source) => source.deleted !== true)
}

export async function createResearchSource(researchItemId: string, input: ResearchSourceInput, user: ApiUser): Promise<{ id: string }> {
  const title = input.title.trim()
  if (!title) throw new Error('title is required')
  const ref = adminDb.collection(RESEARCH_COLLECTION).doc(researchItemId).collection('sources').doc()
  const now = FieldValue.serverTimestamp()
  await ref.set(withoutUndefinedDeep({
    researchItemId,
    type: oneOf(input.type, RESEARCH_SOURCE_TYPES, 'note'),
    title,
    url: input.url?.trim() || undefined,
    excerpt: input.excerpt?.trim() || undefined,
    mediaUrl: input.mediaUrl?.trim() || undefined,
    sourceDate: input.sourceDate?.trim() || undefined,
    publisher: input.publisher?.trim() || undefined,
    confidence: oneOf(input.confidence, RESEARCH_CONFIDENCES, 'medium'),
    verified: input.verified === true,
    rawText: input.rawText?.trim() || undefined,
    metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata : undefined,
    createdAt: now,
    createdBy: user.uid,
    updatedAt: now,
    updatedBy: user.uid,
    deleted: false,
  }))
  return { id: ref.id }
}

export async function updateResearchSource(researchItemId: string, sourceId: string, input: Partial<ResearchSourceInput>, user: ApiUser): Promise<void> {
  const updates: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: user.uid,
  }
  if (typeof input.title === 'string' && input.title.trim()) updates.title = input.title.trim()
  const type = optionalOneOf(input.type, RESEARCH_SOURCE_TYPES)
  if (type) updates.type = type
  const confidence = optionalOneOf(input.confidence, RESEARCH_CONFIDENCES)
  if (confidence) updates.confidence = confidence
  for (const key of ['url', 'excerpt', 'mediaUrl', 'sourceDate', 'publisher', 'rawText'] as const) {
    if (typeof input[key] === 'string') updates[key] = input[key]!.trim()
  }
  if (typeof input.verified === 'boolean') updates.verified = input.verified
  if (input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)) updates.metadata = input.metadata
  await adminDb.collection(RESEARCH_COLLECTION).doc(researchItemId).collection('sources').doc(sourceId).update(withoutUndefinedDeep(updates))
}

export async function archiveResearchSource(researchItemId: string, sourceId: string, user: ApiUser): Promise<void> {
  await adminDb.collection(RESEARCH_COLLECTION).doc(researchItemId).collection('sources').doc(sourceId).update({
    deleted: true,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: user.uid,
  })
}

export async function markResearchObsidianExported(id: string, path: string, sourcesPath: string, user: ApiUser): Promise<void> {
  await adminDb.collection(RESEARCH_COLLECTION).doc(id).update({
    obsidian: {
      exported: true,
      path,
      sourcesPath,
      exportedAt: FieldValue.serverTimestamp(),
      exportedBy: user.uid,
    },
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: user.uid,
  })
}
