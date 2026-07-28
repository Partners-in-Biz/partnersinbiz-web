import crypto from 'node:crypto'
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { mapTerminalCommandToOperation } from '@/lib/messages/workbench/browser-client'
import { authorizeWorkbenchConversation, WorkbenchAuthorizationError } from '@/lib/messages/workbench/authorization'
import { enqueueWorkbenchJob, type EnqueueWorkbenchJobInput } from '@/lib/messages/workbench/job-store'
import { publicWorkbenchJob } from '@/lib/messages/workbench/jobs'
import { getTerminalPolicy } from '@/lib/messages/workbench/terminal-policy'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ convId: string }> }
type RouteAuthorization = Awaited<ReturnType<typeof authorizeWorkbenchConversation>>
interface TerminalDependencies {
  authorize: (user: ApiUser, conversationId: string) => Promise<RouteAuthorization>
  enqueue: (input: EnqueueWorkbenchJobInput) => Promise<Awaited<ReturnType<typeof enqueueWorkbenchJob>>>
}

/**
 * Phase 2b/3 MVP: allowlisted terminal commands the Messages workbench
 * terminal can run against a conversation's linked-computer workspace.
 * `git status` / `git diff` / `ls` map (via `mapTerminalCommandToOperation`)
 * onto typed FS/git workbench operations; every other allowlisted command
 * falls back to a one-shot `shell.exec` job with an exact-match argv
 * template — there is still no free-form PTY protocol. `pwd` is
 * special-cased below because it only needs the server-known relative
 * folder, not a device round trip.
 */
const TYPED_TERMINAL_COMMANDS = ['git status', 'git diff', 'git diff --stat', 'ls', 'pwd']

function routeError(error: unknown) {
  if (error instanceof WorkbenchAuthorizationError) return apiError(error.message, error.status)
  const message = error instanceof Error ? error.message : ''
  if (message.includes('queue full')) return apiError('Computer workbench queue is full', 429)
  console.error('[workbench-terminal-failed]', error)
  return apiError('Unable to run workbench terminal command', 500)
}

export async function handleWorkbenchTerminalCommand(
  request: NextRequest,
  user: ApiUser,
  conversationId: string,
  dependencies: TerminalDependencies = { authorize: authorizeWorkbenchConversation, enqueue: enqueueWorkbenchJob },
): Promise<Response> {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const command = typeof body.command === 'string' ? body.command.trim() : ''
  if (!command) return apiError('command is required', 400)

  try {
    if (command === 'pwd') {
      const authorization = await dependencies.authorize(user, conversationId)
      return apiSuccess({ cwd: authorization.relativeFolder })
    }

    const authorization = await dependencies.authorize(user, conversationId)
    const policy = await getTerminalPolicy(authorization.conversation.orgId)
    const operation = mapTerminalCommandToOperation(command, policy.allowedShellArgv)
    if (!operation) {
      return apiError(
        `Command is not allowlisted for workbench terminal jobs. Allowed: ${[...TYPED_TERMINAL_COMMANDS, ...policy.allowedShellArgv.map((argv) => argv.join(' '))].join(', ')}`,
        400,
        { code: 'WORKBENCH_SHELL_COMMAND_NOT_ALLOWED' },
      )
    }

    if (user.role !== 'admin' && user.role !== 'client') return apiError('Forbidden', 403)
    const job = await dependencies.enqueue({
      idempotencyKey: `terminal-${crypto.randomUUID()}`,
      conversationId: authorization.conversation.id,
      orgId: authorization.conversation.orgId,
      actorUserId: user.uid,
      actorRole: user.role,
      deviceId: authorization.binding.deviceId,
      runtimeTargetId: authorization.binding.runtimeTargetId,
      credentialVersion: authorization.binding.credentialVersion,
      workspaceId: authorization.binding.workspaceId,
      mappingId: authorization.binding.mappingId,
      ...(authorization.projectId ? { projectId: authorization.projectId } : {}),
      ...(authorization.projectReplicaId ? { projectReplicaId: authorization.projectReplicaId } : {}),
      relativeFolder: authorization.relativeFolder,
      kind: operation.kind,
      operation: operation.kind === 'shell.exec' ? { ...operation, allowedShellArgv: policy.allowedShellArgv } : operation,
    })
    return apiSuccess(publicWorkbenchJob(job), 202)
  } catch (error) {
    return routeError(error)
  }
}

export const POST = withAuth('client', async (request: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId } = await (context as Context).params
  return handleWorkbenchTerminalCommand(request, user, convId)
})
