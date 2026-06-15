import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError } from '@/lib/api/response'
import { callAgentPath } from '@/lib/agents/team'
import { isValidAgentId, type AgentId } from '@/lib/agents/types'

const APPROVAL_CHOICES = ['once', 'session', 'always', 'deny'] as const
const GENERIC_ACTION_TYPES = new Set(['choose', 'retry', 'stop', 'open', 'copy', 'download', 'custom', 'model_picker', 'clarify'])

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ agentId: string; runId: string }> }

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function agentErrorMessage(data: unknown, fallback: string): string {
  const record = asRecord(data)
  if (!record) return fallback
  const direct = cleanString(record.error) ?? cleanString(record.message)
  if (direct) return direct
  const nested = asRecord(record.error)
  return cleanString(nested?.message) ?? cleanString(nested?.code) ?? fallback
}

function approvalChoice(type: string, value: unknown): (typeof APPROVAL_CHOICES)[number] | null {
  if (type === 'deny') return 'deny'
  if (type !== 'approve') return null
  const choice = cleanString(value)?.toLowerCase() ?? 'once'
  return APPROVAL_CHOICES.includes(choice as (typeof APPROVAL_CHOICES)[number])
    ? choice as (typeof APPROVAL_CHOICES)[number]
    : 'once'
}

export const POST = withAuth('admin', async (req: NextRequest, _user, ctx) => {
  const { agentId, runId } = await (ctx as Ctx).params
  if (!isValidAgentId(agentId)) return apiError('Invalid agentId', 400)

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON', 400)
  }

  const type = cleanString(body.type)?.toLowerCase()
  if (!type) return apiError('Action type is required', 400)

  const approval = approvalChoice(type, body.value)
  if (approval) {
    const { response, data } = await callAgentPath(
      agentId as AgentId,
      `/v1/runs/${encodeURIComponent(runId)}/approval`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice: approval }),
      },
    )
    if (!response.ok) return apiError(agentErrorMessage(data, 'Agent approval failed'), response.status)
    return NextResponse.json(data)
  }

  if (!GENERIC_ACTION_TYPES.has(type)) {
    return apiError('Unsupported action type', 400)
  }

  const actionId = cleanString(body.actionId) ?? cleanString(body.action_id) ?? cleanString(body.id)
  if (!actionId && type === 'choose') return apiError('actionId is required for choose actions', 400)

  const payload = asRecord(body.payload)
  const upstreamBody = {
    ...(actionId ? { action_id: actionId } : {}),
    type,
    ...(body.value !== undefined ? { value: body.value } : {}),
    ...(payload ? { payload } : {}),
  }

  const path = type === 'stop'
    ? `/v1/runs/${encodeURIComponent(runId)}/stop`
    : `/v1/runs/${encodeURIComponent(runId)}/actions`
  const { response, data } = await callAgentPath(
    agentId as AgentId,
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(upstreamBody),
    },
  )

  if (!response.ok) return apiError(agentErrorMessage(data, 'Agent action failed'), response.status)
  return NextResponse.json(data)
})
