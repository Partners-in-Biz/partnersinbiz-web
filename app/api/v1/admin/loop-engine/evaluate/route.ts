import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { adminDb } from '@/lib/firebase/admin'
import { evaluateLoopRun } from '@/lib/loop-engine/executor'
import type { LoopRunCandidate, LoopRunTrigger } from '@/lib/loop-engine/runs'

export const dynamic = 'force-dynamic'

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function cleanBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function cleanCandidates(value: unknown): LoopRunCandidate[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate): LoopRunCandidate[] => {
    if (!candidate || typeof candidate !== 'object') return []
    const source = candidate as Record<string, unknown>
    const id = cleanString(source.id)
    const title = cleanString(source.title)
    const type = cleanString(source.type)
    if (!id || !title || !type || !['task', 'lead', 'seo-signal', 'review-item', 'manual'].includes(type)) return []
    return [{
      id,
      title,
      type: type as LoopRunCandidate['type'],
      orgId: cleanString(source.orgId),
      projectId: cleanString(source.projectId),
      taskId: cleanString(source.taskId),
      riskLevel: cleanString(source.riskLevel),
      requiredCapability: cleanString(source.requiredCapability),
      approvalGateTaskId: cleanString(source.approvalGateTaskId),
      approvalGateStatus: cleanString(source.approvalGateStatus),
      task: source.task && typeof source.task === 'object' && !Array.isArray(source.task) ? source.task as Record<string, unknown> : null,
      context: source.context && typeof source.context === 'object' && !Array.isArray(source.context) ? source.context as Record<string, unknown> : undefined,
    }]
  })
}

function cleanTrigger(value: unknown): LoopRunTrigger | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const kind = cleanString(source.kind)
  if (!kind) return undefined
  return {
    kind: kind as LoopRunTrigger['kind'],
    ref: cleanString(source.ref),
    source: cleanString(source.source),
  }
}

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const orgId = cleanString(body.orgId) ?? req.headers.get('x-org-id')
  const loopId = cleanString(body.loopId)
  if (!orgId) return apiError('orgId is required', 400)
  if (!loopId) return apiError('loopId is required', 400)
  if (!canAccessOrg(user, orgId)) return apiError(`You do not have access to orgId ${orgId}`, 403)

  const dryRun = cleanBool(body.dryRun, true)
  const persist = cleanBool(body.persist, false)
  const run = evaluateLoopRun({
    loopId,
    orgId,
    candidates: cleanCandidates(body.candidates),
    trigger: cleanTrigger(body.trigger),
    dryRun,
    createdBy: user.agentId ?? user.uid,
    createdByType: user.role === 'ai' ? 'agent' : 'user',
    idempotencyKey: cleanString(body.idempotencyKey) ?? undefined,
  })

  if (persist) {
    await adminDb.collection('loop_engine_runs').doc(run.id).set({
      ...run,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  }

  return apiSuccess({ run, persisted: persist })
})
