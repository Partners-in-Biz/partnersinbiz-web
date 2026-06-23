/**
 * GET /api/v1/admin/dashboard/organizations
 *
 * Rich admin organisations list (US-252). Computes everything from live
 * Firestore data — no stubs, no mock numbers. One row per client org
 * (platform_owner orgs excluded) with:
 *
 *  - id, name, slug, status, plan, createdAt
 *  - ownerEmail: resolved from the org's `owner` member → users/{uid}.email,
 *    batched with where('__name__','in', chunk) in chunks of 10.
 *    Falls back to org.billingEmail.
 *  - mrr: monthlyRecurringForOrg(adminBilling) normalised to ZAR.
 *  - contacts: count of contacts where orgId == id.
 *  - sends30d: count of emails (sent/delivered/opened/clicked) in the last 30d.
 *
 * Auth: super-admin only.
 */
import { NextRequest } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import {
  monthlyRecurringForOrg,
  toZar,
  type AdminBilling,
} from '@/lib/admin/billing-model'

export const dynamic = 'force-dynamic'

type FsTimestamp = { _seconds?: number; _nanoseconds?: number; seconds?: number } | Timestamp | Date | string | null | undefined

/** Read a Firestore-shaped timestamp into epoch ms, or null. */
function tsToMillis(value: FsTimestamp): number | null {
  if (!value) return null
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : null
  }
  if (value instanceof Timestamp) return value.toMillis()
  if (typeof value === 'object') {
    const src = value as { _seconds?: number; seconds?: number; toMillis?: () => number }
    if (typeof src.toMillis === 'function') {
      try { return src.toMillis() } catch { /* noop */ }
    }
    const seconds = src._seconds ?? src.seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return null
}

const COUNTABLE_EMAIL_STATUSES = ['sent', 'delivered', 'opened', 'clicked']

interface OrgMemberLite {
  userId?: string
  role?: string
}

interface OrgDoc {
  name?: string
  slug?: string
  type?: string
  status?: string
  plan?: string
  billingEmail?: string
  createdAt?: FsTimestamp
  adminBilling?: AdminBilling
  members?: OrgMemberLite[]
}

interface AdminOrgRow {
  id: string
  name: string
  slug: string
  status: string
  plan: string
  createdAt: number | null
  ownerEmail: string
  mrr: number
  contacts: number
  sends30d: number
}

export const GET = withAuth('admin', async (_req: NextRequest, user) => {
  if (!isSuperAdmin(user)) {
    return apiError('Super-admin access required', 403)
  }

  const orgsSnap = await adminDb.collection('organizations').get()

  // Build the client-org list (exclude platform_owner) and collect owner uids.
  const clientOrgs: Array<{ id: string; data: OrgDoc; ownerUid: string | null }> = []
  const ownerUids = new Set<string>()

  for (const doc of orgsSnap.docs) {
    const data = doc.data() as OrgDoc
    if (data.type === 'platform_owner') continue
    const owner = (data.members ?? []).find((m) => m.role === 'owner' && typeof m.userId === 'string' && m.userId)
    const ownerUid = owner?.userId ?? null
    if (ownerUid) ownerUids.add(ownerUid)
    clientOrgs.push({ id: doc.id, data, ownerUid })
  }

  // Resolve owner emails: batch users/{uid} lookups in chunks of 10.
  const ownerEmailByUid = new Map<string, string>()
  const uidList = Array.from(ownerUids)
  const chunkSize = 10
  const uidChunks: string[][] = []
  for (let i = 0; i < uidList.length; i += chunkSize) {
    uidChunks.push(uidList.slice(i, i + chunkSize))
  }
  await Promise.all(
    uidChunks.map(async (chunk) => {
      if (chunk.length === 0) return
      const snap = await adminDb
        .collection('users')
        .where('__name__', 'in', chunk)
        .get()
      for (const doc of snap.docs) {
        const email = doc.data()?.email
        if (typeof email === 'string' && email) ownerEmailByUid.set(doc.id, email)
      }
    }),
  )

  // 30-day window for email sends.
  const sendsCutoff = Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000)

  // Compute contacts count + sends30d per org. Orgs are few, but cap concurrency
  // so we never fan out an unbounded number of aggregation queries at once.
  const rows: AdminOrgRow[] = []
  const concurrency = 6
  let cursor = 0

  async function worker() {
    while (cursor < clientOrgs.length) {
      const index = cursor++
      const { id, data, ownerUid } = clientOrgs[index]

      const contactsPromise = adminDb
        .collection('contacts')
        .where('orgId', '==', id)
        .count()
        .get()
        .then((s) => s.data().count)
        .catch(() => 0)

      const sendsPromise = Promise.all(
        COUNTABLE_EMAIL_STATUSES.map((status) =>
          adminDb
            .collection('emails')
            .where('orgId', '==', id)
            .where('status', '==', status)
            .where('sentAt', '>=', sendsCutoff)
            .count()
            .get()
            .then((s) => s.data().count)
            .catch(() => 0),
        ),
      ).then((counts) => counts.reduce((sum, n) => sum + n, 0))

      const [contacts, sends30d] = await Promise.all([contactsPromise, sendsPromise])

      const monthly = monthlyRecurringForOrg(data.adminBilling)
      const mrr = monthly > 0 ? Math.round(toZar(monthly, data.adminBilling?.currency)) : 0

      const ownerEmail =
        (ownerUid ? ownerEmailByUid.get(ownerUid) : undefined) ??
        (typeof data.billingEmail === 'string' ? data.billingEmail : '') ??
        ''

      rows.push({
        id,
        name: data.name ?? 'Untitled organisation',
        slug: data.slug ?? '',
        status: data.status ?? 'active',
        plan: typeof data.plan === 'string' ? data.plan : '',
        createdAt: tsToMillis(data.createdAt),
        ownerEmail,
        mrr,
        contacts,
        sends30d,
      })
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, clientOrgs.length || 1) }, () => worker()))

  // Most recently created first as a stable default.
  rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))

  return apiSuccess({ organizations: rows })
})
