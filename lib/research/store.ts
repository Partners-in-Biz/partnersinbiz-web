import { FieldValue } from 'firebase-admin/firestore'

import { actorFrom, lastActorFrom, ownerUidFrom } from '@/lib/api/actor'
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
import {
  buildDesignContextRecord,
  hasDesignContextFacts,
  isDesignGatherPath,
  normalizeDesignContextPayload,
  type DesignContextGatherPath,
  type DesignContextRecord,
} from '@/lib/research/design-context'

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
  designContext?: unknown
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
  companyId?: string
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
      companyId: searchParams.get('companyId')?.trim()
        || searchParams.get('sourceCompanyId')?.trim()
        || undefined,
    },
  }
}

export async function createResearchItem(input: ResearchCreateInput): Promise<{ id: string }> {
  const title = input.title.trim()
  if (!title) throw new Error('title is required')
  if (!input.orgId) throw new Error('orgId is required')

  const ref = adminDb.collection(RESEARCH_COLLECTION).doc()
  const now = FieldValue.serverTimestamp()
  const created = actorFrom(input.user)
  const updated = lastActorFrom(input.user)
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
    ...(input.designContext !== undefined && input.designContext !== null
      ? { designContext: normalizeDesignContextRecordOnCreate(input.designContext, input.user) }
      : {}),
    obsidian: { exported: false },
    createdAt: now,
    ...created,
    updatedAt: now,
    updatedBy: updated.updatedBy,
    updatedByType: updated.updatedByType,
    ...(updated.updatedByAgentId ? { updatedByAgentId: updated.updatedByAgentId } : {}),
    deleted: false,
  })
  return { id: ref.id }
}

/**
 * Normalize a full DesignContext payload at create time. Accepts either a
 * full record (version/history preserved) or a bare payload (starts at v1).
 */
function normalizeDesignContextRecordOnCreate(value: unknown, user: ApiUser): DesignContextRecord {
  const payload = normalizeDesignContextPayload(value)
  if (!hasDesignContextFacts(payload)) throw new Error('designContext must contain at least one design fact')
  const rec = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const version = typeof rec.version === 'number' && Number.isFinite(rec.version) && rec.version > 0 ? Math.floor(rec.version) : 1
  const source = isDesignGatherPath(rec.source) ? rec.source : 'questionnaire'
  const history = Array.isArray(rec.history) ? rec.history : []
  const updatedBy = typeof rec.updatedBy === 'string' && rec.updatedBy.trim() ? rec.updatedBy.trim() : ownerUidFrom(user)
  return {
    ...payload,
    version,
    source,
    ...(typeof rec.sourceUrl === 'string' && rec.sourceUrl.trim() ? { sourceUrl: rec.sourceUrl.trim() } : {}),
    history,
    ...(updatedBy ? { updatedBy } : {}),
  }
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
      if (!filters.companyId) return true
      const wanted = filters.companyId.trim()
      return item.linked?.companyId === wanted || Boolean(item.linked?.companyIds?.includes(wanted))
    })
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
    ...lastActorFrom(user),
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
  if (input.designContext !== undefined) {
    if (input.designContext === null) {
      updates.designContext = FieldValue.delete()
    } else {
      const payload = normalizeDesignContextPayload(input.designContext)
      if (!hasDesignContextFacts(payload)) throw new Error('designContext must contain at least one design fact')
      const current = await getResearchItem(id)
      const record = buildDesignContextRecord({
        payload,
        source: isDesignGatherPath((input.designContext as Record<string, unknown>).source)
          ? (input.designContext as Record<string, unknown>).source as DesignContextGatherPath
          : (current?.designContext?.source ?? 'manual'),
        sourceUrl: typeof (input.designContext as Record<string, unknown>).sourceUrl === 'string'
          ? (input.designContext as Record<string, unknown>).sourceUrl as string
          : undefined,
        previous: current?.designContext ?? null,
        updatedBy: ownerUidFrom(user),
      })
      updates.designContext = record
    }
  }
  await adminDb.collection(RESEARCH_COLLECTION).doc(id).update(updates)
}

export async function archiveResearchItem(id: string, user: ApiUser): Promise<void> {
  await adminDb.collection(RESEARCH_COLLECTION).doc(id).update({
    status: 'archived',
    deleted: true,
    ...lastActorFrom(user),
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
  const created = actorFrom(user)
  const updated = lastActorFrom(user)
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
    ...created,
    updatedAt: now,
    updatedBy: updated.updatedBy,
    updatedByType: updated.updatedByType,
    ...(updated.updatedByAgentId ? { updatedByAgentId: updated.updatedByAgentId } : {}),
    deleted: false,
  }))
  return { id: ref.id }
}

export async function updateResearchSource(researchItemId: string, sourceId: string, input: Partial<ResearchSourceInput>, user: ApiUser): Promise<void> {
  const updates: Record<string, unknown> = {
    ...lastActorFrom(user),
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
    ...lastActorFrom(user),
  })
}

export async function markResearchObsidianExported(id: string, path: string, sourcesPath: string, user: ApiUser): Promise<void> {
  const updated = lastActorFrom(user)
  await adminDb.collection(RESEARCH_COLLECTION).doc(id).update({
    obsidian: {
      exported: true,
      path,
      sourcesPath,
      exportedAt: FieldValue.serverTimestamp(),
      exportedBy: ownerUidFrom(user) || user.uid,
      ...(updated.updatedByAgentId ? { exportedByAgentId: updated.updatedByAgentId } : {}),
    },
    ...updated,
  })
}

/**
 * Find the design-context research item for an org (kind='design',
 * not deleted, not archived). When companyId is supplied, prefer items linked
 * to that company; otherwise return the most recently updated design item.
 */
export async function findDesignContextItem(
  orgId: string,
  companyId?: string | null,
): Promise<ResearchItem | null> {
  const snap = await adminDb
    .collection(RESEARCH_COLLECTION)
    .where('orgId', '==', orgId)
    .get()
  const candidates = snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as ResearchItem)
    .filter((item) => item.deleted !== true)
    .filter((item) => item.status !== 'archived')
    .filter((item) => item.kind === 'design')
    .filter((item) => !!item.designContext && hasDesignContextFacts(item.designContext))

  if (candidates.length === 0) return null
  const companyFiltered = companyId?.trim()
    ? candidates.filter((item) => item.linked?.companyId === companyId.trim() || item.linked?.companyIds?.includes(companyId.trim()))
    : []
  const pool = companyFiltered.length > 0 ? companyFiltered : candidates
  return pool.sort((a, b) => updatedAtMillis(b) - updatedAtMillis(a))[0] ?? null
}

function updatedAtMillis(item: ResearchItem): number {
  const raw = item.updatedAt ?? item.createdAt
  if (raw && typeof raw === 'object') {
    const stamp = raw as { toMillis?: () => number }
    if (typeof stamp.toMillis === 'function') return stamp.toMillis()
    const seconds = (raw as { _seconds?: number })._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  if (typeof raw === 'string' && Number.isFinite(Date.parse(raw))) return Date.parse(raw)
  return 0
}

export type DesignContextUpsertInput = {
  orgId: string
  title?: string
  companyId?: string | null
  payload: unknown
  source: DesignContextGatherPath
  sourceUrl?: string
  user: ApiUser
}

/**
 * Upsert a Design Context record for an org (+ optional company). When a
 * design item already exists, bumps its version and appends history. When
 * none exists, creates a new kind='design' research item.
 */
export async function upsertDesignContext(input: DesignContextUpsertInput): Promise<{ id: string; created: boolean; version: number }> {
  const payload = normalizeDesignContextPayload(input.payload)
  if (!hasDesignContextFacts(payload)) throw new Error('designContext must contain at least one design fact')
  if (!isDesignGatherPath(input.source)) throw new Error('source must be questionnaire | style-scan | manual')

  const existing = await findDesignContextItem(input.orgId, input.companyId)
  if (existing) {
    const record = buildDesignContextRecord({
      payload,
      source: input.source,
      sourceUrl: input.sourceUrl,
      previous: existing.designContext ?? null,
      updatedBy: ownerUidFrom(input.user),
    })
    const updates: Record<string, unknown> = {
      designContext: record,
      ...(input.companyId?.trim()
        ? { linked: { ...(existing.linked ?? {}), companyId: input.companyId.trim() } }
        : {}),
      status: 'verified',
      ...lastActorFrom(input.user),
    }
    await adminDb.collection(RESEARCH_COLLECTION).doc(existing.id).update(updates)
    return { id: existing.id, created: false, version: record.version }
  }

  const created = await createResearchItem({
    orgId: input.orgId,
    title: input.title?.trim() || `Design Context — ${input.companyId?.trim() || input.orgId}`,
    kind: 'design',
    status: 'verified',
    visibility: 'internal',
    summary: 'Structured per-client design context (audience, positioning, brand voice, palette, type, components, scales, surface modes).',
    tags: ['design-context'],
    linked: {
      ...(input.companyId?.trim() ? { companyId: input.companyId.trim() } : {}),
    },
    designContext: {
      ...payload,
      version: 1,
      source: input.source,
      ...(input.sourceUrl?.trim() ? { sourceUrl: input.sourceUrl.trim() } : {}),
      history: [],
      updatedBy: ownerUidFrom(input.user),
    },
    user: input.user,
  })
  return { id: created.id, created: true, version: 1 }
}
