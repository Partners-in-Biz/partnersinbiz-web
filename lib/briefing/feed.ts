import { FieldValue } from 'firebase-admin/firestore'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import {
  crmRecordAssignedToUid,
  crmRecordCompanyIds,
  crmRecordContactIds,
  type AssignableCrmRecord,
  type CrmAssignmentMaps,
} from '@/lib/crm/assignment-access'
import { withBriefingCardContract } from './cardContract'
import { applyCrmDisplayRecords, crmIdsFromItem, type CrmDisplayRecord } from './cardFacts'
import type { BriefingCard, BriefingCardAction, BriefingCardStateStatus, BriefingPriority, BriefingResponse, BriefingSourceAdapter, BriefingSourceItem, BriefingSourceType } from './types'
import { recordLinkedToUser, recordLinkedViaCrm, recordOperatorAddressed } from './personal-scope'
import { activityAdapter, adCampaignAdapter, agentLearningReviewAdapter, agentOutputAdapter, agentRunAdapter, approvalAdapter, bookingAdapter, broadcastAdapter, businessInsightReviewAdapter, calendarEventAdapter, campaignAdapter, clientDocumentAdapter, commentAdapter, contactAdapter, dealAdapter, enquiryAdapter, expenseAdapter, formSubmissionAdapter, inventoryItemAdapter, invoiceAdapter, mailboxMessageAdapter, notificationAdapter, orderAdapter, projectAdapter, quoteAdapter, reportAdapter, seoContentAdapter, seoTaskAdapter, shipmentAdapter, socialInboxAdapter, socialPostAdapter, supportTicketAdapter, taskAdapter, workspaceBrokerJobAdapter } from './index'
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
  orgId?: string | null
  status?: BriefingCardStateStatus | 'active' | string
  action?: BriefingCardAction | string | null
  note?: string | null
  snoozedUntil?: unknown
  approvalState?: string | null
  approvalCopy?: string | null
  sideEffectPerformed?: false
  updatedAt?: unknown
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function limitValue(limit?: number): number {
  if (!Number.isFinite(limit ?? NaN)) return DEFAULT_LIMIT
  return Math.min(Math.max(Number(limit), 1), 300)
}

function userScopedOrgIds(user: ApiUser, requestedOrgId?: string | null): string[] | null {
  if (requestedOrgId) {
    // All roles must have access to a request-supplied org scope. canAccessOrg
    // covers admins (allowedOrgIds), clients (orgId/activeOrgId/orgIds) and
    // always passes for platform-level 'ai' callers.
    if (!canAccessOrg(user, requestedOrgId)) {
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

/**
 * Briefings is a personal action queue. A viewer is an "operator" of an org
 * only when they are the platform admin/AI (internal staff) or hold the
 * owner/admin member role for that org. Operator viewers still see only their
 * own linked records plus operator-addressed action cards (approval gates,
 * blocked/awaiting tasks, documents in review, review-lane social) — never an
 * org-wide dump.
 */
async function loadBriefingOperatorOrgIds(user: ApiUser, scopedOrgIds: string[] | null): Promise<Set<string> | null> {
  // Platform admin/AI users are internal operators across every scoped org.
  if (user.role === 'admin' || user.role === 'ai') return null

  // Portal members: operator only where they hold owner/admin in orgMembers.
  const operatorOrgs = new Set<string>()
  if (!scopedOrgIds || scopedOrgIds.length === 0) return operatorOrgs
  try {
    const snaps = await Promise.all(chunk(scopedOrgIds, 30).map((ids) =>
      adminDb.collection('orgMembers')
        .where('__name__', 'in', ids.map((orgId) => `${orgId}_${user.uid}`))
        .limit(300)
        .get(),
    ))
    for (const snap of snaps) {
      for (const doc of snap.docs as FirestoreDoc[]) {
        const data = doc.data()
        const role = typeof data.role === 'string' ? data.role : ''
        const orgId = doc.id.replace(new RegExp(`_${escapeRegExp(user.uid)}$`), '')
        if ((role === 'owner' || role === 'admin') && orgId) operatorOrgs.add(orgId)
      }
    }
  } catch { ignoreOptionalFeedSource() }
  return operatorOrgs
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
  } catch { ignoreOptionalFeedSource() }
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
  } catch { ignoreOptionalFeedSource() }
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
  } catch { ignoreOptionalFeedSource() }

  try {
    const ref = adminDb.collection('tasks')
    const snaps = await Promise.all(chunk(ids, 30).map((batch) => ref.where('__name__', 'in', batch).get()))
    for (const snap of snaps) absorb(snap.docs as FirestoreDoc[])
  } catch { ignoreOptionalFeedSource() }

  const directRefs = refs.filter((ref) => ref.projectId && !map.has(ref.id))
  if (directRefs.length > 0) {
    try {
      const docs: FirestoreDoc[] = []
      await Promise.all(directRefs.map(async (ref) => {
        const snap = await adminDb.collection('projects').doc(ref.projectId as string).collection('tasks').doc(ref.id).get()
        if (snap.exists) docs.push(snap as FirestoreDoc)
      }))
      absorb(docs)
    } catch { ignoreOptionalFeedSource() }
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
  } catch { ignoreOptionalFeedSource() }

  const missingAuthIds = ids.filter((id) => !map.has(id))
  if (missingAuthIds.length > 0) {
    try {
      const result = await adminAuth.getUsers(missingAuthIds.slice(0, 100).map((uid) => ({ uid })))
      for (const user of result.users) {
        map.set(user.uid, { id: user.uid, name: user.displayName ?? null, email: user.email ?? null })
      }
    } catch { ignoreOptionalFeedSource() }
  }
  return map
}

async function loadBriefingUserStates(userId: string, scopedOrgIds: string[] | null): Promise<Map<string, BriefingUserState>> {
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
      const orgId = typeof data.orgId === 'string' ? data.orgId : null
      if (!itemId) continue
      if (scopedOrgIds && orgId && !scopedOrgIds.includes(orgId)) continue
      map.set(itemId, {
        itemId,
        orgId,
        status: typeof data.status === 'string' ? data.status : 'active',
        action: typeof data.action === 'string' ? data.action : null,
        note: typeof data.note === 'string' ? data.note : null,
        snoozedUntil: data.snoozedUntil,
        approvalState: typeof data.approvalState === 'string' ? data.approvalState : null,
        approvalCopy: typeof data.approvalCopy === 'string' ? data.approvalCopy : null,
        sideEffectPerformed: data.sideEffectPerformed === false ? false : undefined,
        updatedAt: data.updatedAt,
      })
    }
  } catch { ignoreOptionalFeedSource() }
  return map
}

function applyUserState(items: BriefingCard[], states: Map<string, BriefingUserState>): BriefingCard[] {
  const now = Date.now()
  return items.flatMap((item) => {
    const state = states.get(item.id ?? '')
    if (!state) return [item]

    const snoozedUntil = normalizeTimestamp(state.snoozedUntil)
    const status = state.status === 'handled' || state.status === 'snoozed' ? state.status : state.status as BriefingCardStateStatus | 'active'
    if (status === 'handled') return []
    if (status === 'snoozed' && snoozedUntil && snoozedUntil.getTime() > now) return []

    return [{
      ...item,
      unread: status === 'read' ? false : item.unread,
      userState: {
        status,
        action: typeof state.action === 'string' ? state.action as BriefingCardAction : null,
        note: state.note ?? null,
        snoozedUntil: snoozedUntil ? snoozedUntil.toISOString() : null,
        approvalState: state.approvalState ?? null,
        approvalCopy: state.approvalCopy ?? null,
        sideEffectPerformed: state.sideEffectPerformed,
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
      } catch { ignoreOptionalFeedSource() }
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

async function fetchQuoteDocs(scopedOrgIds: string[] | null): Promise<FirestoreDoc[]> {
  const ref = adminDb.collection('quotes')
  const out: FirestoreDoc[] = []

  if (scopedOrgIds && scopedOrgIds.length > 0) {
    const fields = ['orgId', 'sourceOrgId', 'recipientOrgId', 'targetOrgId']
    for (const field of fields) {
      try {
        const snaps = await Promise.all(chunk(scopedOrgIds, 30).map((ids) => ref.where(field, 'in', ids).limit(SOURCE_FETCH_LIMIT).get()))
        out.push(...snaps.flatMap((snap) => snap.docs as FirestoreDoc[]))
      } catch { ignoreOptionalFeedSource() }
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

async function fetchEnquiryDocs(scopedOrgIds: string[] | null): Promise<FirestoreDoc[]> {
  if (scopedOrgIds && scopedOrgIds.length > 0 && !scopedOrgIds.includes(PLATFORM_ORG_ID)) return []
  const snap = await adminDb.collection('enquiries').limit(SOURCE_FETCH_LIMIT).get()
  return snap.docs as FirestoreDoc[]
}

async function fetchBookingDocs(scopedOrgIds: string[] | null): Promise<FirestoreDoc[]> {
  if (scopedOrgIds && scopedOrgIds.length > 0 && !scopedOrgIds.includes(PLATFORM_ORG_ID)) return []
  const snap = await adminDb.collection('bookings').limit(SOURCE_FETCH_LIMIT).get()
  return snap.docs as FirestoreDoc[]
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

function calendarVisibleToUser(data: Record<string, unknown>, user: ApiUser): boolean {
  if (user.role === 'admin') return true

  const assignedTo = data.assignedTo
  if (assignedTo && typeof assignedTo === 'object') {
    const assignee = assignedTo as Record<string, unknown>
    if (assignee.type === 'user' && assignee.id === user.uid) return true
    if (user.role === 'ai' && assignee.type === 'agent' && (assignee.id === user.agentId || assignee.id === user.uid.replace(/^agent:/, ''))) return true
  }

  const attendees = Array.isArray(data.attendees) ? data.attendees : []
  return attendees.some((attendee) => {
    if (!attendee || typeof attendee !== 'object') return false
    return (attendee as Record<string, unknown>).userId === user.uid
  })
}

/** Human Briefings is a personal action queue — not an org-wide CRM dump. */
function briefingUsesPersonalCrmScope(user: ApiUser): boolean {
  return user.role === 'admin' || user.role === 'client'
}

/**
 * Universal per-user gate for a briefing source record. A card is visible
 * when the viewer is linked to the record (created/assigned/owned/shared/
 * recipient, or a linked CRM company/contact they own), OR the record is an
 * operator-addressed action card (approval gate, blocked task, doc in review,
 * review-lane social) and the viewer is an operator of that org. This is the
 * single rule for every source — no role sees an org-wide dump.
 */
function briefingRecordVisibleToUser(
  sourceType: BriefingSourceType,
  data: Record<string, unknown>,
  user: ApiUser,
  operatorOrgs: Set<string> | null,
  maps?: CrmAssignmentMaps,
): boolean {
  if (!user.uid) return false
  if (recordLinkedToUser(data, user.uid)) return true
  if (maps && recordLinkedViaCrm(data, user.uid, maps)) return true
  const orgId = typeof data.orgId === 'string' && data.orgId ? data.orgId : ''
  const isOperator = operatorOrgs === null || (orgId ? operatorOrgs.has(orgId) : false)
  if (isOperator && recordOperatorAddressed(sourceType, data)) return true
  return false
}

/** Load company/contact assignment maps for records that reference CRM ids. */
async function loadBriefingMapsForDocs(docs: FirestoreDoc[]): Promise<CrmAssignmentMaps> {
  const companyIds = new Set<string>()
  const contactIds = new Set<string>()
  for (const doc of docs) {
    const data = doc.data()
    for (const id of crmRecordCompanyIds(data as AssignableCrmRecord)) companyIds.add(id)
    for (const id of crmRecordContactIds(data as AssignableCrmRecord)) contactIds.add(id)
  }
  if (companyIds.size === 0 && contactIds.size === 0) return {}
  const [companies, contacts] = await Promise.all([
    loadBriefingCrmRecordMap('companies', companyIds),
    loadBriefingCrmRecordMap('contacts', contactIds),
  ])
  return { companies, contacts }
}

/**
 * CRM relationship cards only surface when the viewer is linked as owner,
 * assignee, creator, member, or via an owned company/contact. Privileged
 * CRM `all` scope must not bypass this — Briefings is per-user work.
 */
function briefingCrmLinkedToUser(
  record: AssignableCrmRecord,
  uid: string,
  maps: CrmAssignmentMaps = {},
): boolean {
  if (!uid) return false
  if (crmRecordAssignedToUid(record, uid)) return true

  for (const companyId of crmRecordCompanyIds(record)) {
    if (crmRecordAssignedToUid(maps.companies?.get(companyId), uid)) return true
  }

  for (const contactId of crmRecordContactIds(record)) {
    const contact = maps.contacts?.get(contactId)
    if (!contact) continue
    if (crmRecordAssignedToUid(contact, uid)) return true
    for (const companyId of crmRecordCompanyIds(contact)) {
      if (crmRecordAssignedToUid(maps.companies?.get(companyId), uid)) return true
    }
  }

  return false
}

async function loadBriefingCrmRecordMap(
  collectionName: 'companies' | 'contacts' | 'deals',
  ids: Iterable<string>,
): Promise<Map<string, AssignableCrmRecord>> {
  const uniqueIds = [...new Set([...ids].filter(Boolean))]
  const map = new Map<string, AssignableCrmRecord>()
  if (uniqueIds.length === 0) return map

  try {
    await Promise.all(chunk(uniqueIds, 30).map(async (batch) => {
      await Promise.all(batch.map(async (id) => {
        const snap = await adminDb.collection(collectionName).doc(id).get()
        if (!snap.exists) return
        const data = snap.data() as AssignableCrmRecord
        if (data.deleted === true) return
        map.set(snap.id, { ...data, id: snap.id })
      }))
    }))
  } catch { ignoreOptionalFeedSource() }

  return map
}

function asCrmDisplayRecord(record: AssignableCrmRecord | undefined): CrmDisplayRecord | null {
  if (!record?.id) return null
  const data = record as AssignableCrmRecord & Record<string, unknown>
  const numberValue = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null
  const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null
  return {
    id: record.id,
    name: text(data.name),
    title: text(data.title),
    email: text(data.email),
    phone: text(data.phone),
    company: text(data.company),
    companyId: text(data.companyId),
    companyName: text(data.companyName),
    contactId: text(data.contactId),
    value: numberValue(data.value),
    amount: numberValue(data.amount),
    currency: text(data.currency),
    stageLabel: text(data.stageLabel) ?? text(data.stageName) ?? text(data.stage),
    stageName: text(data.stageName),
    stage: text(data.stage),
    jobTitle: text(data.jobTitle),
  }
}

async function enrichCrmDisplayFacts(items: BriefingCard[]): Promise<BriefingCard[]> {
  const contactIds: string[] = []
  const dealIds: string[] = []
  const companyIds: string[] = []
  for (const item of items) {
    const ids = crmIdsFromItem(item)
    if (ids.contactId) contactIds.push(ids.contactId)
    if (ids.dealId) dealIds.push(ids.dealId)
    if (ids.companyId) companyIds.push(ids.companyId)
  }
  if (contactIds.length === 0 && dealIds.length === 0 && companyIds.length === 0) return items

  const [contacts, deals] = await Promise.all([
    loadBriefingCrmRecordMap('contacts', contactIds),
    loadBriefingCrmRecordMap('deals', dealIds),
  ])
  for (const contact of contacts.values()) {
    companyIds.push(...crmRecordCompanyIds(contact))
  }
  for (const deal of deals.values()) {
    companyIds.push(...crmRecordCompanyIds(deal))
    const contactId = typeof deal.contactId === 'string' ? deal.contactId : ''
    if (contactId && !contacts.has(contactId)) contactIds.push(contactId)
  }
  const extraContacts = [...new Set(contactIds)].filter((id) => !contacts.has(id))
  if (extraContacts.length > 0) {
    const loaded = await loadBriefingCrmRecordMap('contacts', extraContacts)
    for (const [id, record] of loaded) contacts.set(id, record)
  }
  const companies = await loadBriefingCrmRecordMap('companies', companyIds)

  return items.map((item) => {
    const ids = crmIdsFromItem(item)
    const deal = asCrmDisplayRecord(ids.dealId ? deals.get(ids.dealId) : undefined)
    const contactId = ids.contactId ?? deal?.contactId ?? null
    const contact = asCrmDisplayRecord(contactId ? contacts.get(contactId) : undefined)
    const companyId = ids.companyId ?? deal?.companyId ?? contact?.companyId ?? null
    const company = asCrmDisplayRecord(companyId ? companies.get(companyId) : undefined)
    if (!deal && !contact && !company) return item
    return withBriefingCardContract(applyCrmDisplayRecords(item, { contact, deal, company }))
  })
}

async function fetchCalendarEventDocs(scopedOrgIds: string[] | null, user: ApiUser): Promise<FirestoreDoc[]> {
  const docs = await fetchCollectionDocs('calendar_events', scopedOrgIds)
  const seen = new Set<string>()
  return docs.filter((doc) => {
    const data = doc.data()
    if (scopedOrgIds && scopedOrgIds.length > 0 && !scopedOrgIds.includes(String(data.orgId ?? ''))) return false
    if (!calendarVisibleToUser(data, user)) return false
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
  } catch { ignoreOptionalFeedSource() }

  try {
    out.push(...await fetchCollectionDocs('tasks', scopedOrgIds, SOURCE_FETCH_LIMIT))
  } catch { ignoreOptionalFeedSource() }

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
  } catch { ignoreOptionalFeedSource() }

  try {
    out.push(...await fetchCollectionDocs('comments', scopedOrgIds, SOURCE_FETCH_LIMIT))
  } catch { ignoreOptionalFeedSource() }

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
  return withBriefingCardContract({
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
  })
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

function ignoreOptionalFeedSource() {
  return undefined
}

export async function buildBriefingFeed(user: ApiUser, options: BriefingFeedOptions = {}): Promise<BriefingResponse & { generatedAt: string; scope: { orgId: string | null } }> {
  const scopedOrgIds = userScopedOrgIds(user, options.orgId)
  const operatorOrgs = await loadBriefingOperatorOrgIds(user, scopedOrgIds)
  const orgs = await loadOrgSummaries(scopedOrgIds)
  const requestedLimit = limitValue(options.limit)
  const items: BriefingCard[] = []

  const include = (source: BriefingSourceType) => !options.sourceType || options.sourceType === 'all' || options.sourceType === source

  // Linked parent ids for comment scoping: a comment is "his" when the viewer
  // authored it OR it sits on a task/project/document the viewer can see.
  const linkedTaskIds = new Set<string>()
  const linkedProjectIds = new Set<string>()
  const linkedDocumentIds = new Set<string>()

  if (include('task') || include('agent-output') || include('agent-learning-review') || include('business-insight-review')) {
    const docs = await fetchTaskDocs(scopedOrgIds)
    const taskMaps = await loadBriefingMapsForDocs(docs)
    for (const doc of docs) {
      const data = normalizeDoc(doc)
      if (!briefingRecordVisibleToUser('task', data, user, operatorOrgs, taskMaps)) continue
      const projectId = typeof data.projectId === 'string' ? data.projectId : doc.ref?.parent?.parent?.id
      const enriched: Record<string, unknown> & { id: string } = { ...data, projectId, taskId: data.taskId ?? doc.id }
      if (doc.id) linkedTaskIds.add(doc.id)
      if (typeof projectId === 'string' && projectId) linkedProjectIds.add(projectId)
      if (include('task')) {
        const item = toItemSafe(taskAdapter, enriched, doc.id)
        if (item) items.push(decorate(item, orgs))
      }
      if (include('agent-output') && enriched.agentOutput && typeof enriched.agentOutput === 'object') {
        const output = { ...(enriched.agentOutput as Record<string, unknown>), ...enriched, summary: (enriched.agentOutput as Record<string, unknown>).summary }
        const item = toItemSafe(agentOutputAdapter, output, `${doc.id}:agent-output`)
        if (item) items.push(decorate(item, orgs))
      }
      if (include('agent-learning-review')) {
        const item = toItemSafe(agentLearningReviewAdapter, enriched, doc.id)
        if (item) items.push(decorate(item, orgs))
      }
      if (include('business-insight-review')) {
        const item = toItemSafe(businessInsightReviewAdapter, enriched, doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    }
  }

  if (include('project')) {
    try {
      const docs = await fetchCollectionDocs('projects', scopedOrgIds)
      const projectMaps = await loadBriefingMapsForDocs(docs)
      for (const doc of docs) {
        const data = normalizeDoc(doc)
        if (!briefingRecordVisibleToUser('project', data, user, operatorOrgs, projectMaps)) continue
        if (doc.id) linkedProjectIds.add(doc.id)
        const item = toItemSafe(projectAdapter, data, doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch { ignoreOptionalFeedSource() }
  }

  if (include('client-document') || include('approval')) {
    try {
      const docs = await fetchCollectionDocs('client_documents', scopedOrgIds)
      const docMaps = await loadBriefingMapsForDocs(docs)
      for (const doc of docs) {
        const data = normalizeDoc(doc)
        if (!briefingRecordVisibleToUser('client-document', data, user, operatorOrgs, docMaps)) continue
        if (doc.id) linkedDocumentIds.add(doc.id)
        if (include('client-document')) {
          const item = toItemSafe(clientDocumentAdapter, data, doc.id)
          if (item) items.push(decorate(item, orgs))
        }
        if (include('approval')) {
          const item = toItemSafe(clientDocumentAdapter, data, `${doc.id}:approval`)
          if (item) items.push(decorate({ ...item, source: { ...item.source, type: 'approval' } }, orgs))
        }
      }
    } catch { ignoreOptionalFeedSource() }
  }

  if (include('comment')) {
    // Deliberately runs after task/project/client-document loops so the linked
    // parent id sets are populated before comment scoping is evaluated.
    const docs = await fetchCommentDocs(scopedOrgIds)
    for (const doc of docs) {
      const data = normalizeDoc(doc, deriveCommentContext(doc))
      const taskId = typeof data.taskId === 'string' ? data.taskId : ''
      const projectId = typeof data.projectId === 'string' ? data.projectId : ''
      const documentId = typeof data.documentId === 'string' ? data.documentId : ''
      const onLinkedParent = (taskId && linkedTaskIds.has(taskId)) ||
        (projectId && linkedProjectIds.has(projectId)) ||
        (documentId && linkedDocumentIds.has(documentId))
      if (!recordLinkedToUser(data, user.uid) && !onLinkedParent) continue
      const item = toItemSafe(commentAdapter, data, doc.id)
      if (item) items.push(decorate(item, orgs))
    }
  }

  if (include('approval')) {
    try {
      const docs = await fetchCollectionDocs('approvals', scopedOrgIds)
      const approvalMaps = await loadBriefingMapsForDocs(docs)
      for (const doc of docs) {
        const data = normalizeDoc(doc)
        if (!briefingRecordVisibleToUser('approval', data, user, operatorOrgs, approvalMaps)) continue
        const item = toItemSafe(approvalAdapter, data, doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch { ignoreOptionalFeedSource() }
  }

  if (include('social-post')) {
    try {
      const docs = await fetchCollectionDocs('social_posts', scopedOrgIds)
      const postMaps = await loadBriefingMapsForDocs(docs)
      for (const doc of docs) {
        const data = normalizeDoc(doc)
        if (!briefingRecordVisibleToUser('social-post', data, user, operatorOrgs, postMaps)) continue
        const item = toItemSafe(socialPostAdapter, data, doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch { ignoreOptionalFeedSource() }
  }

  if (include('social-inbox')) {
    try {
      const docs = await fetchCollectionDocs('social_inbox', scopedOrgIds)
      const inboxMaps = await loadBriefingMapsForDocs(docs)
      for (const doc of docs) {
        const data = normalizeDoc(doc)
        if (!briefingRecordVisibleToUser('social-inbox', data, user, operatorOrgs, inboxMaps)) continue
        const item = toItemSafe(socialInboxAdapter, data, doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch { ignoreOptionalFeedSource() }
  }

  if (include('mailbox-message')) {
    try {
      const docs = await fetchMailboxDocs(scopedOrgIds, user.uid)
      for (const doc of docs) {
        const item = toItemSafe(mailboxMessageAdapter, normalizeDoc(doc), doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch { ignoreOptionalFeedSource() }
  }

  if (include('agent-run') && (user.role === 'admin' || user.role === 'ai')) {
    try {
      const docs = await fetchAgentRunDocs(scopedOrgIds)
      for (const doc of docs) {
        const item = toItemSafe(agentRunAdapter, normalizeDoc(doc), doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch { ignoreOptionalFeedSource() }
  }

  if (include('workspace-broker-job') && (user.role === 'admin' || user.role === 'ai')) {
    try {
      const docs = await fetchWorkspaceBrokerJobDocs(scopedOrgIds)
      for (const doc of docs) {
        const item = toItemSafe(workspaceBrokerJobAdapter, normalizeDoc(doc), doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch { ignoreOptionalFeedSource() }
  }

  if (include('calendar-event')) {
    try {
      const docs = await fetchCalendarEventDocs(scopedOrgIds, user)
      for (const doc of docs) {
        const item = toItemSafe(calendarEventAdapter, normalizeDoc(doc), doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch { ignoreOptionalFeedSource() }
  }

  if (include('booking') && (user.role === 'admin' || user.role === 'ai')) {
    try {
      const docs = await fetchBookingDocs(scopedOrgIds)
      for (const doc of docs) {
        const item = toItemSafe(bookingAdapter, normalizeDoc(doc), doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch { ignoreOptionalFeedSource() }
  }

  if (include('contact')) {
    try {
      const docs = await fetchCollectionDocs('contacts', scopedOrgIds)
      const personalCrm = briefingUsesPersonalCrmScope(user)
      const companyIds = personalCrm
        ? docs.flatMap((doc) => crmRecordCompanyIds({ id: doc.id, ...doc.data() } as AssignableCrmRecord))
        : []
      const companies = personalCrm
        ? await loadBriefingCrmRecordMap('companies', companyIds)
        : new Map<string, AssignableCrmRecord>()
      for (const doc of docs) {
        const data = normalizeDoc(doc)
        if (personalCrm && !briefingCrmLinkedToUser(data as AssignableCrmRecord, user.uid, { companies })) continue
        const item = toItemSafe(contactAdapter, data, doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch { ignoreOptionalFeedSource() }
  }

  if (include('deal')) {
    try {
      const docs = await fetchCollectionDocs('deals', scopedOrgIds)
      const personalCrm = briefingUsesPersonalCrmScope(user)
      let maps: CrmAssignmentMaps = {}
      if (personalCrm) {
        const records = docs.map((doc) => ({ id: doc.id, ...doc.data() } as AssignableCrmRecord))
        const contactIds = records.flatMap((record) => crmRecordContactIds(record))
        const companyIds = [
          ...records.flatMap((record) => crmRecordCompanyIds(record)),
        ]
        const contacts = await loadBriefingCrmRecordMap('contacts', contactIds)
        for (const contact of contacts.values()) {
          companyIds.push(...crmRecordCompanyIds(contact))
        }
        maps = {
          contacts,
          companies: await loadBriefingCrmRecordMap('companies', companyIds),
        }
      }
      for (const doc of docs) {
        const data = normalizeDoc(doc)
        if (personalCrm && !briefingCrmLinkedToUser(data as AssignableCrmRecord, user.uid, maps)) continue
        const item = toItemSafe(dealAdapter, data, doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch { ignoreOptionalFeedSource() }
  }

  if (include('notification')) {
    try {
      const docs = await fetchCollectionDocs('notifications', scopedOrgIds)
      for (const doc of docs) {
        const data = normalizeDoc(doc)
        if (
          briefingUsesPersonalCrmScope(user) &&
          typeof data.userId === 'string' &&
          data.userId &&
          data.userId !== user.uid
        ) {
          continue
        }
        const item = toItemSafe(notificationAdapter, data, doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch { ignoreOptionalFeedSource() }
  }

  if (include('activity')) {
    try {
      const docs = await fetchCollectionDocs('activities', scopedOrgIds)
      const personalCrm = briefingUsesPersonalCrmScope(user)
      let maps: CrmAssignmentMaps = {}
      if (personalCrm) {
        const records = docs.map((doc) => ({ id: doc.id, ...doc.data() } as AssignableCrmRecord))
        const contactIds = records.flatMap((record) => crmRecordContactIds(record))
        const companyIds = records.flatMap((record) => crmRecordCompanyIds(record))
        const contacts = await loadBriefingCrmRecordMap('contacts', contactIds)
        for (const contact of contacts.values()) {
          companyIds.push(...crmRecordCompanyIds(contact))
        }
        maps = {
          contacts,
          companies: await loadBriefingCrmRecordMap('companies', companyIds),
        }
      }
      for (const doc of docs) {
        const data = normalizeDoc(doc)
        if (personalCrm) {
          const actorId = typeof data.actorId === 'string' ? data.actorId.replace(/^user:/, '') : ''
          const createdBy = typeof data.createdBy === 'string' ? data.createdBy.replace(/^user:/, '') : ''
          const createdByUid = typeof (data.createdByRef as { uid?: unknown } | undefined)?.uid === 'string'
            ? String((data.createdByRef as { uid: string }).uid)
            : ''
          const selfAuthored = actorId === user.uid || createdBy === user.uid || createdByUid === user.uid
          const crmLinked = briefingCrmLinkedToUser(data as AssignableCrmRecord, user.uid, maps)
          if (!crmLinked && !selfAuthored) continue
        }
        const item = toItemSafe(activityAdapter, data, doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch { ignoreOptionalFeedSource() }
  }

  if (include('report')) {
    try {
      const docs = await fetchCollectionDocs('reports', scopedOrgIds)
      const reportMaps = await loadBriefingMapsForDocs(docs)
      for (const doc of docs) {
        const data = normalizeDoc(doc)
        if (!briefingRecordVisibleToUser('report', data, user, operatorOrgs, reportMaps)) continue
        const item = toItemSafe(reportAdapter, data, doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch { ignoreOptionalFeedSource() }
  }

  if (include('support-ticket')) {
    try {
      const docs = await fetchCollectionDocs('support_tickets', scopedOrgIds)
      const ticketMaps = await loadBriefingMapsForDocs(docs)
      for (const doc of docs) {
        const data = normalizeDoc(doc)
        if (!briefingRecordVisibleToUser('support-ticket', data, user, operatorOrgs, ticketMaps)) continue
        const item = toItemSafe(supportTicketAdapter, data, doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch { ignoreOptionalFeedSource() }
  }

  if (include('invoice')) {
    try {
      const docs = await fetchInvoiceDocs(scopedOrgIds)
      const invoiceMaps = await loadBriefingMapsForDocs(docs)
      for (const doc of docs) {
        const data = normalizeDoc(doc)
        if (!briefingRecordVisibleToUser('invoice', data, user, operatorOrgs, invoiceMaps)) continue
        const item = toItemSafe(invoiceAdapter, data, doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch { ignoreOptionalFeedSource() }
  }

  if (include('quote')) {
    try {
      const docs = await fetchQuoteDocs(scopedOrgIds)
      const quoteMaps = await loadBriefingMapsForDocs(docs)
      for (const doc of docs) {
        const data = normalizeDoc(doc)
        if (!briefingRecordVisibleToUser('quote', data, user, operatorOrgs, quoteMaps)) continue
        const item = toItemSafe(quoteAdapter, data, doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch { ignoreOptionalFeedSource() }
  }

  if (include('order')) {
    try {
      const docs = await fetchCollectionDocs('orders', scopedOrgIds)
      const orderMaps = await loadBriefingMapsForDocs(docs)
      for (const doc of docs) {
        const data = normalizeDoc(doc)
        if (!briefingRecordVisibleToUser('order', data, user, operatorOrgs, orderMaps)) continue
        const item = toItemSafe(orderAdapter, data, doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch { ignoreOptionalFeedSource() }
  }

  if (include('inventory-item')) {
    try {
      const docs = await fetchCollectionDocs('inventoryItems', scopedOrgIds)
      const inventoryMaps = await loadBriefingMapsForDocs(docs)
      for (const doc of docs) {
        const data = normalizeDoc(doc)
        if (!briefingRecordVisibleToUser('inventory-item', data, user, operatorOrgs, inventoryMaps)) continue
        const item = toItemSafe(inventoryItemAdapter, data, doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch { ignoreOptionalFeedSource() }
  }

  if (include('shipment')) {
    try {
      const docs = await fetchCollectionDocs('shipments', scopedOrgIds)
      const shipmentMaps = await loadBriefingMapsForDocs(docs)
      for (const doc of docs) {
        const data = normalizeDoc(doc)
        if (!briefingRecordVisibleToUser('shipment', data, user, operatorOrgs, shipmentMaps)) continue
        const item = toItemSafe(shipmentAdapter, data, doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch { ignoreOptionalFeedSource() }
  }

  if (include('expense') && (user.role === 'admin' || user.role === 'ai')) {
    try {
      const docs = await fetchCollectionDocs('expenses', scopedOrgIds)
      for (const doc of docs) {
        const item = toItemSafe(expenseAdapter, normalizeDoc(doc), doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch { ignoreOptionalFeedSource() }
  }

  if (include('seo-content')) {
    try {
      const docs = await fetchCollectionDocs('seo_content', scopedOrgIds)
      const seoMaps = await loadBriefingMapsForDocs(docs)
      for (const doc of docs) {
        const data = normalizeDoc(doc)
        if (!briefingRecordVisibleToUser('seo-content', data, user, operatorOrgs, seoMaps)) continue
        const item = toItemSafe(seoContentAdapter, data, doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch { ignoreOptionalFeedSource() }
  }

  if (include('seo-task') && (user.role === 'admin' || user.role === 'ai')) {
    try {
      const docs = await fetchCollectionDocs('seo_tasks', scopedOrgIds)
      for (const doc of docs) {
        const item = toItemSafe(seoTaskAdapter, normalizeDoc(doc), doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch { ignoreOptionalFeedSource() }
  }

  if (include('ad-campaign')) {
    try {
      const docs = await fetchCollectionDocs('ad_campaigns', scopedOrgIds)
      const adMaps = await loadBriefingMapsForDocs(docs)
      for (const doc of docs) {
        const data = normalizeDoc(doc)
        if (!briefingRecordVisibleToUser('ad-campaign', data, user, operatorOrgs, adMaps)) continue
        const item = toItemSafe(adCampaignAdapter, data, doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch { ignoreOptionalFeedSource() }
  }

  if (include('broadcast')) {
    try {
      const docs = await fetchCollectionDocs('broadcasts', scopedOrgIds)
      const broadcastMaps = await loadBriefingMapsForDocs(docs)
      for (const doc of docs) {
        const data = normalizeDoc(doc)
        if (!briefingRecordVisibleToUser('broadcast', data, user, operatorOrgs, broadcastMaps)) continue
        const item = toItemSafe(broadcastAdapter, data, doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch { ignoreOptionalFeedSource() }
  }

  if (include('campaign')) {
    try {
      const docs = await fetchCollectionDocs('campaigns', scopedOrgIds)
      const campaignMaps = await loadBriefingMapsForDocs(docs)
      for (const doc of docs) {
        const data = normalizeDoc(doc)
        if (!briefingRecordVisibleToUser('campaign', data, user, operatorOrgs, campaignMaps)) continue
        const item = toItemSafe(campaignAdapter, data, doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch { ignoreOptionalFeedSource() }
  }

  if (include('enquiry') && (user.role === 'admin' || user.role === 'ai')) {
    try {
      const docs = await fetchEnquiryDocs(scopedOrgIds)
      for (const doc of docs) {
        const item = toItemSafe(enquiryAdapter, normalizeDoc(doc), doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch { ignoreOptionalFeedSource() }
  }

  if (include('form-submission') && (user.role === 'admin' || user.role === 'ai')) {
    try {
      const docs = await fetchCollectionDocs('form_submissions', scopedOrgIds)
      for (const doc of docs) {
        const item = toItemSafe(formSubmissionAdapter, normalizeDoc(doc), doc.id)
        if (item) items.push(decorate(item, orgs))
      }
    } catch { ignoreOptionalFeedSource() }
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
  const labelled = enrichBriefingLabels(items, projects, tasks, users)
  let withCrmFacts = labelled
  try {
    withCrmFacts = await enrichCrmDisplayFacts(labelled)
  } catch {
    ignoreOptionalFeedSource()
  }
  const labelledItems = applyUserState(
    withCrmFacts,
    await loadBriefingUserStates(user.uid, scopedOrgIds),
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
  if (!canAccessOrg(user, orgId)) {
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
