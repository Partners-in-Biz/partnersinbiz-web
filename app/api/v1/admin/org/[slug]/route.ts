/**
 * GET    /api/v1/admin/org/[slug] — full org-detail control panel payload (US-296+)
 * DELETE /api/v1/admin/org/[slug] — soft-delete an org (active:false, status:churned)
 *
 * The platform-admin org detail surface. Resolves an org by slug, returns the
 * org document plus computed live usage metrics (contacts, sends 30d, social
 * accounts, projects, members, campaigns) and the admin-managed billing / flag
 * / dev-mode / status state — all from live Firestore, no stubs.
 *
 * Auth: super-admin only.
 */
import { NextRequest } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb, adminAuth } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { writeAdminAudit } from '@/lib/admin/audit'
import {
  monthlyRecurringForOrg,
  toZar,
  type AdminBilling,
} from '@/lib/admin/billing-model'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ slug: string }> }

interface OrgMemberLike {
  userId: string
  role?: string
  jobTitle?: string
  department?: string
}

interface OrgDocLike {
  name?: string
  slug?: string
  type?: string
  status?: string
  plan?: string
  createdBy?: string
  members?: OrgMemberLike[]
  adminBilling?: AdminBilling
  featureFlags?: Record<string, boolean>
  devMode?: boolean
  settings?: Record<string, unknown>
  suspension?: Record<string, unknown>
  billingEmail?: string
  website?: string
  industry?: string
  logoUrl?: string
  description?: string
  createdAt?: unknown
  updatedAt?: unknown
}

/**
 * Resolve a single org doc by its slug. Shared shape used by every slug-keyed
 * admin org route. Returns null when not found.
 */
export async function resolveOrgBySlug(slug: string): Promise<{ id: string; data: OrgDocLike } | null> {
  const snap = await adminDb.collection('organizations').where('slug', '==', slug).limit(1).get()
  if (snap.empty) return null
  const doc = snap.docs[0]
  return { id: doc.id, data: doc.data() as OrgDocLike }
}

/** Find the owner uid: prefer a member with role 'owner', else createdBy. */
export function resolveOwnerUid(org: OrgDocLike): string | null {
  const ownerMember = (org.members ?? []).find((m) => m.role === 'owner')
  if (ownerMember?.userId) return ownerMember.userId
  if (org.createdBy) return org.createdBy
  const firstMember = (org.members ?? [])[0]
  return firstMember?.userId ?? null
}

async function safeCount(query: FirebaseFirestore.Query): Promise<number> {
  try {
    const snap = await query.count().get()
    return snap.data().count
  } catch {
    return 0
  }
}

const COUNTABLE_EMAIL_STATUSES = ['sent', 'delivered', 'opened', 'clicked']

export const GET = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Super-admin access required', 403)

  const { slug } = await (ctx as RouteContext).params
  const resolved = await resolveOrgBySlug(slug)
  if (!resolved) return apiError('Organisation not found', 404)
  const { id, data: org } = resolved

  const cutoff30d = Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const [
    contactsCount,
    socialCount,
    projectsCount,
    campaignsCount,
    emailSends30d,
  ] = await Promise.all([
    safeCount(adminDb.collection('contacts').where('orgId', '==', id)),
    safeCount(adminDb.collection('social_accounts').where('orgId', '==', id)),
    safeCount(adminDb.collection('projects').where('orgId', '==', id)),
    safeCount(adminDb.collection('campaigns').where('orgId', '==', id)),
    Promise.all(
      COUNTABLE_EMAIL_STATUSES.map((status) =>
        safeCount(
          adminDb
            .collection('emails')
            .where('orgId', '==', id)
            .where('status', '==', status)
            .where('sentAt', '>=', cutoff30d),
        ),
      ),
    ).then((counts) => counts.reduce((a, b) => a + b, 0)),
  ])

  // Resolve owner identity from Firebase Auth.
  const ownerUid = resolveOwnerUid(org)
  let owner: { uid: string; email: string; displayName: string } | null = null
  if (ownerUid) {
    try {
      const authUser = await adminAuth.getUser(ownerUid)
      owner = {
        uid: ownerUid,
        email: authUser.email ?? '',
        displayName: authUser.displayName ?? '',
      }
    } catch {
      owner = { uid: ownerUid, email: '', displayName: '' }
    }
  }

  // MRR contribution in ZAR.
  const monthly = monthlyRecurringForOrg(org.adminBilling)
  const mrrZar = monthly > 0 ? Math.round(toZar(monthly, org.adminBilling?.currency)) : 0

  return apiSuccess({
    id,
    slug: org.slug ?? slug,
    name: org.name ?? 'Untitled organisation',
    type: org.type ?? 'client',
    status: org.status ?? 'active',
    plan: org.plan ?? null,
    description: org.description ?? '',
    website: org.website ?? '',
    industry: org.industry ?? '',
    logoUrl: org.logoUrl ?? '',
    billingEmail: org.billingEmail ?? '',
    createdAt: org.createdAt ?? null,
    updatedAt: org.updatedAt ?? null,
    owner,
    devMode: org.devMode === true,
    featureFlags: org.featureFlags ?? {},
    suspension: org.suspension ?? null,
    adminBilling: org.adminBilling ?? null,
    mrrZar,
    metrics: {
      contacts: contactsCount,
      emailSends30d,
      socialAccounts: socialCount,
      projects: projectsCount,
      campaigns: campaignsCount,
      teamSize: (org.members ?? []).length,
    },
  })
})

export const DELETE = withAuth('admin', async (req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Super-admin access required', 403)

  const { slug } = await (ctx as RouteContext).params
  const resolved = await resolveOrgBySlug(slug)
  if (!resolved) return apiError('Organisation not found', 404)
  const { id, data: org } = resolved

  const body = await req.json().catch(() => ({}))
  const confirmName = typeof body?.confirmName === 'string' ? body.confirmName.trim() : ''
  if (confirmName !== (org.name ?? '').trim()) {
    return apiError('Confirmation name does not match the organisation name', 400)
  }

  await adminDb.collection('organizations').doc(id).update({
    active: false,
    status: 'churned',
    'adminBilling.state': 'cancelled',
    'adminBilling.cancelledAt': new Date().toISOString(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  await writeAdminAudit(user, {
    action: 'org.delete',
    orgId: id,
    summary: `Soft-deleted organisation "${org.name ?? slug}" (status → churned)`,
    metadata: { slug },
  })

  return apiSuccess({ id, deleted: true })
})
