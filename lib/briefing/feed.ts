import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { BriefingCard, BriefingPriority, BriefingResponse, BriefingSourceAdapter, BriefingSourceItem, BriefingSourceType } from './types'
import { activityAdapter, agentOutputAdapter, approvalAdapter, clientDocumentAdapter, commentAdapter, notificationAdapter, projectAdapter, reportAdapter, taskAdapter } from './index'
import { comparePriority, formatTimeAgo, normalizeTimestamp, priorityRequiresAction } from './utils'

const PLATFORM_ORG_ID = 'pib-platform-owner'
const DEFAULT_LIMIT = 40
const SOURCE_FETCH_LIMIT = 120

export interface BriefingFeedOptions {
  orgId?: string | null
  priority?: BriefingPriority | 'all' | null
  sourceType?: BriefingSourceType | 'all' | null
  limit?: number
}

export interface BriefingSnapshotInput extends BriefingFeedOptions {
  title?: string | null
}

type FirestoreRef = {
  path?: string
  id?: string
  parent?: FirestoreRef | null
}

type FirestoreDoc = { id: string; data: () => Record<string, unknown>; ref?: FirestoreRef }

type OrgSummary = { id: string; name?: string | null; slug?: string | null }

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function limitValue(limit?: number): number {
  if (!Number.isFinite(limit ?? NaN)) return DEFAULT_LIMIT
  return Math.min(Math.max(Number(limit), 1), 100)
}

function userScopedOrgIds(user: ApiUser, requestedOrgId?: string | null): string[] | null {
  if (requestedOrgId) {
    if (user.role === 'admin' && !canAccessOrg(user, requestedOrgId)) {
      throw Object.assign(new Error('Forbidden'), { status: 403 })
    }
    return [requestedOrgId]
  }

  if (user.role === 'admin' && Array.isArray(user.allowedOrgIds) && user.allowedOrgIds.length > 0) {
    const ids = new Set(user.allowedOrgIds)
    if (user.orgId) ids.add(user.orgId)
    return [...ids]
  }

  if (user.role === 'client') {
    const ids = new Set(user.orgIds ?? [])
    if (user.orgId) ids.add(user.orgId)
    return [...ids]
  }

  return null
}

async function loadOrgSummaries(orgIds: string[] | null): Promise<Map<string, OrgSummary>> {
  const map = new Map<string, OrgSummary>()
  try {
    const collection = adminDb.collection('organizations')
    const snaps = orgIds && orgIds.length > 0
      ? await Promise.all(chunk(orgIds, 30).map((ids) => collection.where('__name__', 'in', ids).get()))
      : [await collection.limit(250).get()]
    for (const snap of snaps) {
      for (const doc of snap.docs as FirestoreDoc[]) {
        const data = doc.data()
        map.set(doc.id, {
          id: doc.id,
          name: typeof data.name === 'string' ? data.name : null,
          slug: typeof data.slug === 'string' ? data.slug : null,
        })
      }
    }
  } catch {
    // Org labels are display sugar; do not fail the feed for this.
  }
  return map
}

function normalizeDoc(doc: FirestoreDoc, extra: Record<string, unknown> = {}): Record<string, unknown> & { id: string } {
  return { id: doc.id, ...doc.data(), ...extra }
}

function deriveCommentContext(doc: FirestoreDoc): Record<string, unknown> {
  const path = doc.ref?.path ?? ''
  const parts = path.split('/').filter(Boolean)
  const context: Record<string, unknown> = {}
  const beforeComments = parts.lastIndexOf('comments')
  if (beforeComments > 0) {
    const parentId = parts[beforeComments - 1]
    const parentCollection = parts[beforeComments - 2]
    if (parentCollection === 'tasks') {
      context.taskId = parentId
      const projectsIndex = parts.lastIndexOf('projects', beforeComments)
      if (projectsIndex >= 0 && parts[projectsIndex + 1]) context.projectId = parts[projectsIndex + 1]
    }
    if (parentCollection === 'client_documents') context.documentId = parentId
    if (parentCollection === 'documents') context.documentId = parentId
    if (parentCollection === 'conversations') context.conversationId = parentId
  }
  return context
}

async function fetchCollectionDocs(collection: string, scopedOrgIds: string[] | null, limit = SOURCE_FETCH_LIMIT): Promise<FirestoreDoc[]> {
  const ref = adminDb.collection(collection)
  if (scopedOrgIds && scopedOrgIds.length > 0) {
    const snaps = await Promise.all(chunk(scopedOrgIds, 30).map((ids) => ref.where('orgId', 'in', ids).limit(limit).get()))
    return snaps.flatMap((snap) => snap.docs as FirestoreDoc[])
  }
  const snap = await ref.limit(limit).get()
  return snap.docs as FirestoreDoc[]
}

async function fetchTaskDocs(scopedOrgIds: string[] | null): Promise<FirestoreDoc[]> {
  const out: FirestoreDoc[] = []
  try {
    const ref = adminDb.collectionGroup('tasks')
    if (scopedOrgIds && scopedOrgIds.length > 0) {
      const snaps = await Promise.all(chunk(scopedOrgIds, 30).map((ids) => ref.where('orgId', 'in', ids).limit(SOURCE_FETCH_LIMIT).get()))
      out.push(...snaps.flatMap((snap) => snap.docs as FirestoreDoc[]))
    } else {
      const snap = await ref.limit(SOURCE_FETCH_LIMIT).get()
      out.push(...(snap.docs as FirestoreDoc[]))
    }
  } catch {
    // Some test/admin contexts only mock top-level collections; fall back below.
  }

  try {
    out.push(...await fetchCollectionDocs('tasks', scopedOrgIds, SOURCE_FETCH_LIMIT))
  } catch {
    // Top-level standalone tasks may not exist in older workspaces.
  }

  const seen = new Set<string>()
  return out.filter((doc) => {
    const key = doc.ref?.path ?? doc.id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function fetchCommentDocs(scopedOrgIds: string[] | null): Promise<FirestoreDoc[]> {
  const out: FirestoreDoc[] = []
  try {
    const ref = adminDb.collectionGroup('comments')
    if (scopedOrgIds && scopedOrgIds.length > 0) {
      const snaps = await Promise.all(chunk(scopedOrgIds, 30).map((ids) => ref.where('orgId', 'in', ids).limit(SOURCE_FETCH_LIMIT).get()))
      out.push(...snaps.flatMap((snap) => snap.docs as FirestoreDoc[]))
    } else {
      const snap = await ref.limit(SOURCE_FETCH_LIMIT).get()
      out.push(...(snap.docs as FirestoreDoc[]))
    }
  } catch {
    // Collection group comments are best-effort; top-level comments are fetched below.
  }

  try {
    out.push(...await fetchCollectionDocs('comments', scopedOrgIds, SOURCE_FETCH_LIMIT))
  } catch {
    // Some workspaces have no top-level comments collection.
  }

  const seen = new Set<string>()
  return out.filter((doc) => {
    const key = doc.ref?.path ?? doc.id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function decorate(item: BriefingSourceItem, orgs: Map<string, OrgSummary>): BriefingCard {
  const occurred = normalizeTimestamp(item.occurredAt) ?? new Date()
  const org = orgs.get(item.orgId)
  const context = {
    ...item.context,
    orgId: item.context.orgId || item.orgId,
    orgName: item.context.orgName ?? org?.name ?? (item.orgId === PLATFORM_ORG_ID ? 'Partners in Biz' : null),
    orgSlug: item.context.orgSlug ?? org?.slug ?? null,
  }
  const score = (priorityRequiresAction(item.priority) ? 100 : 0) + Math.max(0, 30 - Math.floor((Date.now() - occurred.getTime()) / 86_400_000))
  return {
    ...item,
    id: item.id ?? `${item.source.type}:${item.source.id}:${item.sourceHash}`,
    context,
    occurredAt: occurred,
    createdAt: item.createdAt ?? occurred,
    updatedAt: item.updatedAt ?? occurred,
    timeAgo: formatTimeAgo(occurred),
    unread: item.status !== 'acknowledged' && item.status !== 'resolved',
    requiresAction: priorityRequiresAction(item.priority),
    relevanceScore: score,
  }
}

function toItemSafe(adapter: Pick<BriefingSourceAdapter<Record<string, unknown>>, 'shouldGenerate' | 'toItem'>, doc: Record<string, unknown>, id: string): BriefingSourceItem | null {
  try {
    if (!adapter.shouldGenerate(doc, id)) return null
    return adapter.toItem(doc, id)
  } catch {
    return null
  }
}

export async function buildBriefingFeed(user: ApiUser, options: BriefingFeedOptions = {}): Promise<BriefingResponse & { generatedAt: string; scope: { orgId: string | null } }> {
  const scopedOrgIds = userScopedOrgIds(user, options.orgId)
  const orgs = await loadOrgSummaries(scopedOrgIds)
  const requestedLimit = limitValue(options.limit)
  const items: BriefingCard[] = []

  const include = (source: BriefingSourceType) => !options.sourceType || options.sourceType === 'all' || options.sourceType === source

  if (include('task') || include('agent-output')) {
    const docs = await fetchTaskDocs(scopedOrgIds)
    for (const doc of docs) {
      const data = normalizeDoc(doc)
      const projectId = typeof data.projectId === 'string' ? data.projectId : doc.ref?.parent?.parent?.id
      const enriched: Record<string, unknown> & { id: string } = { ...data, projectId, taskId: data.taskId ?? doc.id }
      if (include('task')) {
        const item = toItemSafe(taskAdapter, enriched, doc.id)
        if (item) items.push(decorate(item, orgs))
      }
      if (include('agent-output') && enriched.agentOutput && typeof enriched.agentOutput === 'object') {
        const output = { ...(enriched.agentOutput as Record<string, unknown>), ...enriched, summary: (enriched.agentOutput as Record<string, unknown>).summary }
        const item = toItemSafe(agentOutputAdapter, output, `${doc.id}:agent-output`)
        if (item) items.push(decorate(item, orgs))
      }
    }
  }

  if (include('comment')) {
    const docs = await fetchCommentDocs(scopedOrgIds)
    for (const doc of docs) {
      const item = toItemSafe(commentAdapter, normalizeDoc(doc, deriveCommentContext(doc)), doc.id)
      if (item) items.push(decorate(item, orgs))
    }
  }

  if (include('project')) {
    try {
      const docs = await fetchCollectionDocs('projects', scopedOrgIds)
      for (const doc of docs) {
        const item = toItemSafe(projectAdapter, normalizeDoc(doc), doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch {}
  }

  if (include('client-document') || include('approval')) {
    try {
      const docs = await fetchCollectionDocs('client_documents', scopedOrgIds)
      for (const doc of docs) {
        const data = normalizeDoc(doc)
        if (include('client-document')) {
          const item = toItemSafe(clientDocumentAdapter, data, doc.id)
          if (item) items.push(decorate(item, orgs))
        }
        if (include('approval')) {
          const item = toItemSafe(clientDocumentAdapter, data, `${doc.id}:approval`)
          if (item) items.push(decorate({ ...item, source: { ...item.source, type: 'approval' } }, orgs))
        }
      }
    } catch {}
  }

  if (include('approval')) {
    try {
      const docs = await fetchCollectionDocs('approvals', scopedOrgIds)
      for (const doc of docs) {
        const item = toItemSafe(approvalAdapter, normalizeDoc(doc), doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch {}
  }

  if (include('notification')) {
    try {
      const docs = await fetchCollectionDocs('notifications', scopedOrgIds)
      for (const doc of docs) {
        const item = toItemSafe(notificationAdapter, normalizeDoc(doc), doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch {}
  }

  if (include('activity')) {
    try {
      const docs = await fetchCollectionDocs('activities', scopedOrgIds)
      for (const doc of docs) {
        const item = toItemSafe(activityAdapter, normalizeDoc(doc), doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch {}
  }

  if (include('report')) {
    try {
      const docs = await fetchCollectionDocs('reports', scopedOrgIds)
      for (const doc of docs) {
        const item = toItemSafe(reportAdapter, normalizeDoc(doc), doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch {}
  }

  const filtered = items
    .filter((item) => !options.priority || options.priority === 'all' || item.priority === options.priority)
    .sort((a, b) => {
      const priority = comparePriority(a.priority, b.priority)
      if (priority !== 0) return priority
      const aTime = normalizeTimestamp(a.occurredAt)?.getTime() ?? 0
      const bTime = normalizeTimestamp(b.occurredAt)?.getTime() ?? 0
      return bTime - aTime
    })

  return {
    items: filtered.slice(0, requestedLimit),
    total: filtered.length,
    pageSize: requestedLimit,
    hasMore: filtered.length > requestedLimit,
    generatedAt: new Date().toISOString(),
    scope: { orgId: options.orgId ?? null },
  }
}

export async function createBriefingSnapshot(user: ApiUser, input: BriefingSnapshotInput = {}) {
  const feed = await buildBriefingFeed(user, { ...input, limit: input.limit ?? 80 })
  const title = input.title?.trim() || `Admin briefing snapshot — ${new Date().toLocaleDateString('en-ZA')}`
  const scopedOrgIds = userScopedOrgIds(user, input.orgId)
  const orgId = input.orgId || user.orgId || scopedOrgIds?.[0] || PLATFORM_ORG_ID
  if (user.role === 'admin' && !canAccessOrg(user, orgId)) {
    throw Object.assign(new Error('Forbidden'), { status: 403 })
  }
  const priorityCounts = feed.items.reduce<Record<string, number>>((acc, item) => {
    acc[item.priority] = (acc[item.priority] ?? 0) + 1
    return acc
  }, {})
  const doc = {
    orgId,
    title,
    briefingIds: feed.items.map((item) => item.id).filter(Boolean),
    itemCount: feed.items.length,
    priorityCounts,
    generatedAt: FieldValue.serverTimestamp(),
    generatedBy: user.uid,
    status: 'draft',
    summary: feed.items.slice(0, 8).map((item) => ({ id: item.id, priority: item.priority, title: item.title, source: item.source, occurredAt: item.occurredAt })),
    filters: { priority: input.priority ?? 'all', sourceType: input.sourceType ?? 'all' },
  }
  const ref = await adminDb.collection('briefing_snapshots').add(doc)
  return { id: ref.id, ...doc, generatedAt: new Date().toISOString() }
}
