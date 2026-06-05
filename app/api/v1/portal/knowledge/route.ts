import { NextRequest } from 'next/server'
import { withPortalAuth } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiSuccess } from '@/lib/api/response'
import { callAgentPath } from '@/lib/agents/team'
import { resolveKnowledgeAgent } from '@/lib/knowledge/agents'
import { canUsePortalOrg } from '@/lib/portal/org-access'
import type { KnowledgeSection } from '@/lib/knowledge/types'

export const dynamic = 'force-dynamic'

const KNOWLEDGE_AGENT = 'pip'

function readSection(searchParams: URLSearchParams): KnowledgeSection {
  const section = searchParams.get('section')
  return section === 'wiki' || section === 'logs' ? section : 'wiki'
}

function appendQuery(path: string, params: Record<string, string | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value)
  }
  const qs = search.toString()
  return qs ? `${path}?${qs}` : path
}

type ResolvedKnowledgeOrg =
  | { ok: true; slug: string }
  | { ok: false; status: number; error: string }

async function resolveActiveOrgSlug(req: NextRequest, uid: string): Promise<ResolvedKnowledgeOrg> {
  const userDoc = await adminDb.collection('users').doc(uid).get()
  if (!userDoc.exists) return { ok: false, status: 404, error: 'No active client wiki is linked to this account' }
  const user = userDoc.data() ?? {}
  const requestedOrgId = req.nextUrl.searchParams.get('orgId')?.trim() ?? ''
  const orgId = requestedOrgId || (
    typeof user.activeOrgId === 'string'
      ? user.activeOrgId
      : typeof user.orgId === 'string'
        ? user.orgId
        : ''
  )
  if (!orgId) return { ok: false, status: 404, error: 'No active client wiki is linked to this account' }

  if (requestedOrgId) {
    const allowed = await canUsePortalOrg(uid, user, requestedOrgId)
    if (!allowed) return { ok: false, status: 403, error: 'You do not have access to this organisation' }
  }

  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgDoc.exists) return { ok: false, status: 404, error: 'No active client wiki is linked to this account' }
  const org = orgDoc.data() ?? {}
  const slug = typeof org.slug === 'string' && org.slug ? org.slug : ''
  if (!slug) return { ok: false, status: 404, error: 'No active client wiki is linked to this account' }
  return { ok: true, slug }
}

export const GET = withPortalAuth(async (req: NextRequest, uid: string) => {
  const section = readSection(req.nextUrl.searchParams)
  const path = req.nextUrl.searchParams.get('path')?.trim() || undefined
  const resolved = await resolveActiveOrgSlug(req, uid)
  if (!resolved.ok) return apiError(resolved.error, resolved.status)
  const agent = resolveKnowledgeAgent(resolved.slug)

  try {
    const upstream = await callAgentPath(KNOWLEDGE_AGENT, appendQuery('/admin/knowledge', {
      scope: 'agent',
      section,
      agent,
      path,
    }))
    if (!upstream.response.ok) {
      const message = upstream.response.status === 404
        ? 'Knowledge note not found'
        : 'Knowledge backend is not available'
      return apiError(message, upstream.response.status, { upstream: upstream.data })
    }
    return apiSuccess({ ...(upstream.data as Record<string, unknown>), requestedAgent: resolved.slug })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to reach knowledge backend', 502)
  }
})
