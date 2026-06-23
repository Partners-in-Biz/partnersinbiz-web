// app/api/v1/org/domain/route.ts
//
// White-label custom domain config for an organisation.
// GET  -> current domain config from organizations.{orgId}.settings.customDomain
// PUT  -> (admin) save subdomain + customDomain
//
// The platform routes white-label traffic via a single CNAME target. Clients
// point their custom domain (or chosen subdomain's external CNAME) at that
// target; once DNS is verified the platform auto-provisions SSL.

import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withPortalAuth, withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { canUsePortalOrg, resolvePortalActiveOrgId } from '@/lib/portal/org-access'
import { logActivity } from '@/lib/activity/log'

export const dynamic = 'force-dynamic'

// The CNAME target every white-label domain must point at.
export const DOMAIN_CNAME_TARGET = 'cname.partnersinbiz.online'
const ROOT_DOMAIN = 'partnersinbiz.online'

type SslStatus = 'pending' | 'active' | 'failed'

type CustomDomainConfig = {
  subdomain: string
  customDomain: string
  verified: boolean
  sslStatus: SslStatus
  dnsTarget: string
  verifiedAt?: string | null
  lastCheckedAt?: string | null
  lastError?: string | null
}

function normaliseHost(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '')
}

// A subdomain label: letters, digits, hyphens; cannot start/end with hyphen.
function normaliseSubdomain(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').split('.')[0].replace(/[^a-z0-9-]/g, '')
}

function isValidSubdomain(value: string): boolean {
  return value.length === 0 || /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)
}

function isValidDomain(value: string): boolean {
  return value.length === 0 || /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(value)
}

export function buildDomainConfig(raw: Record<string, unknown> | undefined): CustomDomainConfig {
  const cfg = (raw ?? {}) as Record<string, unknown>
  const sslStatus = cfg.sslStatus === 'active' || cfg.sslStatus === 'failed' ? cfg.sslStatus : 'pending'
  return {
    subdomain: typeof cfg.subdomain === 'string' ? cfg.subdomain : '',
    customDomain: typeof cfg.customDomain === 'string' ? cfg.customDomain : '',
    verified: cfg.verified === true,
    sslStatus,
    dnsTarget: DOMAIN_CNAME_TARGET,
    verifiedAt: typeof cfg.verifiedAt === 'string' ? cfg.verifiedAt : null,
    lastCheckedAt: typeof cfg.lastCheckedAt === 'string' ? cfg.lastCheckedAt : null,
    lastError: typeof cfg.lastError === 'string' ? cfg.lastError : null,
  }
}

type ResolvedOrg = { ok: true; orgId: string } | { ok: false; response: Response }

async function resolveOrgIdForGet(req: NextRequest, uid: string): Promise<ResolvedOrg> {
  const userDoc = await adminDb.collection('users').doc(uid).get()
  if (!userDoc.exists) return { ok: false, response: apiError('User not found', 404) }
  const userData = userDoc.data() ?? {}
  const requestedOrgId = req.nextUrl.searchParams.get('orgId')?.trim() ?? ''
  if (requestedOrgId) {
    const allowed = await canUsePortalOrg(uid, userData, requestedOrgId)
    if (!allowed) return { ok: false, response: apiError('You do not have access to this organisation', 403) }
    return { ok: true, orgId: requestedOrgId }
  }
  const orgId = await resolvePortalActiveOrgId(uid, userData)
  if (!orgId) return { ok: false, response: apiError('No active workspace', 400) }
  return { ok: true, orgId }
}

export const GET = withPortalAuth(async (req: NextRequest, uid: string) => {
  try {
    const resolved = await resolveOrgIdForGet(req, uid)
    if (!resolved.ok) return resolved.response
    const { orgId } = resolved

    const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
    if (!orgDoc.exists) return apiError('Organisation not found', 404)
    const settings = (orgDoc.data()?.settings ?? {}) as Record<string, unknown>
    const config = buildDomainConfig(settings.customDomain as Record<string, unknown> | undefined)

    return apiSuccess({ domain: config, rootDomain: ROOT_DOMAIN })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const PUT = withPortalAuthAndRole('admin', async (req: NextRequest, uid: string, orgId: string, role: string) => {
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>

    const subdomain = normaliseSubdomain(body.subdomain)
    const customDomain = normaliseHost(body.customDomain)

    if (!isValidSubdomain(subdomain)) return apiError('Subdomain may only contain letters, numbers and hyphens', 400)
    if (!isValidDomain(customDomain)) return apiError('Custom domain must be a valid domain name (e.g. portal.acme.com)', 400)

    const orgRef = adminDb.collection('organizations').doc(orgId)
    const orgDoc = await orgRef.get()
    if (!orgDoc.exists) return apiError('Organisation not found', 404)

    const settings = (orgDoc.data()?.settings ?? {}) as Record<string, unknown>
    const existing = buildDomainConfig(settings.customDomain as Record<string, unknown> | undefined)

    // Changing the custom domain invalidates any prior verification.
    const domainChanged = existing.customDomain !== customDomain
    const next: CustomDomainConfig = {
      subdomain,
      customDomain,
      verified: domainChanged ? false : existing.verified,
      sslStatus: domainChanged ? 'pending' : existing.sslStatus,
      dnsTarget: DOMAIN_CNAME_TARGET,
      verifiedAt: domainChanged ? null : existing.verifiedAt,
      lastCheckedAt: existing.lastCheckedAt,
      lastError: domainChanged ? null : existing.lastError,
    }

    await orgRef.set(
      { settings: { customDomain: next }, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )

    await logActivity({
      orgId,
      type: 'org_domain_updated',
      actorId: uid,
      actorName: uid,
      actorRole: role === 'admin' || role === 'owner' ? 'admin' : 'client',
      description: `Updated white-label domain settings (subdomain: ${subdomain || '—'}, custom domain: ${customDomain || '—'})`,
      entityType: 'org_domain',
      entityId: orgId,
    })

    return apiSuccess({ domain: next, rootDomain: ROOT_DOMAIN })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
