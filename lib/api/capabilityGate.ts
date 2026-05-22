import type { NextRequest } from 'next/server'
import type { NextResponse } from 'next/server'
import { apiError } from '@/lib/api/response'
import type { ApiResponse } from '@/lib/api/types'
import type { ApiUser } from '@/lib/api/types'
import {
  AgentCapabilityError,
  assertAgentCapabilityForApiUser,
  type AgentCapability,
  type CapabilityContext,
} from '@/lib/agents/capabilities'

function readString(source: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = source?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function capabilityContextFromRequest(
  req: NextRequest,
  body?: Record<string, unknown> | null,
): CapabilityContext {
  return {
    approvalStatus: readString(body, 'approvalStatus') ?? req.headers.get('X-Approval-Status'),
    approvalGateTaskId: readString(body, 'approvalGateTaskId') ?? req.headers.get('X-Approval-Gate-Task-Id'),
  }
}

export function enforceAgentCapability(
  user: Pick<ApiUser, 'uid' | 'role' | 'authKind' | 'agentId'>,
  capability: AgentCapability,
  req: NextRequest,
  body?: Record<string, unknown> | null,
): NextResponse<ApiResponse<never>> | null {
  try {
    assertAgentCapabilityForApiUser(user, capability, capabilityContextFromRequest(req, body))
    return null
  } catch (err) {
    if (err instanceof AgentCapabilityError) return apiError(err.message, err.status)
    throw err
  }
}
