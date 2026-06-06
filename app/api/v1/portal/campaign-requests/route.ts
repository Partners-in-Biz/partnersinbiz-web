import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

const CAMPAIGN_TYPES = new Set(['social', 'email', 'ads', 'seo-content', 'mixed'])

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => cleanString(item)).filter(Boolean)
}

function cleanDetails(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

export const POST = withPortalAuthAndRole('member', async (req: NextRequest, uid, orgId) => {
  const body = await req.json().catch(() => null)
  if (!body) return apiError('Invalid JSON', 400)

  const campaignType = cleanString(body.campaignType)
  const title = cleanString(body.title)
  const goal = cleanString(body.goal)
  const audience = cleanString(body.audience)
  const sourceCompanyId = cleanString(body.sourceCompanyId)
  const sourceCompanyName = cleanString(body.sourceCompanyName)

  if (!CAMPAIGN_TYPES.has(campaignType)) {
    return apiError('campaignType must be one of: social, email, ads, seo-content, mixed', 400)
  }
  if (!title) return apiError('title is required', 400)
  if (!goal) return apiError('goal is required', 400)
  if (!audience) return apiError('audience is required', 400)

  const doc = {
    orgId,
    requestedBy: uid,
    campaignType,
    title,
    goal,
    audience,
    offer: cleanString(body.offer),
    channels: cleanList(body.channels),
    launchWindow: cleanString(body.launchWindow),
    budget: cleanString(body.budget),
    assetsAvailable: cleanString(body.assetsAvailable),
    approvalContact: cleanString(body.approvalContact),
    successMetric: cleanString(body.successMetric),
    details: cleanDetails(body.details),
    notes: cleanString(body.notes),
    ...(sourceCompanyId ? { sourceCompanyId } : {}),
    ...(sourceCompanyName ? { sourceCompanyName } : {}),
    status: 'new',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    deleted: false,
  }

  const ref = await adminDb.collection('campaign_requests').add(doc)
  return apiSuccess({ id: ref.id, status: 'new' }, 201)
})
