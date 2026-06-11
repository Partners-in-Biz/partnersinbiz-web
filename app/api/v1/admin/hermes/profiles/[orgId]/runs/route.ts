import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { cleanAgentEffort, VALID_AGENT_EFFORTS } from '@/lib/agents/runRouting'
import { createHermesRun, requireHermesProfileAccess } from '@/lib/hermes/server'
import type { HermesRunRequest } from '@/lib/hermes/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ orgId: string }> }

export const POST = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { orgId } = await (ctx as RouteContext).params
  const access = await requireHermesProfileAccess(user, orgId, 'runs')
  if (access instanceof Response) return access

  const body = await req.json().catch(() => ({}))
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt) return apiError('prompt is required', 400)
  const rawEffort = body.reasoning_effort ?? body.agentEffort
  const reasoningEffort = cleanAgentEffort(rawEffort)
  if (rawEffort !== undefined && rawEffort !== null && rawEffort !== '' && !reasoningEffort) {
    return apiError(`Invalid reasoning_effort; expected one of ${VALID_AGENT_EFFORTS.join(' | ')}`, 400)
  }

  const runRequest: HermesRunRequest = {
    prompt,
    ...(typeof body.conversation_id === 'string' ? { conversation_id: body.conversation_id } : {}),
    ...(typeof body.model === 'string' ? { model: body.model } : {}),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    ...(typeof body.provider === 'string' ? { provider: body.provider } : {}),
    ...(typeof body.temperature === 'number' ? { temperature: body.temperature } : {}),
    ...(typeof body.max_tokens === 'number' ? { max_tokens: body.max_tokens } : {}),
    metadata: {
      ...(body.metadata && typeof body.metadata === 'object' ? body.metadata : {}),
      orgId,
      requestedBy: user.uid,
      source: 'partnersinbiz-web',
    },
  }

  const result = await createHermesRun(access.link, user.uid, runRequest)
  if (!result.response.ok) {
    return apiError('Hermes run request failed', result.response.status || 502, { hermes: result.data })
  }
  return apiSuccess({ hermes: result.data, runDocId: result.runDocId })
})
