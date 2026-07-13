import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiError, apiSuccess } from '@/lib/api/response'
import { getSenderPolicy, normalizeSenderPolicy } from '@/lib/email-marketing/sender-store'
import { resolveSenderForRecipient } from '@/lib/email-marketing/sender-resolution'
import type { EmailSenderPolicy, SenderPreviewSummary, SenderRecipientContext } from '@/lib/email-marketing/sender-types'

export const dynamic = 'force-dynamic'

function increment(target: Record<string, number>, key: string | null | undefined): void {
  if (key) target[key] = (target[key] ?? 0) + 1
}

export const POST = withAuth('client', withTenant(async (req: NextRequest, user, orgId) => {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const recipients = Array.isArray(body.recipients) ? body.recipients : []
  if (recipients.length === 0) return apiError('recipients is required', 400)
  if (recipients.length > 10_000) return apiError('Preview supports at most 10000 recipients', 400)

  let policy: EmailSenderPolicy | null = null
  const policyId = typeof body.policyId === 'string' ? body.policyId.trim() : ''
  if (policyId) policy = await getSenderPolicy(orgId, policyId)
  if (!policy && body.policy && typeof body.policy === 'object') {
    const draft = body.policy as Record<string, unknown>
    const normalized = normalizeSenderPolicy({
      name: 'Preview policy',
      noOwnerBehavior: 'exclude',
      connectedMailboxMaxRecipients: 1,
      enabled: true,
      ...draft,
    }, orgId)
    policy = { ...normalized, id: typeof draft.id === 'string' ? draft.id : 'preview', createdAt: null, updatedAt: null }
  }
  if (!policy) return apiError('A valid policy or policyId is required', 400)

  const summary: SenderPreviewSummary = {
    total: recipients.length,
    resolved: 0,
    excluded: 0,
    blocked: 0,
    byIdentity: {},
    byOwner: {},
    byReason: {},
    fallbackReasons: {},
    results: [],
  }

  for (const rawRecipient of recipients) {
    const source = rawRecipient && typeof rawRecipient === 'object' ? rawRecipient as Record<string, unknown> : {}
    const contactId = typeof source.contactId === 'string' ? source.contactId.trim() : ''
    if (!contactId) return apiError('Every recipient requires contactId', 400)
    const recipient: SenderRecipientContext = {
      contactId,
      contactOwnerUid: typeof source.contactOwnerUid === 'string' ? source.contactOwnerUid : null,
      companyId: typeof source.companyId === 'string' ? source.companyId : null,
      companyAccountManagerUid: typeof source.companyAccountManagerUid === 'string' ? source.companyAccountManagerUid : null,
      dealId: typeof source.dealId === 'string' ? source.dealId : null,
      dealOwnerUid: typeof source.dealOwnerUid === 'string' ? source.dealOwnerUid : null,
    }
    const resolution = await resolveSenderForRecipient({
      orgId,
      actorUid: user.uid,
      campaignCreatorUid: typeof body.campaignCreatorUid === 'string' ? body.campaignCreatorUid : user.uid,
      policy,
      recipient,
      batchSize: recipients.length,
    })
    summary[resolution.status] += 1
    increment(summary.byIdentity, resolution.identity?.id)
    increment(summary.byOwner, resolution.ownerUid ?? 'unassigned')
    increment(summary.byReason, resolution.reason)
    increment(summary.fallbackReasons, resolution.fallbackReason)
    summary.results.push({ contactId, resolution })
  }

  return apiSuccess(summary)
}))
