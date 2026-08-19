/**
 * GET  /api/v1/organizations — list orgs the current user has access to
 * POST /api/v1/organizations — create a new organization
 */
import { FieldValue } from 'firebase-admin/firestore'
import type * as FirebaseFirestore from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { buildClientProvisioningPayload, inferAgentName } from '@/lib/client-provisioning/provisioner'
import { upsertOrgWorkspace } from '@/lib/client-provisioning/workspace-context'
import { provisionFullClientOnVps } from '@/lib/client-provisioning/vps'
import { slugify } from '@/lib/organizations/helpers'
import type { Organization, OrgMember, OrganizationSummary } from '@/lib/organizations/types'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

export interface TrustedOrganizationCreateOptions {
  documentId: string
  setupOperationId: string
}

function isAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  return code === 6 || code === 'already-exists'
}

function validTrustedOrganizationCreateOptions(value: TrustedOrganizationCreateOptions): boolean {
  return /^setup_org_[a-f0-9]{40}$/.test(value.documentId)
    && Boolean(value.setupOperationId.trim())
    && value.setupOperationId.length <= 256
}

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
      // Clients: canonical, revocable orgMembers scope is already resolved
      // into the authenticated user's org IDs. Embedded member arrays are a
      // legacy display cache and must not resurrect a revoked membership.
      return canAccessOrg(user, org.id)
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

export async function handleOrganizationCreate(
  req: NextRequest,
  user: ApiUser,
  trustedSetup?: TrustedOrganizationCreateOptions,
) {
  const body = await req.json().catch(() => ({}))
  if (trustedSetup && !validTrustedOrganizationCreateOptions(trustedSetup)) {
    return apiError('Organisation setup resource identity is invalid', 500)
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return apiError('name is required', 400)

  const requestedDomain = typeof body.domainSlug === 'string'
    ? body.domainSlug.trim()
    : typeof body.slug === 'string' ? body.slug.trim() : ''
  if (requestedDomain && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requestedDomain)) {
    return apiError('domainSlug must be kebab-case', 400)
  }
  const slug = requestedDomain || slugify(name)

  let trustedRef: FirebaseFirestore.DocumentReference | null = null
  let trustedExisting: FirebaseFirestore.DocumentSnapshot | null = null
  if (trustedSetup) {
    trustedRef = adminDb.collection('organizations').doc(trustedSetup.documentId)
    const snapshot = await trustedRef.get()
    if (snapshot.exists) {
      const existing = snapshot.data() ?? {}
      if (existing.setupOperationId !== trustedSetup.setupOperationId
        || existing.name !== name || existing.slug !== slug) {
        return apiError('Organisation setup resource conflict', 409)
      }
      const provisioning = existing.provisioning && typeof existing.provisioning === 'object'
        ? existing.provisioning as Record<string, unknown>
        : {}
      if (existing.setupCreationStatus === 'complete'
        || provisioning.status === 'complete' || provisioning.status === 'skipped') {
        return apiSuccess({ id: trustedRef.id, slug, provisioning }, 200)
      }
      trustedExisting = snapshot
    }
  }

  // Check slug uniqueness
  if (!trustedExisting) {
    const existing = await adminDb
      .collection('organizations')
      .where('slug', '==', slug)
      .get()
    if (!existing.empty) return apiError(`An organisation with slug "${slug}" already exists`, 409)
  }

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
    ...(trustedSetup ? {
      setupOperationId: trustedSetup.setupOperationId,
      setupCreationStatus: 'creating',
    } : {}),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }

  let setupReplay = Boolean(trustedExisting)
  let docRef: FirebaseFirestore.DocumentReference
  if (trustedSetup && trustedRef) {
    docRef = trustedRef
    if (!trustedExisting) {
      try {
        await docRef.create(doc)
      } catch (error) {
        if (!isAlreadyExistsError(error)) throw error
        const raced = await docRef.get()
        const existing = raced.data() ?? {}
        if (!raced.exists || existing.setupOperationId !== trustedSetup.setupOperationId
          || existing.name !== name || existing.slug !== slug) {
          return apiError('Organisation setup resource conflict', 409)
        }
        setupReplay = true
        const provisioning = existing.provisioning && typeof existing.provisioning === 'object'
          ? existing.provisioning as Record<string, unknown>
          : {}
        if (existing.setupCreationStatus === 'complete'
          || provisioning.status === 'complete' || provisioning.status === 'skipped') {
          return apiSuccess({ id: docRef.id, slug, provisioning }, 200)
        }
      }
    }
  } else {
    docRef = await adminDb.collection('organizations').add(doc)
  }

  // `orgMembers` is the canonical, revocable membership source used by the
  // workspace switcher, project access, and shared execution locations. Keep
  // it in step with the embedded organisation member created for a human.
  if (user.role !== 'ai') {
    await adminDb.collection('orgMembers').doc(`${docRef.id}_${user.uid}`).set(
      {
        orgId: docRef.id,
        uid: user.uid,
        firstName: '',
        lastName: '',
        avatarUrl: '',
        role: 'owner',
        status: 'active',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  }

  const shouldProvisionWorkspace = doc.type === 'client' && body.provisionWorkspace !== false
  if (!shouldProvisionWorkspace) {
    const provisioning = { status: 'skipped' }
    if (trustedSetup) {
      await docRef.set({
        setupCreationStatus: 'complete',
        provisioning,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }
    return apiSuccess({ id: docRef.id, slug, provisioning }, setupReplay ? 200 : 201)
  }

  const agentName = typeof body.agentName === 'string' && body.agentName.trim()
    ? body.agentName.trim()
    : inferAgentName(name)
  const contactIds = Array.isArray(body.contactIds)
    ? body.contactIds.filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
    : []
  const companyId = typeof body.companyId === 'string' && body.companyId.trim()
    ? body.companyId.trim()
    : null
  const provisioningPayload = buildClientProvisioningPayload({
    clientName: name,
    domain: slug,
    orgId: docRef.id,
    orgSlug: slug,
    platformOwned: false,
    agentName,
    companyId,
    contactIds,
  })

  try {
    const provisioning = await provisionFullClientOnVps({
      clientName: name,
      domain: slug,
      orgId: docRef.id,
      orgSlug: slug,
      platformOwned: false,
      agentName,
      companyId,
      contactIds,
    })

    const workspace = await upsertOrgWorkspace(provisioningPayload.manifest)

    await docRef.set({
      folderRegistry: provisioningPayload.folderRegistry,
      workspaceId: provisioningPayload.manifest.workspaceId,
      workspaceManifest: provisioningPayload.manifest,
      provisioning: {
        status: 'complete',
        domain: slug,
        agentName,
        workspaceId: workspace.workspaceId,
        updatedAt: FieldValue.serverTimestamp(),
        result: provisioning,
      },
      ...(trustedSetup ? { setupCreationStatus: 'complete' } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })

    return apiSuccess({ id: docRef.id, slug, provisioning }, setupReplay ? 200 : 201)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Client workspace provisioning failed'
    await docRef.set({
      folderRegistry: provisioningPayload.folderRegistry,
      workspaceId: provisioningPayload.manifest.workspaceId,
      workspaceManifest: provisioningPayload.manifest,
      provisioning: {
        status: 'failed',
        domain: slug,
        agentName,
        error: message,
        updatedAt: FieldValue.serverTimestamp(),
      },
      ...(trustedSetup ? { setupCreationStatus: 'retryable' } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })

    return apiError(`Organization created, but workspace provisioning failed: ${message}`, 500, { id: docRef.id, slug })
  }
}

// Do not pass Next.js route context through as trustedSetup — that is only for
// explicit internal setup callers. Public POST must omit the third argument.
export const POST = withAuth('admin', (req: NextRequest, user: ApiUser) => handleOrganizationCreate(req, user))
