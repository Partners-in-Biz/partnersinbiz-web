import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiError, apiSuccess } from '@/lib/api/response'
import { runEmailPreflight, type EmailPreflightResult, type PreflightIssue } from '@/lib/email-marketing/preflight'
import { getSenderPolicy } from '@/lib/email-marketing/sender-store'
import { sanitizeAudienceDefinition } from '@/lib/email-marketing/audience-snapshot'
import { estimateAudienceDefinition } from '@/lib/email-marketing/audience-resolver'
import type { EmailDocument } from '@/lib/email-builder/types'

export const dynamic = 'force-dynamic'

function appendIssues(result: EmailPreflightResult, issues: PreflightIssue[]): EmailPreflightResult {
  const all = [...result.issues, ...issues]
  const errors = all.filter((issue) => issue.severity === 'error').length
  const warnings = all.filter((issue) => issue.severity === 'warning').length
  return { blocking: errors > 0, score: Math.max(0, 100 - errors * 20 - warnings * 5), issues: all }
}

/** Server-side readiness gate used before approval, scheduling, and sending. */
export const POST = withAuth('client', withTenant(async (req: NextRequest, _user, orgId) => {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return apiError('Invalid JSON body', 400)
  const document = body.document as EmailDocument | undefined
  if (!document || !Array.isArray(document.blocks) || typeof document.subject !== 'string') {
    return apiError('A valid email document is required', 400)
  }

  const renderedHtmlBytes = Math.max(0, Number(body.renderedHtmlBytes ?? 0) || 0)
  let result = runEmailPreflight(document, { renderedHtmlBytes })
  const runtimeIssues: PreflightIssue[] = []

  const senderPolicyId = typeof body.senderPolicyId === 'string' ? body.senderPolicyId.trim() : ''
  if (senderPolicyId) {
    const policy = await getSenderPolicy(orgId, senderPolicyId)
    if (!policy?.enabled) {
      runtimeIssues.push({
        code: 'sender_policy_unavailable',
        severity: 'error',
        message: 'The selected sender policy is unavailable or disabled.',
      })
    }
  } else {
    runtimeIssues.push({
      code: 'sender_policy_missing',
      severity: 'warning',
      message: 'Select a verified sender policy before scheduling.',
    })
  }

  const createdByType = body.createdByType === 'agent' ? 'agent' : 'user'
  const approvalState = typeof body.approvalState === 'string' ? body.approvalState : ''
  if (createdByType === 'agent' && approvalState !== 'approved') {
    runtimeIssues.push({
      code: 'human_approval_required',
      severity: 'error',
      message: 'Agent-created email programs require recorded human approval.',
    })
  }

  let audience = null
  if (body.audienceDefinition != null) {
    try {
      const definition = sanitizeAudienceDefinition(body.audienceDefinition)
      audience = await estimateAudienceDefinition(orgId, definition, {
        holdoutSeed: typeof body.programId === 'string' ? body.programId : `org:${orgId}`,
      })
      if (audience.eligibleCount === 0) {
        runtimeIssues.push({ code: 'audience_empty', severity: 'error', message: 'No recipients are currently eligible to receive this email.' })
      }
    } catch (error) {
      runtimeIssues.push({
        code: 'audience_invalid',
        severity: 'error',
        message: error instanceof Error ? error.message : 'The audience definition is invalid.',
      })
    }
  } else {
    runtimeIssues.push({ code: 'audience_missing', severity: 'warning', message: 'Estimate and freeze an audience before scheduling.' })
  }

  result = appendIssues(result, runtimeIssues)
  return apiSuccess({ orgId, readiness: result, audience })
}))
