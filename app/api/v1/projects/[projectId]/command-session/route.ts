/**
 * GET/POST/DELETE /api/v1/projects/[projectId]/command-session
 *
 * Bind a Messages conversation as the project's command session so Kanban
 * lifecycle events feed into that chat (and optionally auto-wake the lead agent).
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { getProjectForUser } from '@/lib/projects/access'
import { canProjectRole } from '@/lib/projects/collaboration'
import {
  bindProjectCommandSession,
  normalizeCommandSession,
  unbindProjectCommandSession,
  type ProjectCommandAutoWakeOn,
} from '@/lib/projects/commandSession'
import type { AgentId } from '@/lib/agents/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string }> }

const AUTO_WAKE_VALUES = new Set<ProjectCommandAutoWakeOn>([
  'blocked',
  'awaiting_input',
  'done',
  'started',
  'failed',
])

export const GET = withAuth('client', async (_req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const access = await getProjectForUser(projectId, user)
  if (!access.ok) return apiError(access.error, access.status)
  const project = access.doc.data() ?? {}
  return apiSuccess({
    projectId,
    commandSession: normalizeCommandSession(project.commandSession),
  })
})

export const POST = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const access = await getProjectForUser(projectId, user)
  if (!access.ok) return apiError(access.error, access.status)
  if (!canProjectRole(access.projectAccess?.role ?? 'viewer', 'manage_project')) {
    return apiError('Project manager access is required to bind the command session', 403)
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON body', 400)
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : ''
  if (!conversationId) return apiError('conversationId is required', 400)

  const orgId = String(access.doc.data()?.orgId ?? user.activeOrgId ?? user.orgId ?? '').trim()
  if (!orgId) return apiError('Organisation is required', 400)

  const autoWakeOn = Array.isArray(body.autoWakeOn)
    ? body.autoWakeOn.filter((item: unknown): item is ProjectCommandAutoWakeOn => (
      typeof item === 'string' && AUTO_WAKE_VALUES.has(item as ProjectCommandAutoWakeOn)
    ))
    : undefined

  try {
    const binding = await bindProjectCommandSession({
      projectId,
      conversationId,
      orgId,
      boundBy: user.uid,
      autoWake: body.autoWake !== false,
      autoWakeAgentId: (typeof body.autoWakeAgentId === 'string' && body.autoWakeAgentId.trim()
        ? body.autoWakeAgentId.trim()
        : 'pip') as AgentId,
      autoWakeOn,
    })
    return apiSuccess({ projectId, commandSession: binding })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to bind command session'
    const status = /not found/i.test(message) ? 404 : /must be scoped|mismatch/i.test(message) ? 400 : 500
    return apiError(message, status)
  }
})

export const DELETE = withAuth('client', async (_req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const access = await getProjectForUser(projectId, user)
  if (!access.ok) return apiError(access.error, access.status)
  if (!canProjectRole(access.projectAccess?.role ?? 'viewer', 'manage_project')) {
    return apiError('Project manager access is required to unbind the command session', 403)
  }
  try {
    await unbindProjectCommandSession({ projectId, unboundBy: user.uid })
    return apiSuccess({ projectId, commandSession: null })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to unbind command session'
    return apiError(message, /not found/i.test(message) ? 404 : 500)
  }
})

