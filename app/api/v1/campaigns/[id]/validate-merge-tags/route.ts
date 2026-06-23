// app/api/v1/campaigns/[id]/validate-merge-tags/route.ts
//
// GET — pre-send merge-tag validation gate for a campaign.
//
// Returns which merge tags the campaign content uses lack a configured
// fallback (and any unknown {{tags}}). The review step (US-105) calls this
// before allowing a send, blocking when ok === false.
//
// Content source (in priority order):
//   1. ?subject= & ?html= query params (validate unsaved draft content)
//   2. otherwise the campaign's sequence step subjects + bodies
//
// Fallbacks come from the campaign doc's `mergeTagFallbacks` map.
//
// Auth: client.
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import type { Campaign } from '@/lib/campaigns/types'
import type { Sequence } from '@/lib/sequences/types'
import { validateMergeTags, type MergeTagFallbacks } from '@/lib/email/merge-tags'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  const snap = await adminDb.collection('campaigns').doc(id).get()
  if (!snap.exists || snap.data()?.deleted === true) return apiError('Campaign not found', 404)
  const data = snap.data()!
  const scope = resolveOrgScope(user, (data.orgId as string | undefined) ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const campaign = { id: snap.id, ...data } as Campaign & { mergeTagFallbacks?: MergeTagFallbacks }
  const fallbacks: MergeTagFallbacks = campaign.mergeTagFallbacks ?? {}

  const url = new URL(req.url)
  const qSubject = url.searchParams.get('subject')
  const qHtml = url.searchParams.get('html')

  let subject = ''
  let html = ''

  if (qSubject !== null || qHtml !== null) {
    subject = qSubject ?? ''
    html = qHtml ?? ''
  } else if (campaign.sequenceId) {
    const seqSnap = await adminDb.collection('sequences').doc(campaign.sequenceId).get()
    if (seqSnap.exists && !seqSnap.data()?.deleted) {
      const sequence = { id: seqSnap.id, ...seqSnap.data() } as Sequence
      const steps = Array.isArray(sequence.steps) ? sequence.steps : []
      subject = steps.map((s) => s.subject ?? '').join('\n')
      html = steps.map((s) => `${s.bodyHtml ?? ''}\n${s.bodyText ?? ''}`).join('\n')
    }
  }

  const result = validateMergeTags(html, subject, fallbacks)
  return apiSuccess({ campaignId: id, ...result, fallbacks })
})
