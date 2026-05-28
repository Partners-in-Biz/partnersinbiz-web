import { withAuth } from '@/lib/api/auth'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { loadCompany } from '@/lib/companies/store'
import { buildCompanyCommandCenter } from '@/lib/companies/command-center'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

async function resolveOrgId(req: Request): Promise<{ ok: true; orgId: string } | { ok: false; response: Response }> {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim()
  if (orgId) return { ok: true, orgId }

  const orgSlug = url.searchParams.get('orgSlug')?.trim()
  if (!orgSlug) return { ok: false, response: apiError('orgId or orgSlug is required', 400) }

  const snap = await adminDb
    .collection('organizations')
    .where('slug', '==', orgSlug)
    .limit(1)
    .get()
  const doc = snap.docs[0]
  if (!doc) return { ok: false, response: apiError('Organization not found', 404) }
  return { ok: true, orgId: doc.id }
}

export const GET = withAuth('admin', async (req, user, routeCtx: RouteCtx | undefined) => {
  const { id } = await routeCtx!.params
  const resolved = await resolveOrgId(req)
  if (!resolved.ok) return resolved.response
  if (!canAccessOrg(user, resolved.orgId)) return apiError('Forbidden', 403)

  const loaded = await loadCompany(id, resolved.orgId)
  if (!loaded) return apiError('Company not found', 404)

  const limit = Number(new URL(req.url).searchParams.get('limit') ?? 50)
  const commandCenter = await buildCompanyCommandCenter(loaded.data, { limit })
  return apiSuccess(commandCenter)
})
