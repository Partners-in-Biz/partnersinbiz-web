/**
 * GET  /api/v1/crm/sequences/:id/enrollments — list enrollments for sequence (member+)
 * POST /api/v1/crm/sequences/:id/enrollments — enroll a contact (member+)
 */
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { listEnrollments, enrollContact, SequenceEnrollmentError } from '@/lib/sequences/enrollment'
import { getSequence } from '@/lib/sequences/store'
import { assertEmailMarketingAgentActionWithTask } from '@/lib/email-marketing/agent-governance'
import {
  type AssignableCrmRecord,
  crmActorCanReadRecord,
  filterCrmRowsForActor,
  isCrmPrivilegedActor,
  loadCompanyAssignmentMap,
  loadContactAssignmentMap,
  crmRecordCompanyIds,
} from '@/lib/crm/assignment-access'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

async function loadContactForScope(orgId: string, contactId: string): Promise<AssignableCrmRecord | null> {
  const snap = await adminDb.collection('contacts').doc(contactId).get()
  if (!snap.exists) return null
  const data = snap.data() as AssignableCrmRecord
  if (data.orgId !== orgId || data.deleted === true) return null
  return { id: snap.id, ...data }
}

// ── GET ─────────────────────────────────────────────────────────────────────────

export const GET = withCrmAuth<RouteCtx>('member', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params

  try {
    let enrollments = await listEnrollments(ctx.orgId, { sequenceId: id })
    if (!isCrmPrivilegedActor(ctx)) {
      const contactIds = enrollments
        .map((row) => (typeof row.contactId === 'string' ? row.contactId : ''))
        .filter(Boolean)
      const contacts = await loadContactAssignmentMap(ctx.orgId, contactIds)
      const companyIds = new Set<string>()
      for (const contact of contacts.values()) {
        for (const companyId of crmRecordCompanyIds(contact)) companyIds.add(companyId)
      }
      const companies = await loadCompanyAssignmentMap(ctx.orgId, companyIds)
      const visibleContactIds = new Set(
        filterCrmRowsForActor(ctx, Array.from(contacts.values()), { companies }).map((row) => row.id).filter(Boolean),
      )
      enrollments = enrollments.filter((row) => visibleContactIds.has(row.contactId))
    }
    return apiSuccess({ enrollments })
  } catch (err) {
    console.error('[sequence-enrollments-list-error]', err)
    return apiError('Internal Server Error', 500)
  }
})

// ── POST ────────────────────────────────────────────────────────────────────────

export const POST = withCrmAuth<RouteCtx>('member', async (req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON', 400)
  }

  if (!body.contactId || typeof body.contactId !== 'string' || !body.contactId.trim()) {
    return apiError('contactId is required', 400)
  }

  try {
    const sequence = await getSequence(ctx.orgId, id)
    if (!sequence) return apiError('Not found', 404)
    if (sequence.status !== 'active') {
      return apiError('Sequence must be active before enrollment', 400)
    }

    const contactId = (body.contactId as string).trim()
    const contact = await loadContactForScope(ctx.orgId, contactId)
    if (!contact) return apiError('Contact not found', 404)
    if (!isCrmPrivilegedActor(ctx)) {
      const companies = await loadCompanyAssignmentMap(ctx.orgId, crmRecordCompanyIds(contact))
      if (!crmActorCanReadRecord(ctx, contact, { companies })) return apiError('Contact not found', 404)
    }

    if (ctx.user) {
      try {
        await assertEmailMarketingAgentActionWithTask(
          { uid: ctx.user.uid, role: 'ai', authKind: ctx.user.authKind, agentId: ctx.user.agentId },
          'email_marketing_send', sequence.approvalState,
          { orgId: ctx.orgId, resourceType: 'email_sequence', resourceId: id },
        )
      } catch (error) {
        return apiError(error instanceof Error ? error.message : 'Sequence enrollment is not authorised', 403)
      }
    }

    const firstStepDelayDays = sequence.steps[0]?.delayDays ?? 0

    const enrollmentArgs = [
      ctx.orgId,
      id,
      contactId,
      ctx.actor,
      firstStepDelayDays,
    ] as const
    const enrollment = sequence.reentryPolicy || sequence.maxActiveEnrollments
      ? await enrollContact(...enrollmentArgs, {
        reentryPolicy: sequence.reentryPolicy,
        maxActiveEnrollments: sequence.maxActiveEnrollments,
      })
      : await enrollContact(...enrollmentArgs)
    return apiSuccess({ enrollment }, 201)
  } catch (err) {
    if (err instanceof SequenceEnrollmentError) return apiError(err.message, err.status)
    console.error('[sequence-enrollments-create-error]', err)
    return apiError('Internal Server Error', 500)
  }
})
