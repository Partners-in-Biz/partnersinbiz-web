import { FieldValue } from 'firebase-admin/firestore'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { BriefingCard, BriefingPriority, BriefingResponse, BriefingSourceAdapter, BriefingSourceItem, BriefingSourceType } from './types'
import { activityAdapter, adCampaignAdapter, agentOutputAdapter, agentRunAdapter, approvalAdapter, clientDocumentAdapter, commentAdapter, expenseAdapter, formSubmissionAdapter, invoiceAdapter, mailboxMessageAdapter, notificationAdapter, projectAdapter, reportAdapter, seoContentAdapter, seoTaskAdapter, socialInboxAdapter, socialPostAdapter, supportTicketAdapter, taskAdapter, workspaceBrokerJobAdapter } from './index'
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
type ProjectSummary = { id: string; name?: string | null; title?: string | null; slug?: string | null }
type TaskSummary = { id: string; title?: string | null; projectId?: string | null; orgId?: string | null }
type UserSummary = { id: string; name?: string | null; email?: string | null }
type TaskLookupRef = { id: string; projectId?: string | null }
type BriefingUserState = {
  itemId: string
  status?: 'active' | 'handled' | 'snoozed' | string
  note?: string | null
  snoozedUntil?: unknown
  updatedAt?: unknown
}

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

async function loadProjectSummaries(projectIds: string[]): Promise<Map<string, ProjectSummary>> {
  const map = new Map<string, ProjectSummary>()
  const ids = [...new Set(projectIds.filter(Boolean))]
  if (ids.length === 0) return map
  try {
    const collection = adminDb.collection('projects')
    const snaps = await Promise.all(chunk(ids, 30).map((batch) => collection.where('__name__', 'in', batch).get()))
    for (const snap of snaps) {
      for (const doc of snap.docs as FirestoreDoc[]) {
        const data = doc.data()
        map.set(doc.id, {
          id: doc.id,
          name: typeof data.name === 'string' ? data.name : null,
          title: typeof data.title === 'string' ? data.title : null,
          slug: typeof data.slug === 'string' ? data.slug : null,
        })
      }
    }
  } catch {
    // Related labels are best-effort.
  }
  return map
}

async function loadTaskSummaries(taskRefs: TaskLookupRef[]): Promise<Map<string, TaskSummary>> {
  const map = new Map<string, TaskSummary>()
  const refs = taskRefs.filter((ref) => ref.id)
  const ids = [...new Set(refs.map((ref) => ref.id))]
  if (ids.length === 0) return map

  const absorb = (docs: FirestoreDoc[]) => {
    for (const doc of docs) {
      const data = doc.data()
      const projectId = typeof data.projectId === 'string' ? data.projectId : doc.ref?.parent?.parent?.id ?? null
      const title = typeof data.title === 'string' ? data.title : null
      const orgId = typeof data.orgId === 'string' ? data.orgId : null
      map.set(doc.id, { id: doc.id, title, projectId, orgId })
    }
  }

  try {
    const ref = adminDb.collectionGroup('tasks')
    const snaps = await Promise.all(chunk(ids, 30).map((batch) => ref.where('__name__', 'in', batch).get()))
    for (const snap of snaps) absorb(snap.docs as FirestoreDoc[])
  } catch {
    // Some contexts do not support collection-group task lookup.
  }

  try {
    const ref = adminDb.collection('tasks')
    const snaps = await Promise.all(chunk(ids, 30).map((batch) => ref.where('__name__', 'in', batch).get()))
    for (const snap of snaps) absorb(snap.docs as FirestoreDoc[])
  } catch {
    // Standalone task labels are best-effort.
  }

  const directRefs = refs.filter((ref) => ref.projectId && !map.has(ref.id))
  if (directRefs.length > 0) {
    try {
      const docs: FirestoreDoc[] = []
      await Promise.all(directRefs.map(async (ref) => {
        const snap = await adminDb.collection('projects').doc(ref.projectId as string).collection('tasks').doc(ref.id).get()
        if (snap.exists) docs.push(snap as FirestoreDoc)
      }))
      absorb(docs)
    } catch {
      // Nested project task labels are best-effort.
    }
  }

  return map
}

async function loadUserSummaries(actorIds: string[]): Promise<Map<string, UserSummary>> {
  const map = new Map<string, UserSummary>()
  const ids = [...new Set(actorIds.map((id) => id.replace(/^user:/, '')).filter((id) => id && !id.startsWith('agent:') && id !== 'unknown'))]
  if (ids.length === 0) return map
  try {
    const ref = adminDb.collection('users')
    const snaps = await Promise.all(chunk(ids, 30).map((batch) => ref.where('__name__', 'in', batch).get()))
    for (const snap of snaps) {
      for (const doc of snap.docs as FirestoreDoc[]) {
        const data = doc.data()
        const displayName = typeof data.displayName === 'string' ? data.displayName : null
        const name = typeof data.name === 'string' ? data.name : displayName
        const email = typeof data.email === 'string' ? data.email : null
        map.set(doc.id, { id: doc.id, name, email })
      }
    }
  } catch {
    // Actor labels are display sugar.
  }

  const missingAuthIds = ids.filter((id) => !map.has(id))
  if (missingAuthIds.length > 0) {
    try {
      const result = await adminAuth.getUsers(missingAuthIds.slice(0, 100).map((uid) => ({ uid })))
      for (const user of result.users) {
        map.set(user.uid, { id: user.uid, name: user.displayName ?? null, email: user.email ?? null })
      }
    } catch {
      // Firebase Auth fallback is display sugar too.
    }
  }
  return map
}

async function loadBriefingUserStates(userId: string): Promise<Map<string, BriefingUserState>> {
  const map = new Map<string, BriefingUserState>()
  if (!userId) return map
  try {
    const snap = await adminDb
      .collection('briefing_user_states')
      .where('userId', '==', userId)
      .limit(500)
      .get()
    for (const doc of snap.docs as FirestoreDoc[]) {
      const data = doc.data()
      const itemId = typeof data.itemId === 'string' ? data.itemId : ''
      if (!itemId) continue
      map.set(itemId, {
        itemId,
        status: typeof data.status === 'string' ? data.status : 'active',
        note: typeof data.note === 'string' ? data.note : null,
        snoozedUntil: data.snoozedUntil,
        updatedAt: data.updatedAt,
      })
    }
  } catch {
    // Per-user handling state must not break the live briefing feed.
  }
  return map
}

function applyUserState(items: BriefingCard[], states: Map<string, BriefingUserState>): BriefingCard[] {
  const now = Date.now()
  return items.flatMap((item) => {
    const state = states.get(item.id ?? '')
    if (!state) return [item]

    const snoozedUntil = normalizeTimestamp(state.snoozedUntil)
    const status = state.status === 'handled' || state.status === 'snoozed' ? state.status : 'active'
    if (status === 'handled') return []
    if (status === 'snoozed' && snoozedUntil && snoozedUntil.getTime() > now) return []

    return [{
      ...item,
      userState: {
        status: 'active',
        note: state.note ?? null,
        snoozedUntil: snoozedUntil ? snoozedUntil.toISOString() : null,
        updatedAt: normalizeTimestamp(state.updatedAt)?.toISOString() ?? null,
      },
    }]
  })
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

async function fetchInvoiceDocs(scopedOrgIds: string[] | null): Promise<FirestoreDoc[]> {
  const ref = adminDb.collection('invoices')
  const out: FirestoreDoc[] = []

  if (scopedOrgIds && scopedOrgIds.length > 0) {
    const fields = ['orgId', 'sourceOrgId', 'recipientOrgId', 'targetOrgId']
    for (const field of fields) {
      try {
        const snaps = await Promise.all(chunk(scopedOrgIds, 30).map((ids) => ref.where(field, 'in', ids).limit(SOURCE_FETCH_LIMIT).get()))
        out.push(...snaps.flatMap((snap) => snap.docs as FirestoreDoc[]))
      } catch {
        // Billing records have evolved through several org fields; keep each lookup best-effort.
      }
    }
  } else {
    const snap = await ref.limit(SOURCE_FETCH_LIMIT).get()
    out.push(...(snap.docs as FirestoreDoc[]))
  }

  const seen = new Set<string>()
  return out.filter((doc) => {
    const key = doc.ref?.path ?? doc.id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function fetchMailboxDocs(scopedOrgIds: string[] | null, uid: string): Promise<FirestoreDoc[]> {
  const ref = adminDb.collection('mailbox_messages')
  const out: FirestoreDoc[] = []

  if (scopedOrgIds && scopedOrgIds.length > 0) {
    const snaps = await Promise.all(chunk(scopedOrgIds, 30).map((ids) => ref.where('orgId', 'in', ids).where('uid', '==', uid).limit(SOURCE_FETCH_LIMIT).get()))
    out.push(...snaps.flatMap((snap) => snap.docs as FirestoreDoc[]))
  } else {
    const snap = await ref.where('uid', '==', uid).limit(SOURCE_FETCH_LIMIT).get()
    out.push(...(snap.docs as FirestoreDoc[]))
  }

  const seen = new Set<string>()
  return out.filter((doc) => {
    const data = doc.data()
    if (data.uid !== uid) return false
    if (scopedOrgIds && scopedOrgIds.length > 0 && !scopedOrgIds.includes(String(data.orgId ?? ''))) return false
    const key = doc.ref?.path ?? doc.id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function fetchAgentRunDocs(scopedOrgIds: string[] | null): Promise<FirestoreDoc[]> {
  const docs = await fetchCollectionDocs('hermes_runs', scopedOrgIds)
  const seen = new Set<string>()
  return docs.filter((doc) => {
    const data = doc.data()
    if (scopedOrgIds && scopedOrgIds.length > 0 && !scopedOrgIds.includes(String(data.orgId ?? ''))) return false
    const key = doc.ref?.path ?? doc.id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function fetchWorkspaceBrokerJobDocs(scopedOrgIds: string[] | null): Promise<FirestoreDoc[]> {
  const docs = await fetchCollectionDocs('workspace_broker_jobs', scopedOrgIds)
  const seen = new Set<string>()
  return docs.filter((doc) => {
    const data = doc.data()
    if (scopedOrgIds && scopedOrgIds.length > 0 && !scopedOrgIds.includes(String(data.orgId ?? ''))) return false
    const key = doc.ref?.path ?? doc.id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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
  const source = item.source.type === 'ad-campaign' && context.orgSlug
    ? { ...item.source, url: `/admin/org/${encodeURIComponent(context.orgSlug)}/ads/campaigns/${encodeURIComponent(item.source.id)}` }
    : item.source
  const score = (priorityRequiresAction(item.priority) ? 100 : 0) + Math.max(0, 30 - Math.floor((Date.now() - occurred.getTime()) / 86_400_000))
  return {
    ...item,
    source,
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

function displayProjectName(project: ProjectSummary | undefined): string | null {
  return project?.name ?? project?.title ?? null
}

function displayActorName(actor: BriefingCard['actor'], users: Map<string, UserSummary>): string | null {
  const id = actor.id.replace(/^user:/, '')
  const user = users.get(id)
  return actor.name ?? user?.name ?? user?.email ?? null
}

function enrichBriefingLabels(items: BriefingCard[], projects: Map<string, ProjectSummary>, tasks: Map<string, TaskSummary>, users: Map<string, UserSummary>): BriefingCard[] {
  return items.map((item) => {
    const taskId = item.context.taskId ?? null
    const task = taskId ? tasks.get(taskId) : undefined
    const projectId = item.context.projectId ?? task?.projectId ?? null
    const project = projectId ? projects.get(projectId) : undefined
    const actorName = displayActorName(item.actor, users)
    const context = {
      ...item.context,
      projectId,
      projectName: item.context.projectName ?? displayProjectName(project),
      taskTitle: item.context.taskTitle ?? task?.title ?? null,
    }
    const actor = actorName ? { ...item.actor, name: actorName } : item.actor

    let title = item.title
    if (item.source.type === 'comment') {
      if (context.taskTitle) title = `Comment on ${context.taskTitle}`
      else if (context.projectName) title = `Comment on ${context.projectName}`
      else if (actorName && item.title.includes(item.actor.id)) title = item.title.replace(item.actor.id, actorName)
    }

    return { ...item, title, actor, context }
  })
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

  if (include('social-post')) {
    try {
      const docs = await fetchCollectionDocs('social_posts', scopedOrgIds)
      for (const doc of docs) {
        const item = toItemSafe(socialPostAdapter, normalizeDoc(doc), doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch {}
  }

  if (include('social-inbox')) {
    try {
      const docs = await fetchCollectionDocs('social_inbox', scopedOrgIds)
      for (const doc of docs) {
        const item = toItemSafe(socialInboxAdapter, normalizeDoc(doc), doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch {}
  }

  if (include('mailbox-message')) {
    try {
      const docs = await fetchMailboxDocs(scopedOrgIds, user.uid)
      for (const doc of docs) {
        const item = toItemSafe(mailboxMessageAdapter, normalizeDoc(doc), doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch {}
  }

  if (include('agent-run') && (user.role === 'admin' || user.role === 'ai')) {
    try {
      const docs = await fetchAgentRunDocs(scopedOrgIds)
      for (const doc of docs) {
        const item = toItemSafe(agentRunAdapter, normalizeDoc(doc), doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch {}
  }

  if (include('workspace-broker-job') && (user.role === 'admin' || user.role === 'ai')) {
    try {
      const docs = await fetchWorkspaceBrokerJobDocs(scopedOrgIds)
      for (const doc of docs) {
        const item = toItemSafe(workspaceBrokerJobAdapter, normalizeDoc(doc), doc.id)
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

  if (include('support-ticket')) {
    try {
      const docs = await fetchCollectionDocs('support_tickets', scopedOrgIds)
      for (const doc of docs) {
        const item = toItemSafe(supportTicketAdapter, normalizeDoc(doc), doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch {}
  }

  if (include('invoice')) {
    try {
      const docs = await fetchInvoiceDocs(scopedOrgIds)
      for (const doc of docs) {
        const item = toItemSafe(invoiceAdapter, normalizeDoc(doc), doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch {}
  }

  if (include('expense') && (user.role === 'admin' || user.role === 'ai')) {
    try {
      const docs = await fetchCollectionDocs('expenses', scopedOrgIds)
      for (const doc of docs) {
        const item = toItemSafe(expenseAdapter, normalizeDoc(doc), doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch {}
  }

  if (include('seo-content')) {
    try {
      const docs = await fetchCollectionDocs('seo_content', scopedOrgIds)
      for (const doc of docs) {
        const item = toItemSafe(seoContentAdapter, normalizeDoc(doc), doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch {}
  }

  if (include('seo-task') && (user.role === 'admin' || user.role === 'ai')) {
    try {
      const docs = await fetchCollectionDocs('seo_tasks', scopedOrgIds)
      for (const doc of docs) {
        const item = toItemSafe(seoTaskAdapter, normalizeDoc(doc), doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch {}
  }

  if (include('ad-campaign')) {
    try {
      const docs = await fetchCollectionDocs('ad_campaigns', scopedOrgIds)
      for (const doc of docs) {
        const item = toItemSafe(adCampaignAdapter, normalizeDoc(doc), doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch {}
  }

  if (include('form-submission') && (user.role === 'admin' || user.role === 'ai')) {
    try {
      const docs = await fetchCollectionDocs('form_submissions', scopedOrgIds)
      for (const doc of docs) {
        const item = toItemSafe(formSubmissionAdapter, normalizeDoc(doc), doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch {}
  }

  const projectIds = items.map((item) => item.context.projectId).filter((id): id is string => typeof id === 'string' && id.length > 0)
  const taskRefs: TaskLookupRef[] = items.reduce<TaskLookupRef[]>((acc, item) => {
    if (typeof item.context.taskId === 'string' && item.context.taskId.length > 0) {
      acc.push({ id: item.context.taskId, projectId: item.context.projectId })
    }
    return acc
  }, [])
  const actorIds = items.map((item) => item.actor.id).filter((id): id is string => typeof id === 'string' && id.length > 0)
  const tasks = await loadTaskSummaries(taskRefs)
  const projects = await loadProjectSummaries([...projectIds, ...[...tasks.values()].map((task) => task.projectId).filter((id): id is string => typeof id === 'string' && id.length > 0)])
  const users = await loadUserSummaries(actorIds)
  const labelledItems = applyUserState(
    enrichBriefingLabels(items, projects, tasks, users),
    await loadBriefingUserStates(user.uid),
  )

  const filtered = labelledItems
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
