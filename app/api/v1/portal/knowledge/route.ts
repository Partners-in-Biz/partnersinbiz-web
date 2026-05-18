import { NextRequest } from 'next/server'
import { withPortalAuth } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiSuccess } from '@/lib/api/response'
import { callAgentPath } from '@/lib/agents/team'
import { resolveKnowledgeAgent } from '@/lib/knowledge/agents'
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

async function resolveActiveOrgSlug(uid: string) {
  const userDoc = await adminDb.collection('users').doc(uid).get()
  if (!userDoc.exists) return null
  const user = userDoc.data() ?? {}
  const orgId = typeof user.activeOrgId === 'string'
    ? user.activeOrgId
    : typeof user.orgId === 'string'
      ? user.orgId
      : ''
  if (!orgId) return null

  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgDoc.exists) return null
  const org = orgDoc.data() ?? {}
  return typeof org.slug === 'string' && org.slug ? org.slug : null
}

export const GET = withPortalAuth(async (req: NextRequest, uid: string) => {
  const section = readSection(req.nextUrl.searchParams)
  const path = req.nextUrl.searchParams.get('path')?.trim() || undefined
  const slug = await resolveActiveOrgSlug(uid)
  if (!slug) return apiError('No active client wiki is linked to this account', 404)
  const agent = resolveKnowledgeAgent(slug)

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
    return apiSuccess({ ...(upstream.data as Record<string, unknown>), requestedAgent: slug })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to reach knowledge backend', 502)
  }
})
