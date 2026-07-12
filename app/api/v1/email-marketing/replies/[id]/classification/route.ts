import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { correctReplyClassification } from '@/lib/email-marketing/reply-queue'
import type { SalesReplyClassification } from '@/lib/email-marketing/reply-classification'

const CLASSIFICATIONS = new Set(['positive', 'negative', 'out_of_office', 'neutral'])

export const PATCH = withAuth('client', withTenant(async (req: NextRequest, user, orgId, context) => {
  try {
    const params = context?.params as Promise<{ id: string }> | undefined
    const { id } = await (params ?? Promise.resolve({ id: '' }))
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const classification = typeof body.classification === 'string' ? body.classification : ''
    if (!CLASSIFICATIONS.has(classification)) return apiError('Invalid classification', 400)
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
    const reply = await correctReplyClassification(orgId, id, classification as SalesReplyClassification, user.uid, reason)
    return reply ? apiSuccess({ reply }) : apiError('Reply not found', 404)
  } catch (error) { return apiErrorFromException(error) }
}))
