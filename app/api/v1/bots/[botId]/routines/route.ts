/**
 * GET /api/v1/bots/[botId]/routines?orgId=…
 *
 * Org-member readable list of routines for a bot: Hermes cron jobs + standing
 * goals from conversations where this bot is a participant.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { callAgentPath } from '@/lib/agents/team'
import { isValidAgentId, type AgentId } from '@/lib/agents/types'
import { adminDb } from '@/lib/firebase/admin'
import { clientCanAccessOrg } from '@/lib/llm-providers/org-guard'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ botId: string }> }

export type BotRoutineRow = {
  id: string
  name: string
  schedule?: string
  enabled: boolean
  source: 'cron' | 'goal'
  nextRunAt?: string | null
}

function mapCronJobs(jobs: unknown): BotRoutineRow[] {
  if (!Array.isArray(jobs)) return []
  return jobs.flatMap((job, index) => {
    if (!job || typeof job !== 'object') return []
    const row = job as Record<string, unknown>
    const name = typeof row.name === 'string'
      ? row.name
      : typeof row.title === 'string'
        ? row.title
        : typeof row.prompt === 'string'
          ? row.prompt
          : null
    if (!name) return []
    return [{
      id: typeof row.id === 'string' ? row.id : `cron-${index}`,
      name,
      schedule: typeof row.schedule === 'string'
        ? row.schedule
        : typeof row.cron === 'string'
          ? row.cron
          : undefined,
      enabled: row.enabled !== false && row.paused !== true,
      source: 'cron' as const,
      nextRunAt: typeof row.nextRunAt === 'string' ? row.nextRunAt : null,
    }]
  })
}

export const GET = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { botId } = await (ctx as Ctx).params
  if (!isValidAgentId(botId)) return apiError('Invalid botId', 400)

  const orgIdParam = req.nextUrl.searchParams.get('orgId')?.trim() || null
  const scope = resolveOrgScope(user, orgIdParam)
  if (!scope.ok) return apiError(scope.error, scope.status)
  if (!clientCanAccessOrg(user, scope.orgId)) return apiError('Forbidden', 403)

  const routines: BotRoutineRow[] = []
  const seen = new Set<string>()

  // Hermes cron (best-effort — may 404 on profiles without sidecar cron)
  try {
    const { response, data } = await callAgentPath(botId as AgentId, '/admin/cron')
    if (response.ok) {
      const jobs = Array.isArray(data) ? data : (data as Record<string, unknown>)?.jobs
      for (const row of mapCronJobs(jobs)) {
        if (seen.has(row.id)) continue
        seen.add(row.id)
        routines.push(row)
      }
    }
  } catch {
    // ignore — standing goals still useful
  }

  // Standing goals from conversations that include this bot
  try {
    const snap = await adminDb
      .collection('conversations')
      .where('orgId', '==', scope.orgId)
      .where('participantAgentIds', 'array-contains', botId)
      .limit(40)
      .get()

    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown>
      const goalState = data.goalState as Record<string, unknown> | null | undefined
      const goal = typeof goalState?.goal === 'string' ? goalState.goal.trim() : ''
      if (!goal) continue
      const status = typeof goalState?.status === 'string' ? goalState.status : 'active'
      if (status === 'cancelled' || status === 'completed') continue
      const id = `goal:${doc.id}`
      if (seen.has(id)) continue
      seen.add(id)
      routines.push({
        id,
        name: goal,
        schedule: 'Standing goal',
        enabled: status === 'active',
        source: 'goal',
        nextRunAt: null,
      })
    }
  } catch {
    // array-contains index may be missing in some envs — ignore
  }

  return apiSuccess({ routines, botId, orgId: scope.orgId })
})
