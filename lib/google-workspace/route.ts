import { NextRequest } from 'next/server'
import type { ApiUser } from '@/lib/api/types'
import { apiError } from '@/lib/api/response'
import { orgAccessError, resolveOrgId } from '@/lib/workspace-os/api'
import { asRecord, cleanString } from '@/lib/workspace-os/common'

export function resolveGoogleWorkspaceOrg(
  req: NextRequest,
  user: ApiUser,
  body?: Record<string, unknown>,
): { orgId: string; response?: never } | { orgId?: never; response: Response } {
  const resolved = resolveOrgId(req, user, body)
  const accessError = orgAccessError(user, resolved.orgId, resolved.mismatch, resolved)
 
  if (accessError) return { response: accessError }
  return { orgId: resolved.orgId! }
}

export async function readJsonBody(req: NextRequest): Promise<Record<string, unknown> | Response> {
  try {
    return asRecord(await req.json())
  } catch {
    return apiError('Invalid JSON', 400)
  }
}

export function requiredString(value: unknown, field: string): string | Response {
  const cleaned = cleanString(value)
  return cleaned ?? apiError(`${field} is required`, 400)
}

export function optionalString(value: unknown): string | null {
  return cleanString(value)
}

export function parsePageSize(value: unknown): number | undefined {
  const raw = typeof value === 'string' ? Number.parseInt(value, 10) : typeof value === 'number' ? value : undefined
  if (!Number.isFinite(raw)) return undefined
  return Math.min(Math.max(Math.trunc(raw as number), 1), 200)
}

export function parseBoolean(value: unknown): boolean | undefined {
  if (value === true || value === false) return value
  if (typeof value !== 'string') return undefined
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  return undefined
}

export function jsonContentBuffer(body: Record<string, unknown>): Buffer | Response {
  const base64 = cleanString(body.contentBase64)
  if (base64) return Buffer.from(base64, 'base64')
  if (typeof body.content === 'string') return Buffer.from(body.content)
  return apiError('content or contentBase64 is required', 400)
}

export function contentDispositionAttachment(name: string): string {
  const fallback = name.replace(/[^\w.\- ]+/g, '_').replace(/"/g, '_') || 'download'
  return `attachment; filename="${fallback}"`
}
