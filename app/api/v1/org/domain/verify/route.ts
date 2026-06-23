// app/api/v1/org/domain/verify/route.ts
//
// POST (admin) — performs a REAL DNS lookup (resolveCname) against the org's
// configured custom domain and checks it points at the platform CNAME target.
// On success: verified=true, sslStatus='active' (platform auto-provisions the
// certificate once DNS resolves), verifiedAt persisted. Missing/unresolved DNS
// (ENOTFOUND/ENODATA/SERVFAIL) is treated as "not yet verified", not an error.

import { NextRequest } from 'next/server'
import { resolveCname } from 'dns/promises'
import { FieldValue } from 'firebase-admin/firestore'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { logActivity } from '@/lib/activity/log'
import { DOMAIN_CNAME_TARGET, buildDomainConfig } from '../route'

export const dynamic = 'force-dynamic'

const NOT_YET_VERIFIED_CODES = new Set(['ENOTFOUND', 'ENODATA', 'SERVFAIL', 'NOTFOUND', 'NXDOMAIN'])

function dnsErrorCode(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code
    return typeof code === 'string' ? code : null
  }
  return null
}

export const POST = withPortalAuthAndRole('admin', async (_req: NextRequest, uid: string, orgId: string, role: string) => {
  try {
    const orgRef = adminDb.collection('organizations').doc(orgId)
    const orgDoc = await orgRef.get()
    if (!orgDoc.exists) return apiError('Organisation not found', 404)

    const settings = (orgDoc.data()?.settings ?? {}) as Record<string, unknown>
    const config = buildDomainConfig(settings.customDomain as Record<string, unknown> | undefined)

    if (!config.customDomain) {
      return apiError('Add a custom domain before verifying', 400)
    }

    const nowIso = new Date().toISOString()
    let verified = false
    let cnames: string[] = []
    let lastError: string | null = null

    try {
      cnames = await resolveCname(config.customDomain)
      const expected = DOMAIN_CNAME_TARGET.toLowerCase().replace(/\.$/, '')
      verified = cnames.some((c) => c.toLowerCase().replace(/\.$/, '') === expected)
      if (!verified) {
        lastError = `CNAME found (${cnames.join(', ') || 'none'}) but does not point at ${DOMAIN_CNAME_TARGET}`
      }
    } catch (err) {
      const code = dnsErrorCode(err)
      if (code && NOT_YET_VERIFIED_CODES.has(code)) {
        lastError = `No CNAME record found yet (${code}). DNS may take time to propagate.`
      } else {
        // Unexpected DNS failure — surface as 502 so the client knows to retry.
        return apiError(`DNS lookup failed: ${err instanceof Error ? err.message : String(err)}`, 502)
      }
    }

    const next = {
      ...config,
      verified,
      sslStatus: verified ? 'active' : 'pending',
      dnsTarget: DOMAIN_CNAME_TARGET,
      verifiedAt: verified ? nowIso : config.verifiedAt ?? null,
      lastCheckedAt: nowIso,
      lastError: verified ? null : lastError,
    }

    await orgRef.set(
      { settings: { customDomain: next }, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )

    await logActivity({
      orgId,
      type: verified ? 'org_domain_verified' : 'org_domain_verify_failed',
      actorId: uid,
      actorName: uid,
      actorRole: role === 'admin' || role === 'owner' ? 'admin' : 'client',
      description: verified
        ? `Verified white-label domain ${config.customDomain} (SSL provisioning active)`
        : `Domain verification pending for ${config.customDomain}`,
      entityType: 'org_domain',
      entityId: orgId,
    })

    return apiSuccess({
      domain: next,
      verified,
      resolvedCnames: cnames,
      expectedTarget: DOMAIN_CNAME_TARGET,
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
