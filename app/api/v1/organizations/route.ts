/**
 * GET  /api/v1/organizations — list orgs the current user has access to
 * POST /api/v1/organizations — create a new organization
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { buildClientProvisioningPayload, inferAgentName } from '@/lib/client-provisioning/provisioner'
import { provisionFullClientOnVps } from '@/lib/client-provisioning/vps'
import { slugify, isMember } from '@/lib/organizations/helpers'
import type { Organization, OrgMember, OrganizationSummary } from '@/lib/organizations/types'

export const dynamic = 'force-dynamic'

function timestampSeconds(value: unknown): number {
  if (!value || typeof value !== 'object') return 0
  const seconds = (value as { _seconds?: unknown })._seconds
  return typeof seconds === 'number' ? seconds : 0
}

export const GET = withAuth('client', async (req, user) => {
  // Single-field filter only — avoids requiring a composite Firestore index.
  // Sorting is done in memory after fetch.
  const snapshot = await adminDb
    .collection('organizations')
    .where('active', '==', true)
    .get()

  const orgs = snapshot.docs
    .map((doc) => {
      const data = doc.data() as Organization
      return { id: doc.id, ...data }
    })
    .sort((a, b) => {
      const aTs = timestampSeconds(a.createdAt)
      const bTs = timestampSeconds(b.createdAt)
      return bTs - aTs
    })
    .filter((org) => {
      // AI agents always see all orgs.
      if (user.role === 'ai') return true
      // Admins: super admins (no allowedOrgIds) see all; restricted admins
      // see only their allowed orgs (plus their home org if set).
      if (user.role === 'admin') {
        const allowed = user.allowedOrgIds
        if (!Array.isArray(allowed) || allowed.length === 0) return true
        if (org.id === user.orgId) return true
        return allowed.includes(org.id!)
      }
      // Clients: only orgs they are a member of.
      return isMember(org.members ?? [], user.uid)
    })
    .map((org): OrganizationSummary => ({
      id: org.id!,
      name: org.name,
      slug: org.slug,
      type: org.type ?? 'client',
      status: org.status ?? (org.active !== false ? 'active' : 'churned'),
      description: org.description,
      logoUrl: org.logoUrl,
      website: org.website,
      memberCount: (org.members ?? []).length,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
    }))

  return apiSuccess(orgs)
})

export const POST = withAuth('admin', async (req, user) => {
  const body = await req.json().catch(() => ({}))

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return apiError('name is required', 400)

  const slug = slugify(name)

  // Check slug uniqueness
  const existing = await adminDb
    .collection('organizations')
    .where('slug', '==', slug)
    .get()
  if (!existing.empty) return apiError(`An organisation with slug "${slug}" already exists`, 409)

  // Only real human/admin users should be seeded into an org's member list.
  // AI/API-key provisioning creates client workspaces on behalf of the platform;
  // adding `ai-agent` as an owner produces an unremovable "Unknown" team member.
  const initialMembers: OrgMember[] = user.role === 'ai'
    ? []
    : [{ userId: user.uid, role: 'owner' }]
  const inputSettings = body.settings && typeof body.settings === 'object'
    ? body.settings as Record<string, unknown>
    : {}
  const currency = ['USD', 'EUR', 'ZAR'].includes(String(inputSettings.currency))
    ? String(inputSettings.currency)
    : 'ZAR'
  const timezone = typeof inputSettings.timezone === 'string' && inputSettings.timezone.trim()
    ? inputSettings.timezone.trim()
    : 'Africa/Johannesburg'

  const doc = {
    name,
    slug,
    type: typeof body.type === 'string' ? body.type : 'client',
    status: typeof body.status === 'string' ? body.status : 'active',
    description: typeof body.description === 'string' ? body.description.trim() : '',
    logoUrl: typeof body.logoUrl === 'string' ? body.logoUrl.trim() : '',
    website: typeof body.website === 'string' ? body.website.trim() : '',
    industry: typeof body.industry === 'string' ? body.industry.trim() : '',
    billingEmail: typeof body.billingEmail === 'string' ? body.billingEmail.trim() : '',
    plan: typeof body.plan === 'string' ? body.plan : '',
    createdBy: user.uid,
    members: initialMembers,
    settings: {
      timezone,
      currency,
      defaultApprovalRequired: Boolean(inputSettings.defaultApprovalRequired),
      notificationEmail: typeof inputSettings.notificationEmail === 'string'
        ? inputSettings.notificationEmail.trim()
        : '',
    },
    linkedClientId: '',
    active: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }

  const docRef = await adminDb.collection('organizations').add(doc)

  const shouldProvisionWorkspace = doc.type === 'client' && body.provisionWorkspace !== false
  if (!shouldProvisionWorkspace) {
    return apiSuccess({ id: docRef.id, slug, provisioning: { status: 'skipped' } }, 201)
  }

  const agentName = typeof body.agentName === 'string' && body.agentName.trim()
    ? body.agentName.trim()
    : inferAgentName(name)
  const provisioningPayload = buildClientProvisioningPayload({
    clientName: name,
    domain: slug,
    orgId: docRef.id,
    agentName,
  })

  try {
    const provisioning = await provisionFullClientOnVps({
      clientName: name,
      domain: slug,
      orgId: docRef.id,
      agentName,
    })

    await docRef.set({
      folderRegistry: provisioningPayload.folderRegistry,
      provisioning: {
        status: 'complete',
        domain: slug,
        agentName,
        updatedAt: FieldValue.serverTimestamp(),
        result: provisioning,
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })

    return apiSuccess({ id: docRef.id, slug, provisioning }, 201)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Client workspace provisioning failed'
    await docRef.set({
      folderRegistry: provisioningPayload.folderRegistry,
      provisioning: {
        status: 'failed',
        domain: slug,
        agentName,
        error: message,
        updatedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })

    return apiError(`Organization created, but workspace provisioning failed: ${message}`, 500, { id: docRef.id, slug })
  }
})
