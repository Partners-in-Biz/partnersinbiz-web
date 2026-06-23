/**
 * POST /api/v1/email/campaigns/[id]/spam-check
 * GET  /api/v1/email/campaigns/[id]/spam-check
 *
 * Runs a deterministic, SpamAssassin-style spam-likelihood analysis on a
 * campaign's email content and returns a 0–10 score (higher = spammier), a
 * verdict, and the full list of triggered rules with per-rule weights.
 *
 * Content resolution order:
 *   1. POST body { html, subject, text? } — live editor / review-step content.
 *      (Lets US-105's review step pass exactly what's on screen, even unsaved.)
 *   2. Campaign `document` / `doc` (an EmailDocument) — rendered to HTML+text.
 *   3. The campaign's linked sequence, first step's subject + bodyHtml.
 *
 * Auth: client (admin/ai satisfy too). Org-scoped via resolveOrgScope against
 * the campaign's own orgId, so a client can only spam-check their own campaigns.
 *
 * Response: apiSuccess({ score, verdict, rules, source, scannedAt })
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { renderEmail } from '@/lib/email-builder/render'
import type { EmailDocument } from '@/lib/email-builder/types'
import { scoreSpam, type SpamScoreInput } from '@/lib/email/spam-score'
import type { ApiUser } from '@/lib/api/types'

type Params = { params: Promise<{ id: string }> }

interface ResolvedContent {
  subject: string
  html: string
  text: string
  source: 'request-body' | 'campaign-document' | 'sequence-step'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asEmailDocument(value: any): EmailDocument | null {
  if (!value || typeof value !== 'object') return null
  if (!Array.isArray(value.blocks) || !value.theme) return null
  return value as EmailDocument
}

/**
 * Resolve the email content to analyse. Tries the request body first (live
 * editor content), then the campaign's stored EmailDocument, then the linked
 * sequence's first step.
 */
async function resolveContent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  campaign: any,
  body: { html?: unknown; subject?: unknown; text?: unknown } | null,
): Promise<ResolvedContent | null> {
  // 1. Request-body fallback (live editor / review step).
  if (body && typeof body.html === 'string' && body.html.trim()) {
    return {
      subject: typeof body.subject === 'string' ? body.subject : '',
      html: body.html,
      text: typeof body.text === 'string' ? body.text : '',
      source: 'request-body',
    }
  }

  // 2. Campaign stores an EmailDocument under `document` or `doc`.
  const doc = asEmailDocument(campaign.document ?? campaign.doc)
  if (doc) {
    const rendered = renderEmail(doc)
    return {
      subject: doc.subject ?? '',
      html: rendered.html,
      text: rendered.text,
      source: 'campaign-document',
    }
  }

  // 3. Linked sequence, first step.
  const sequenceId: string = typeof campaign.sequenceId === 'string' ? campaign.sequenceId : ''
  if (sequenceId) {
    const seqSnap = await adminDb.collection('sequences').doc(sequenceId).get()
    if (seqSnap.exists && !seqSnap.data()?.deleted) {
      const steps = seqSnap.data()?.steps
      if (Array.isArray(steps) && steps.length > 0) {
        // First email step (skip SMS steps).
        const step =
          steps.find((s) => (s?.channel ?? 'email') === 'email' && (s?.bodyHtml || s?.subject)) ?? steps[0]
        return {
          subject: typeof step?.subject === 'string' ? step.subject : '',
          html: typeof step?.bodyHtml === 'string' ? step.bodyHtml : '',
          text: typeof step?.bodyText === 'string' ? step.bodyText : '',
          source: 'sequence-step',
        }
      }
    }
  }

  return null
}

async function handle(req: NextRequest, user: ApiUser, context?: unknown): Promise<Response> {
  const { id } = await (context as Params).params

  const snap = await adminDb.collection('campaigns').doc(id).get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Campaign not found', 404)

  const campaign = snap.data() ?? {}
  const scope = resolveOrgScope(user, (campaign.orgId as string | undefined) ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  // POST may carry live editor content; GET never has a body.
  let body: { html?: unknown; subject?: unknown; text?: unknown } | null = null
  if (req.method === 'POST') {
    try {
      body = (await req.json()) as { html?: unknown; subject?: unknown; text?: unknown }
    } catch {
      body = null
    }
  }

  const content = await resolveContent(campaign, body)
  if (!content) {
    return apiError(
      'No email content to analyse. The campaign has no email document or sequence step; pass { html, subject } in the request body.',
      422,
    )
  }

  const input: SpamScoreInput = {
    subject: content.subject,
    html: content.html,
    text: content.text,
  }
  const result = scoreSpam(input)

  return apiSuccess({
    score: result.score,
    verdict: result.verdict,
    rules: result.rules,
    source: content.source,
    scannedAt: result.scannedAt,
  })
}

export const POST = withAuth('client', handle)
export const GET = withAuth('client', handle)
