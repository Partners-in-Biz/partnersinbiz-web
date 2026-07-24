import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError } from '@/lib/api/response'
import { getConversation } from '@/lib/conversations/conversations'
import type { ApiUser } from '@/lib/api/types'
import { authorizeConversationProject, canAccessConversation } from '@/lib/conversations/access'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ convId: string }> }

/**
 * Phase 3/4 scaffold only: documents the eventual workbench terminal
 * contract (allowlisted read-only commands, conversation-scoped) without
 * shipping a new device PTY protocol. Every request — even an allowlisted
 * one — currently 501s, because there is no linked-runtime job type yet
 * that can execute a shell command and stream the result back here the way
 * project-sync inventory/upload jobs do. Once that protocol exists, this
 * route should enqueue a workbench job doc and return its id instead.
 */
const ALLOWLISTED_COMMANDS = new Set(['git status', 'git diff', 'git diff --stat', 'ls', 'pwd'])

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, ctx?: unknown) => {
  const { convId } = await (ctx as Params).params
  const conversation = await getConversation(convId)
  if (!conversation) return apiError('Conversation not found', 404)
  if (!canAccessConversation(user, conversation)) return apiError('Forbidden', 403)
  const projectAuthorization = await authorizeConversationProject(user, conversation)
  if (!projectAuthorization.ok) return apiError(projectAuthorization.error, projectAuthorization.status)

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const command = typeof body.command === 'string' ? body.command.trim() : ''
  if (!command) return apiError('command is required', 400)
  if (!ALLOWLISTED_COMMANDS.has(command)) {
    return apiError(
      `Command is not allowlisted for workbench terminal jobs. Allowed: ${Array.from(ALLOWLISTED_COMMANDS).join(', ')}`,
      400,
      { code: 'WORKBENCH_SHELL_COMMAND_NOT_ALLOWED' },
    )
  }

  return apiError(
    'Workbench shell jobs require linked-runtime ≥ pending protocol',
    501,
    { code: 'WORKBENCH_SHELL_PENDING' },
  )
})
