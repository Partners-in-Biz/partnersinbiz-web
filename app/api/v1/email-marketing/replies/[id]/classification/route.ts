import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { correctReplyClassification } from '@/lib/email-marketing/reply-queue'
import type { SalesReplyClassification } from '@/lib/email-marketing/reply-classification'
import { createHash } from 'node:crypto'

const CLASSIFICATIONS = new Set(['positive', 'negative', 'out_of_office', 'neutral'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return isRecord(value) && typeof value.then === 'function'
}

async function routeIdFromContext(context?: Record<string, unknown>): Promise<string> {
  const params = context?.params
  if (!isPromiseLike(params)) return ''
  const resolved = await params
  return isRecord(resolved) && typeof resolved.id === 'string' ? resolved.id : ''
}

export const PATCH = withAuth('client', withTenant(async (req: NextRequest, user, orgId, context) => {
  try {
    const id = await routeIdFromContext(context)
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const classification = typeof body.classification === 'string' ? body.classification : ''
    if (!CLASSIFICATIONS.has(classification)) return apiError('Invalid classification', 400)
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
    const suppliedKey = req.headers.get('idempotency-key')?.trim().slice(0, 200)
    const idempotencyKey = suppliedKey || createHash('sha256').update(`${id}:${classification}:${user.uid}:${reason}`).digest('hex')
    const reply = await correctReplyClassification(orgId, id, classification as SalesReplyClassification, user.uid, reason, idempotencyKey)
    return reply ? apiSuccess({ reply }) : apiError('Reply not found', 404)
  } catch (error) { return apiErrorFromException(error) }
}))
