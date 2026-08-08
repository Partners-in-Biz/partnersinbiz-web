import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { scanDesignFromUrl } from '@/lib/research/designContextScanner'
import { upsertDesignContext } from '@/lib/research/store'
import { assertUserCanPerformOrganizationModuleAction } from '@/lib/organizations/module-policy-access'

export const dynamic = 'force-dynamic'

/**
 * Live-site style scan — /impeccable document equivalent (gather path (b)).
 *
 * POST /api/v1/research/design-context/scan
 *   { orgId, companyId?, url, title? }
 *
 * Fetches a public client URL, extracts palette / type stack / component
 * classes / radius + elevation scales, then upserts a Design Context record
 * with source='style-scan'. SSRF-safe (private/local/metadata hosts rejected).
 */
export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError('Invalid JSON', 400)

  const requestedOrgId = typeof body.orgId === 'string' ? body.orgId.trim() : null
  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return apiError(scope.error, scope.status)
  const createAccess = await assertUserCanPerformOrganizationModuleAction(
    user,
    scope.orgId,
    'research',
    'create',
    'Design context creation is disabled for your organisation role',
  )
  if (!createAccess.ok) return apiError(createAccess.error, createAccess.status)

  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!url) return apiError('url is required', 400)
  const companyId = typeof body.companyId === 'string' && body.companyId.trim() ? body.companyId.trim() : null
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : undefined

  try {
    const scan = await scanDesignFromUrl(url)
    const payload = {
      audience: '',
      positioning: '',
      brandVoice: '',
      antiReferences: [],
      palette: scan.palette,
      typeStack: scan.typeStack,
      componentRules: scan.componentHints.map((hint) => `component .${hint.name} (${hint.count} uses)`),
      radiusScale: scan.radiusScale,
      elevationScale: scan.elevationScale,
      surfaceModes: [],
    }
    const result = await upsertDesignContext({
      orgId: scope.orgId,
      title,
      companyId,
      payload,
      source: 'style-scan',
      sourceUrl: scan.url,
      user,
    })
    return apiSuccess({ ...result, scan: { url: scan.url, title: scan.title, notes: scan.notes } }, result.created ? 201 : 200)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Style scan failed', 400)
  }
})
