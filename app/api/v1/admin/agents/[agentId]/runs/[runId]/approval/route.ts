import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError } from '@/lib/api/response'
import { callAgentPath } from '@/lib/agents/team'
import { isValidAgentId, type AgentId } from '@/lib/agents/types'

const ALLOWED_CHOICES = ['once', 'session', 'always', 'deny'] as const
type ApprovalChoice = (typeof ALLOWED_CHOICES)[number]

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ agentId: string; runId: string }> }

export const POST = withAuth('admin', async (req: NextRequest, _user, ctx) => {
  const { agentId, runId } = await (ctx as Ctx).params
  if (!isValidAgentId(agentId)) return apiError('Invalid agentId', 400)

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON', 400)
  }

  const choice = String(body.choice ?? '').trim().toLowerCase()
  if (!ALLOWED_CHOICES.includes(choice as ApprovalChoice)) {
    return apiError('Invalid approval choice; expected one of: once, session, always, deny', 400)
  }

  const { response, data } = await callAgentPath(
    agentId as AgentId,
    `/v1/runs/${encodeURIComponent(runId)}/approval`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choice }),
    },
  )

  if (!response.ok) {
    return apiError(
      data && typeof data === 'object' && 'error' in data
        ? String((data as Record<string, unknown>).error)
        : 'Agent approval failed',
      response.status,
    )
  }

  return NextResponse.json(data)
})
