// app/api/v1/admin/domains/route.ts
//
// Admin white-label domain management (US-279).
//
//   GET    -> list custom-domain inventory scoped to the admin's orgs.
//   POST   -> perform an action on a single org's domain:
//               { orgId, action: 'verify' }        real DNS CNAME lookup
//               { orgId, action: 'provision-ssl' }  mark SSL active (post-verify)
//   DELETE -> revoke a custom domain (clears config, drops verification + SSL).
//
// All mutations enforce org access scope and write an admin audit record.

import { resolveCname } from 'dns/promises'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { writeAdminAudit } from '@/lib/admin/audit'
import { DOMAIN_CNAME_TARGET, loadDomains, loadDomainForOrg, type SslStatus } from './data'

export const dynamic = 'force-dynamic'

const NOT_YET_VERIFIED_CODES = new Set(['ENOTFOUND', 'ENODATA', 'SERVFAIL', 'NOTFOUND', 'NXDOMAIN'])

function dnsErrorCode(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code
    return typeof code === 'string' ? code : null
  }
  return null
}

export const GET = withAuth('admin', async (_req, user) => {
  try {
    return apiSuccess(await loadDomains(user))
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const POST = withAuth('admin', async (req, user) => {
  let body: { orgId?: unknown; action?: unknown }
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  const action = typeof body.action === 'string' ? body.action.trim() : ''
  if (!orgId) return apiError('orgId is required', 400)
  if (action !== 'verify' && action !== 'provision-ssl') {
    return apiError("action must be 'verify' or 'provision-ssl'", 400)
  }

  const loaded = await loadDomainForOrg(user, orgId)
  if (!loaded.ok) {
    if (loaded.reason === 'not_found') return apiError('Organisation not found', 404)
    return apiError('You do not have access to this organisation', 403)
  }
  const current = loaded.row

  if (!current.customDomain) {
    return apiError('This organisation has no custom domain to manage', 400)
  }

  const orgRef = adminDb.collection('organizations').doc(orgId)
  const nowIso = new Date().toISOString()

  try {
    if (action === 'verify') {
      let verified = false
      let cnames: string[] = []
      let lastError: string | null = null

      try {
        cnames = await resolveCname(current.customDomain)
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
          return apiError(`DNS lookup failed: ${err instanceof Error ? err.message : String(err)}`, 502)
        }
      }

      const nextSsl: SslStatus = verified ? 'active' : current.sslStatus === 'failed' ? 'failed' : 'pending'
      const next = {
        subdomain: current.subdomain,
        customDomain: current.customDomain,
        verified,
        sslStatus: nextSsl,
        dnsTarget: DOMAIN_CNAME_TARGET,
        verifiedAt: verified ? nowIso : current.verifiedAt,
        lastCheckedAt: nowIso,
        lastError: verified ? null : lastError,
      }

      await orgRef.set(
        { settings: { customDomain: next }, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      )

      await writeAdminAudit(user, {
        action: verified ? 'domain.verify_success' : 'domain.verify_pending',
        orgId,
        summary: verified
          ? `Verified white-label domain ${current.customDomain} for ${current.orgName}`
          : `Domain verification still pending for ${current.customDomain} (${current.orgName})`,
        metadata: {
          customDomain: current.customDomain,
          resolvedCnames: cnames,
          expectedTarget: DOMAIN_CNAME_TARGET,
          verified,
        },
      })

      return apiSuccess({
        orgId,
        action,
        verified,
        resolvedCnames: cnames,
        expectedTarget: DOMAIN_CNAME_TARGET,
        domain: next,
      })
    }

    // action === 'provision-ssl'
    if (!current.verified) {
      return apiError('Domain must be DNS-verified before SSL can be provisioned', 409)
    }

    const next = {
      subdomain: current.subdomain,
      customDomain: current.customDomain,
      verified: true,
      sslStatus: 'active' as SslStatus,
      dnsTarget: DOMAIN_CNAME_TARGET,
      verifiedAt: current.verifiedAt ?? nowIso,
      lastCheckedAt: nowIso,
      lastError: null,
    }

    await orgRef.set(
      { settings: { customDomain: next }, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )

    await writeAdminAudit(user, {
      action: 'domain.provision_ssl',
      orgId,
      summary: `Provisioned SSL for ${current.customDomain} (${current.orgName})`,
      metadata: { customDomain: current.customDomain },
    })

    return apiSuccess({ orgId, action, domain: next })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const DELETE = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  let orgId = url.searchParams.get('orgId')?.trim() ?? ''
  if (!orgId) {
    try {
      const body = (await req.json()) as { orgId?: unknown }
      if (typeof body.orgId === 'string') orgId = body.orgId.trim()
    } catch {
      // body optional when orgId is in the query string
    }
  }
  if (!orgId) return apiError('orgId is required', 400)

  const loaded = await loadDomainForOrg(user, orgId)
  if (!loaded.ok) {
    if (loaded.reason === 'not_found') return apiError('Organisation not found', 404)
    return apiError('You do not have access to this organisation', 403)
  }
  const current = loaded.row

  if (!current.customDomain && !current.subdomain) {
    return apiError('This organisation has no domain configuration to revoke', 400)
  }

  const orgRef = adminDb.collection('organizations').doc(orgId)
  const revoked = {
    subdomain: '',
    customDomain: '',
    verified: false,
    sslStatus: 'pending' as SslStatus,
    dnsTarget: DOMAIN_CNAME_TARGET,
    verifiedAt: null,
    lastCheckedAt: new Date().toISOString(),
    lastError: null,
  }

  try {
    await orgRef.set(
      { settings: { customDomain: revoked }, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )

    await writeAdminAudit(user, {
      action: 'domain.revoke',
      orgId,
      summary: `Revoked white-label domain ${current.customDomain || current.portalAlias} for ${current.orgName}`,
      metadata: {
        previousCustomDomain: current.customDomain,
        previousSubdomain: current.subdomain,
        previousSslStatus: current.sslStatus,
      },
    })

    return apiSuccess({ orgId, revoked: true, domain: revoked })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
