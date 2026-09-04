/**
 * GET /api/v1/bots/[botId]/routines?orgId=…
 * POST /api/v1/bots/[botId]/routines — create PiB-owned routine
 *
 * GET merges Hermes cron + standing goals + bot_routines (source: 'routine').
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { callAgentPath } from '@/lib/agents/team'
import { isValidAgentId, type AgentId } from '@/lib/agents/types'
import { canAccessConversation } from '@/lib/conversations/access'
import type { Conversation } from '@/lib/conversations/types'
import { adminDb } from '@/lib/firebase/admin'
import { clientCanAccessOrg } from '@/lib/llm-providers/org-guard'
import {
  assertBotRoutinesEnabled,
  assertCanCreateRoutine,
  createRoutine,
  listRoutinesForAgent,
  RoutineAuthError,
  RoutineFlagDisabledError,
} from '@/lib/routines/service'
import type { RoutineAccessScope } from '@/lib/routines/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ botId: string }> }

export type BotRoutineRow = {
  id: string
  name: string
  schedule?: string
  enabled: boolean
  source: 'cron' | 'goal' | 'routine'
  nextRunAt?: string | null
  prompt?: string
  triggerKind?: 'schedule' | 'event'
  accessScope?: RoutineAccessScope
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
    // ignore
  }

  try {
    const snap = await adminDb
      .collection('conversations')
      .where('orgId', '==', scope.orgId)
      .where('participantAgentIds', 'array-contains', botId)
      .limit(40)
      .get()

    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown>
      const conversation = { id: doc.id, ...data } as Conversation
      if (!canAccessConversation(user, conversation)) continue
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
    // ignore
  }

  try {
    const owned = await listRoutinesForAgent(scope.orgId, botId)
    for (const row of owned) {
      if (seen.has(row.routineId)) continue
      if (row.accessScope === 'personal' && row.ownerUserId !== user.uid && user.role !== 'admin' && user.role !== 'ai') {
        continue
      }
      seen.add(row.routineId)
      const schedule = row.trigger.kind === 'schedule'
        ? row.trigger.cron
        : `event:${row.trigger.source}`
      routines.push({
        id: row.routineId,
        name: row.name,
        schedule,
        enabled: row.enabled,
        source: 'routine',
        nextRunAt: row.nextRunAt != null ? new Date(row.nextRunAt).toISOString() : null,
        prompt: row.prompt,
        triggerKind: row.triggerKind,
        accessScope: row.accessScope,
      })
    }
  } catch {
    // collection may be empty / missing index
  }

  return apiSuccess({ routines, botId, orgId: scope.orgId })
})

export const POST = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { botId } = await (ctx as Ctx).params
  if (!isValidAgentId(botId)) return apiError('Invalid botId', 400)

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return apiError('Malformed JSON body', 400)

  const orgIdParam = (typeof body.orgId === 'string' ? body.orgId : req.nextUrl.searchParams.get('orgId'))?.trim() || null
  const scope = resolveOrgScope(user, orgIdParam)
  if (!scope.ok) return apiError(scope.error, scope.status)
  if (!clientCanAccessOrg(user, scope.orgId)) return apiError('Forbidden', 403)

  const accessScope: RoutineAccessScope = body.accessScope === 'organization' ? 'organization' : 'personal'
  try {
    await assertBotRoutinesEnabled(scope.orgId)
    await assertCanCreateRoutine(user, scope.orgId, accessScope)
    const result = await createRoutine({
      orgId: scope.orgId,
      agentId: botId,
      ownerUserId: user.uid,
      accessScope,
      name: typeof body.name === 'string' ? body.name : '',
      prompt: typeof body.prompt === 'string' ? body.prompt : '',
      trigger: body.trigger,
      enabled: body.enabled !== false,
    })
    return apiSuccess({
      routine: result.routine,
      ...(result.hookSecret ? { hookSecret: result.hookSecret } : {}),
    }, 201)
  } catch (err) {
    if (err instanceof RoutineFlagDisabledError) return apiError('feature_disabled', 404)
    if (err instanceof RoutineAuthError) return apiError(err.message, err.status)
    return apiError(err instanceof Error ? err.message : String(err), 400)
  }
})
