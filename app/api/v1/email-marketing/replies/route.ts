import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { listReplyQueue } from '@/lib/email-marketing/reply-queue'
import type { SalesReplyClassification } from '@/lib/email-marketing/reply-classification'

export const dynamic = 'force-dynamic'
const CLASSIFICATIONS = new Set(['positive', 'negative', 'out_of_office', 'neutral'])
const SLA_STATES = new Set(['due', 'missed'])

export const GET = withAuth('client', withTenant(async (req: NextRequest, _user, orgId) => {
  try {
    const params = req.nextUrl.searchParams
    const classification = params.get('classification') || undefined
    const sla = params.get('sla') || undefined
    if (classification && !CLASSIFICATIONS.has(classification)) return apiError('Invalid classification filter', 400)
    if (sla && !SLA_STATES.has(sla)) return apiError('Invalid SLA filter', 400)
    const requestedLimit = Number(params.get('limit') || 50)
    const result = await listReplyQueue(orgId, {
      classification: classification as SalesReplyClassification | undefined,
      sla: sla as 'due' | 'missed' | undefined,
      ownerUserId: params.get('ownerUserId')?.trim() || undefined,
      queueId: params.get('queueId')?.trim() || undefined,
      cursor: params.get('cursor')?.trim() || null,
      limit: Math.max(1, Math.min(100, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 50)),
    })
    return apiSuccess(result)
  } catch (error) { return apiErrorFromException(error) }
}))
