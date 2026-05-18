import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { assertStagesValid, clearOtherDefaults } from '@/lib/pipelines/store'
import { PipelineValidationError } from '@/lib/pipelines/types'
import type { Pipeline } from '@/lib/pipelines/types'
import { getCrmSetupState, saveCrmSetupState } from '@/lib/crm/setup/store'
import { getPipelineStarterTemplate } from '@/lib/crm/setup/templates'

export const POST = withCrmAuth('admin', async (req, ctx) => {
  let body: { templateId?: string; makeDefault?: boolean }
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON', 400)
  }

  const template = body.templateId ? getPipelineStarterTemplate(body.templateId) : null
  if (!template) return apiError('Unknown pipeline template', 404)

  try {
    assertStagesValid(template.stages)
  } catch (err) {
    if (err instanceof PipelineValidationError) {
      return apiError('Template stage validation failed', 400, { details: err.details })
    }
    throw err
  }

  const duplicateSnap = await adminDb
    .collection('pipelines')
    .where('orgId', '==', ctx.orgId)
    .where('name', '==', template.name)
    .where('deleted', '!=', true)
    .limit(1)
    .get()

  if (!duplicateSnap.empty) {
    const doc = duplicateSnap.docs[0]
    const existing = { ...(doc.data() as Pipeline), id: doc.id }
    return apiSuccess({ pipeline: existing, applied: false, reason: 'already_exists' })
  }

  const now = Timestamp.now()
  const isDefault = body.makeDefault === true
  const pipelineData: Omit<Pipeline, 'id'> = {
    orgId: ctx.orgId,
    name: template.name,
    description: template.description,
    stages: template.stages,
    isDefault,
    archived: false,
    deleted: false,
    createdBy: ctx.isAgent ? undefined : ctx.actor.uid,
    createdByRef: ctx.actor,
    updatedBy: ctx.isAgent ? undefined : ctx.actor.uid,
    updatedByRef: ctx.actor,
    createdAt: now,
    updatedAt: now,
  }

  const toWrite = Object.fromEntries(Object.entries(pipelineData).filter(([, value]) => value !== undefined))
  const ref = adminDb.collection('pipelines').doc()
  await ref.set(toWrite)

  if (isDefault) {
    try {
      await clearOtherDefaults(ctx.orgId, ref.id)
    } catch {
      // Non-fatal; the created pipeline still exists.
    }
  }

  const setup = await getCrmSetupState(ctx.orgId)
  const appliedPipelineTemplateIds = Array.from(
    new Set([...setup.appliedPipelineTemplateIds, template.id]),
  )
  await saveCrmSetupState(ctx.orgId, { appliedPipelineTemplateIds }, ctx.actor)

  return apiSuccess({ pipeline: { ...(toWrite as Omit<Pipeline, 'id'>), id: ref.id }, applied: true }, 201)
})
