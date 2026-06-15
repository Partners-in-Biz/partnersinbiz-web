/**
 * GET /api/v1/inbox — unified workspace inbox.
 *
 * Aggregates multiple Firestore sources into a single merge-sorted feed:
 *   - notifications (collection: notifications)
 *   - mentions (collection: comments, mentions array-contains currentId)
 *   - assignments (collection: tasks, assignedTo.id == currentId)
 *   - approvals (social_posts status=pending_approval + expenses status=submitted)
 *   - overdue invoices (collection: invoices, status=overdue)
 *
 * Each source is fetched in parallel with its own try/catch: one failing
 * source never breaks the inbox — it just contributes zero items.
 *
 * Pagination: keyset by `createdAt desc`. `nextCursor` is the ISO string of
 * the oldest item returned; callers pass it back as `?cursor=<ISO>` to fetch
 * the next page.
 *
 * NOTE: This is the workspace inbox. The social engagement inbox lives at
 * /api/v1/social/inbox and is a separate feature.
 */
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { resolveOrgScope } from '@/lib/api/orgScope'
import type { InboxItem } from '@/lib/inbox/types'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

type ForScope = 'me' | 'agent' | 'all'

interface FetchContext {
  orgId: string
  scope: ForScope
  user: ApiUser
  currentId: string
  unreadOnly: boolean
  before: Date | null
}

/** Normalise a Firestore timestamp / ISO string / Date into an ISO string. */
function toIso(value: unknown): string {
  if (!value) return new Date(0).toISOString()
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (typeof value === 'string') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString()
  }
  if (value instanceof Date) return value.toISOString()
  // Firestore sometimes serialises as { _seconds, _nanoseconds }
  if (typeof value === 'object' && value !== null && '_seconds' in (value as Record<string, unknown>)) {
    const seconds = (value as { _seconds?: number })._seconds ?? 0
    return new Date(seconds * 1000).toISOString()
  }
  return new Date(0).toISOString()
}

/** Returns `true` iff the item is newer than the cursor (or no cursor set). */
function withinCursor(iso: string, before: Date | null): boolean {
  if (!before) return true
  return new Date(iso).getTime() < before.getTime()
}

// --- Source fetchers -------------------------------------------------------

async function fetchNotifications(ctx: FetchContext, limit: number): Promise<InboxItem[]> {
  try {
    let query = adminDb
      .collection('notifications')
      .where('orgId', '==', ctx.orgId) as FirebaseFirestore.Query

    if (ctx.unreadOnly) {
      query = query.where('status', '==', 'unread')
    }

    if (ctx.scope === 'me') {
      if (ctx.user.role === 'ai') {
        query = query.where('agentId', '==', ctx.currentId)
      } else {
        query = query.where('userId', '==', ctx.currentId)
      }
    } else if (ctx.scope === 'agent') {
      query = query.where('agentId', '==', ctx.currentId)
    }
    // scope === 'all' — no recipient filter.

    query = query.orderBy('createdAt', 'desc').limit(limit)

    const snap = await query.get()
    const items: InboxItem[] = []
    for (const doc of snap.docs) {
      const data = doc.data()
      const createdAt = toIso(data.createdAt)
      if (!withinCursor(createdAt, ctx.before)) continue
      items.push({
        id: doc.id,
        itemType: 'notification',
        resourceType: 'notification',
        resourceId: doc.id,
        title: data.title ?? '',
        body: data.body ?? '',
        priority: (data.priority ?? 'normal') as InboxItem['priority'],
        link: data.link ?? null,
        createdAt,
        data: data.data ?? undefined,
      })
    }
    return items
  } catch (err) {
    console.error('[inbox-notifications-error]', err)
    return []
  }
}

async function fetchMentions(ctx: FetchContext, limit: number): Promise<InboxItem[]> {
  try {
    // A4 denormalises mentions into `mentionIds: string[]` of `${type}:${id}`
    // strings (see docs/firestore-indexes.needed.md — "comments" section).
    // Build the lookup key from scope: agent/ai uses the agent id, humans use uid.
    const mentionKey =
      ctx.scope === 'agent' || ctx.user.role === 'ai'
        ? `agent:${ctx.currentId}`
        : `user:${ctx.currentId}`

    let query = adminDb
      .collection('comments')
      .where('orgId', '==', ctx.orgId)
      .where('mentionIds', 'array-contains', mentionKey) as FirebaseFirestore.Query

    query = query.orderBy('createdAt', 'desc').limit(limit)
    const snap = await query.get()

    const items: InboxItem[] = []
    for (const doc of snap.docs) {
      const data = doc.data()
      const createdAt = toIso(data.createdAt)
      if (!withinCursor(createdAt, ctx.before)) continue
      const resourceType = data.resourceType ?? 'comment'
      const resourceId = data.resourceId ?? doc.id
      items.push({
        id: doc.id,
        itemType: 'mention',
        resourceType,
        resourceId,
        title: `You were mentioned in ${resourceType}`,
        body: (data.body ?? '').toString().slice(0, 280),
        priority: 'normal',
        link: data.link ?? null,
        createdAt,
        data: { commentId: doc.id, parentCommentId: data.parentCommentId ?? null },
      })
    }
    return items
  } catch (err) {
    // Comments collection may not exist yet — another agent is building it.
    console.warn('[inbox-mentions-skip]', (err as Error).message)
    return []
  }
}

async function fetchAssignments(ctx: FetchContext, limit: number): Promise<InboxItem[]> {
  try {
    const query = adminDb
      .collection('tasks')
      .where('orgId', '==', ctx.orgId)
      .where('assignedTo.id', '==', ctx.currentId)
      .where('status', 'in', ['todo', 'in_progress'])
      .orderBy('createdAt', 'desc')
      .limit(limit)

    const snap = await query.get()
    const items: InboxItem[] = []
    for (const doc of snap.docs) {
      const data = doc.data()
      if (data.deleted) continue
      const createdAt = toIso(data.createdAt)
      if (!withinCursor(createdAt, ctx.before)) continue
      items.push({
        id: doc.id,
        itemType: 'assignment',
        resourceType: 'task',
        resourceId: doc.id,
        title: data.title ?? 'Task assigned',
        body: (data.description ?? '').toString().slice(0, 280),
        priority: (data.priority ?? 'normal') as InboxItem['priority'],
        link: `/tasks/${doc.id}`,
        createdAt,
        data: {
          status: data.status,
          dueDate: data.dueDate ?? null,
          projectId: data.projectId ?? null,
        },
      })
    }
    return items
  } catch (err) {
    console.error('[inbox-assignments-error]', err)
    return []
  }
}

async function fetchApprovals(ctx: FetchContext, limit: number): Promise<InboxItem[]> {
  const items: InboxItem[] = []

  // Expenses — admin/ai only (clients shouldn't see other people's submissions).
  if (ctx.user.role === 'admin' || ctx.user.role === 'ai') {
    try {
      const snap = await adminDb
        .collection('expenses')
        .where('orgId', '==', ctx.orgId)
        .where('status', '==', 'submitted')
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get()
      for (const doc of snap.docs) {
        const data = doc.data()
        const createdAt = toIso(data.createdAt)
        if (!withinCursor(createdAt, ctx.before)) continue
        items.push({
          id: doc.id,
          itemType: 'approval',
          resourceType: 'expense',
          resourceId: doc.id,
          title: `Expense pending approval${data.amount ? ` — ${data.amount}` : ''}`,
          body: data.description ?? data.vendor ?? '',
          priority: 'normal',
          link: `/expenses/${doc.id}`,
          createdAt,
          data: { amount: data.amount ?? null, submittedBy: data.createdBy ?? null },
        })
      }
    } catch (err) {
      console.warn('[inbox-expenses-skip]', (err as Error).message)
    }
  }

  // Social posts pending approval.
  try {
    const snap = await adminDb
      .collection('social_posts')
      .where('orgId', '==', ctx.orgId)
      .where('status', '==', 'pending_approval')
      .limit(limit)
      .get()
    for (const doc of snap.docs) {
      const data = doc.data()
      const createdAt = toIso(data.createdAt ?? data.scheduledAt ?? data.scheduledFor)
      if (!withinCursor(createdAt, ctx.before)) continue
      const preview = (data.content?.text ?? data.content ?? '').toString().slice(0, 280)
      items.push({
        id: doc.id,
        itemType: 'approval',
        resourceType: 'social_post',
        resourceId: doc.id,
        title: `Social post pending approval${data.platform ? ` (${data.platform})` : ''}`,
        body: preview,
        priority: 'normal',
        link: `/portal/social`,
        createdAt,
        data: { platform: data.platform ?? null, scheduledAt: data.scheduledAt ?? null },
      })
    }
  } catch (err) {
    console.warn('[inbox-social-approvals-skip]', (err as Error).message)
  }

  return items
}

async function fetchOverdueInvoices(ctx: FetchContext, limit: number): Promise<InboxItem[]> {
  try {
    const snap = await adminDb
      .collection('invoices')
      .where('orgId', '==', ctx.orgId)
      .where('status', '==', 'overdue')
      .limit(limit)
      .get()
    const items: InboxItem[] = []
    for (const doc of snap.docs) {
      const data = doc.data()
      // Prefer dueDate as the ordering anchor — otherwise createdAt.
      const createdAt = toIso(data.dueDate ?? data.createdAt)
      if (!withinCursor(createdAt, ctx.before)) continue
      items.push({
        id: doc.id,
        itemType: 'overdue_invoice',
        resourceType: 'invoice',
        resourceId: doc.id,
        title: `Overdue invoice ${data.invoiceNumber ?? ''}`.trim(),
        body: `${data.currency ?? 'USD'} ${data.total ?? 0} — past due`,
        priority: 'high',
        link: `/invoices/${doc.id}`,
        createdAt,
        data: {
          invoiceNumber: data.invoiceNumber ?? null,
          total: data.total ?? null,
          currency: data.currency ?? null,
        },
      })
    }
    return items
  } catch (err) {
    console.error('[inbox-invoices-error]', err)
    return []
  }
}

// --- Handler ---------------------------------------------------------------

export const GET = withAuth('admin', async (req, user) => {
  const { searchParams } = new URL(req.url)
  const orgScope = resolveOrgScope(user, searchParams.get('orgId'))
  if (!orgScope.ok) return apiError(orgScope.error, orgScope.status)
  const orgId = orgScope.orgId

  const scopeRaw = (searchParams.get('for') ?? 'me') as ForScope
  const scope: ForScope = scopeRaw === 'agent' || scopeRaw === 'all' ? scopeRaw : 'me'

  const unreadParam = searchParams.get('unread')
  const unreadOnly = unreadParam === null ? true : unreadParam !== 'false'

  const rawLimit = parseInt(searchParams.get('limit') ?? `${DEFAULT_LIMIT}`, 10)
  const limit = Math.min(
    Math.max(Number.isFinite(rawLimit) ? rawLimit : DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  )

  const cursor = searchParams.get('cursor')
  let before: Date | null = null
  if (cursor) {
    const d = new Date(cursor)
    if (!Number.isNaN(d.getTime())) before = d
  }

  // Resolve the "current id" used for per-recipient filters.
  //  - Humans (admin/client): their Firebase uid.
  //  - Agents (role=ai): their user doc may declare `agentId`; otherwise uid.
  let currentId = user.uid
  if (user.role === 'ai') {
    try {
      const userDoc = await adminDb.collection('users').doc(user.uid).get()
      const agentId = userDoc.data()?.agentId
      if (typeof agentId === 'string' && agentId) currentId = agentId
    } catch {
      // fall through — use uid as the current id
    }
  }

  const ctx: FetchContext = { orgId, scope, user, currentId, unreadOnly, before }

  // Per-source cap: enough to merge-sort sensibly without pulling huge pages.
  const perSourceCap = Math.min(limit * 2, MAX_LIMIT)

  const [notifications, mentions, assignments, approvals, overdueInvoices] =
    await Promise.all([
      fetchNotifications(ctx, perSourceCap),
      fetchMentions(ctx, perSourceCap),
      fetchAssignments(ctx, perSourceCap),
      fetchApprovals(ctx, perSourceCap),
      fetchOverdueInvoices(ctx, perSourceCap),
    ])

  // Merge-sort by createdAt desc, dedupe by (itemType, resourceId).
  const all = [
    ...notifications,
    ...mentions,
    ...assignments,
    ...approvals,
    ...overdueInvoices,
  ]

  const seen = new Set<string>()
  const deduped: InboxItem[] = []
  for (const item of all) {
    const key = `${item.itemType}:${item.resourceType}:${item.resourceId}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
  }

  deduped.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )

  const page = deduped.slice(0, limit)
  const nextCursor =
    deduped.length > limit && page.length > 0
      ? page[page.length - 1].createdAt
      : null

  return apiSuccess({ items: page, nextCursor }, 200, {
    total: page.length,
    page: 1,
    limit,
  })
})
