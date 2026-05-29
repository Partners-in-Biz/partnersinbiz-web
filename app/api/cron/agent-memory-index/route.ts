import { NextRequest } from 'next/server'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { resolveKnowledgeAgent } from '@/lib/knowledge/agents'
import { reindexAgentMemory } from '@/lib/agent-memory/indexer'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorized(req: NextRequest) {
  const auth = req.headers.get('authorization')
  const vercelCron = req.headers.get('x-vercel-cron')
  return (Boolean(process.env.CRON_SECRET) && auth === `Bearer ${process.env.CRON_SECRET}`) || Boolean(vercelCron)
}

async function orgSlug(orgId: string) {
  const org = await adminDb.collection('organizations').doc(orgId).get()
  const slug = org.exists ? org.data()?.slug : null
  return typeof slug === 'string' && slug ? resolveKnowledgeAgent(slug) ?? slug : undefined
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return apiError('Unauthorized', 401)
  const body = await req.json().catch(() => ({})) as { orgId?: string; limit?: number; includeKnowledge?: boolean }
  if (!body.orgId) return apiError('orgId is required', 400)
  const agentSlug = await orgSlug(body.orgId)
  const summary = await reindexAgentMemory({
    orgId: body.orgId,
    agentSlug,
    includeKnowledge: body.includeKnowledge !== false,
    limit: typeof body.limit === 'number' ? body.limit : undefined,
  })
  return apiSuccess({ ...summary, orgId: body.orgId, agentSlug })
}
