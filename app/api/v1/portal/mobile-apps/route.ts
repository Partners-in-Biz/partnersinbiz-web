import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiSuccess } from '@/lib/api/response'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { clientSafeMobileApp, serializeMobileApp } from '@/lib/mobile-apps/sanitize'
import type { MobileAppPlatform, MobileAppProfileLink, MobileAppProfileLinkType } from '@/lib/mobile-apps/types'
import {
  canRolePerformModuleAction,
  resolveOrganizationModulePolicies,
} from '@/lib/organizations/module-policies'
import { isPortalModuleEnabled } from '@/lib/organizations/portal-modules'

export const dynamic = 'force-dynamic'

const PROFILE_LINK_TYPES: MobileAppProfileLinkType[] = ['developer_account', 'store_account', 'analytics', 'support', 'other']
const PLATFORMS: MobileAppPlatform[] = ['ios', 'android', 'huawei', 'web', 'other']

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function mobileAppCapabilities(settings: unknown, role: unknown) {
  const policies = resolveOrganizationModulePolicies(settings)
  return {
    canCreate: canRolePerformModuleAction(policies, 'mobileApps', 'create', role),
    canEdit: canRolePerformModuleAction(policies, 'mobileApps', 'edit', role),
    canManageStoreLinks: canRolePerformModuleAction(policies, 'mobileApps', 'storeLinks', role),
    canViewAnalytics: canRolePerformModuleAction(policies, 'mobileApps', 'analytics', role),
  }
}

function cleanProfileLink(value: unknown, uid: string): MobileAppProfileLink | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const label = cleanString(input.label)
  if (!label) return null
  const type = PROFILE_LINK_TYPES.includes(input.type as MobileAppProfileLinkType)
    ? input.type as MobileAppProfileLinkType
    : 'other'
  const platform = PLATFORMS.includes(input.platform as MobileAppPlatform)
    ? input.platform as MobileAppPlatform
    : undefined

  return {
    id: cleanString(input.id) ?? `link-${Date.now()}`,
    type,
    label,
    ...(platform ? { platform } : {}),
    ...(cleanString(input.url) ? { url: cleanString(input.url) } : {}),
    ...(cleanString(input.accountId) ? { accountId: cleanString(input.accountId) } : {}),
    ...(cleanString(input.notes) ? { notes: cleanString(input.notes) } : {}),
    status: 'linked',
    linkedBy: uid,
    linkedByType: 'user',
    linkedAt: new Date().toISOString(),
  }
}

function withProfileLink(existing: MobileAppProfileLink[] | undefined, link: MobileAppProfileLink | null) {
  if (!link) return existing
  return [...(Array.isArray(existing) ? existing : []), link]
}

async function mobileAppsModuleGuard(orgId: string, role: unknown, actionId = 'visibility') {
  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgDoc.exists) return apiError('Organisation not found', 404)
  const settings = orgDoc.data()?.settings
  if (!isPortalModuleEnabled(settings, 'mobileApps')) {
    return apiError('Mobile Apps module is disabled for this client portal', 403, {
      moduleDisabled: true,
      module: 'mobileApps',
    })
  }
  const policies = resolveOrganizationModulePolicies(settings)
  if (!canRolePerformModuleAction(policies, 'mobileApps', actionId, role)) {
    return apiError(
      actionId === 'visibility'
        ? 'Mobile Apps module is disabled for your organisation role'
        : 'Mobile Apps action is disabled for your organisation role',
      403,
      {
        moduleDisabled: actionId === 'visibility',
        module: 'mobileApps',
      },
    )
  }
  return null
}

export const GET = withPortalAuthAndRole('viewer', async (_req: NextRequest, _uid, orgId, role) => {
  const disabled = await mobileAppsModuleGuard(orgId, role)
  if (disabled) return disabled
  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  const capabilities = mobileAppCapabilities(orgDoc.data()?.settings, role)

  const snap = await adminDb
    .collection('mobile_apps')
    .where('orgId', '==', orgId)
    .get()

  const apps = snap.docs
    .map((doc) => clientSafeMobileApp(serializeMobileApp(doc.id, doc.data())))
    .filter((app) => app.visibility?.showInClientPortal !== false)
    .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))

  return apiSuccess({ apps, capabilities })
})

export const PUT = withPortalAuthAndRole('member', async (req: NextRequest, uid, orgId, role) => {
  const body = await req.json().catch(() => ({}))
  const disabled = await mobileAppsModuleGuard(orgId, role, isRecord(body.profileLink) ? 'storeLinks' : 'edit')
  if (disabled) return disabled

  const appId = typeof body.id === 'string' ? body.id.trim() : ''
  if (!appId) return apiError('id is required', 400)

  const ref = adminDb.collection('mobile_apps').doc(appId)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Mobile app not found', 404)
  const app = serializeMobileApp(doc.id, doc.data()!)
  if (app.orgId !== orgId) return apiError('Forbidden', 403)

  const listing = app.listing ?? {}
  const profileLink = cleanProfileLink(body.profileLink, uid)
  const update: Record<string, unknown> = {
    clientNotes: typeof body.clientNotes === 'string' ? body.clientNotes.trim() : app.clientNotes ?? '',
    listing: {
      ...listing,
      clientFeedback: typeof body.clientFeedback === 'string' ? body.clientFeedback.trim() : listing.clientFeedback ?? '',
    },
    updatedBy: uid,
    updatedByType: 'user',
    updatedAt: FieldValue.serverTimestamp(),
  }
  const profileLinks = withProfileLink(app.profileLinks, profileLink)
  if (profileLinks) update.profileLinks = profileLinks

  await ref.set(update, { merge: true })

  return apiSuccess({ id: appId, updated: true })
})

export const POST = withPortalAuthAndRole('member', async (req: NextRequest, uid, orgId, role) => {
  const body = await req.json().catch(() => ({}))
  const disabled = await mobileAppsModuleGuard(orgId, role, 'create')
  if (disabled) return disabled

  const appName = cleanString(body.appName) ?? cleanString(body.name)
  if (!appName) return apiError('appName is required', 400)

  const profileLink = cleanProfileLink(body.profileLink, uid)
  if (!profileLink) return apiError('profileLink.label is required', 400)

  const platform = PLATFORMS.includes(body.platform as MobileAppPlatform)
    ? body.platform as MobileAppPlatform
    : profileLink.platform ?? 'other'

  const created = await adminDb.collection('mobile_apps').add({
    orgId,
    name: appName,
    platform,
    status: 'planned',
    visibility: {
      showInClientPortal: true,
      showAnalytics: true,
      showReleaseNotes: true,
    },
    profileLinks: [profileLink],
    createdBy: uid,
    createdByType: 'user',
    createdAt: FieldValue.serverTimestamp(),
    updatedBy: uid,
    updatedByType: 'user',
    updatedAt: FieldValue.serverTimestamp(),
  })

  return apiSuccess({ id: created.id, created: true }, 201)
})
