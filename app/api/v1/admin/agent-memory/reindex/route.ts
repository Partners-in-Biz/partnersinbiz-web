import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'
import { resolveKnowledgeAgent } from '@/lib/knowledge/agents'
import { reindexAgentMemory } from '@/lib/agent-memory/indexer'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function resolveAgentSlug(orgId: string, provided?: unknown) {
  if (typeof provided === 'string' && provided.trim()) return resolveKnowledgeAgent(provided.trim()) ?? provided.trim()
  const org = await adminDb.collection('organizations').doc(orgId).get()
  const slug = org.exists ? org.data()?.slug : null
  return typeof slug === 'string' && slug ? resolveKnowledgeAgent(slug) ?? slug : undefined
}

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  if (user.role !== 'admin') return apiError('Only admins can reindex agent memory', 403)
  const body = await req.json().catch(() => null) as {
    orgId?: string
    agentSlug?: string
    sourceTypes?: string[]
    includeKnowledge?: boolean
    limit?: number
  } | null
  if (!body?.orgId) return apiError('orgId is required', 400)
  if (!canAccessOrg(user, body.orgId)) return apiError('Forbidden', 403)

  const agentSlug = await resolveAgentSlug(body.orgId, body.agentSlug)
  const summary = await reindexAgentMemory({
    orgId: body.orgId,
    agentSlug,
    sourceTypes: Array.isArray(body.sourceTypes) ? body.sourceTypes : undefined,
    includeKnowledge: body.includeKnowledge !== false,
    limit: typeof body.limit === 'number' ? body.limit : undefined,
  })

  return apiSuccess({ ...summary, orgId: body.orgId, agentSlug })
})
