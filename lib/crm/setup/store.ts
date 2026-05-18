import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import type { CrmSetupAnswers, CrmSetupState } from './types'

const COLLECTION = 'crmSetup'

export const DEFAULT_CRM_SETUP_ANSWERS: CrmSetupAnswers = {
  salesProcess: 'new_sales',
  importStatus: 'not_started',
  gmailIntent: 'connect_later',
  pipelinePreference: 'simple_sales',
  selectedTemplateIds: ['pipeline-simple-sales', 'sequence-new-lead', 'segment-hot-leads'],
}

export function normalizeCrmSetupAnswers(input: Partial<CrmSetupAnswers>): CrmSetupAnswers {
  return {
    salesProcess: input.salesProcess ?? DEFAULT_CRM_SETUP_ANSWERS.salesProcess,
    importStatus: input.importStatus ?? DEFAULT_CRM_SETUP_ANSWERS.importStatus,
    gmailIntent: input.gmailIntent ?? DEFAULT_CRM_SETUP_ANSWERS.gmailIntent,
    pipelinePreference: input.pipelinePreference ?? DEFAULT_CRM_SETUP_ANSWERS.pipelinePreference,
    selectedTemplateIds: Array.isArray(input.selectedTemplateIds)
      ? Array.from(new Set(input.selectedTemplateIds.filter((id): id is string => typeof id === 'string' && id.length > 0)))
      : DEFAULT_CRM_SETUP_ANSWERS.selectedTemplateIds,
    ...(typeof input.notes === 'string' && input.notes.trim() ? { notes: input.notes.trim().slice(0, 1000) } : {}),
  }
}

export async function getCrmSetupState(orgId: string): Promise<CrmSetupState> {
  const ref = adminDb.collection(COLLECTION).doc(orgId)
  const snap = await ref.get()
  if (!snap.exists) {
    return {
      id: orgId,
      orgId,
      ...DEFAULT_CRM_SETUP_ANSWERS,
      appliedPipelineTemplateIds: [],
      createdAt: null,
      updatedAt: null,
    }
  }

  const data = snap.data() as Partial<CrmSetupState>
  return {
    id: orgId,
    orgId,
    ...DEFAULT_CRM_SETUP_ANSWERS,
    ...data,
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
    selectedTemplateIds: Array.isArray(data.selectedTemplateIds) ? data.selectedTemplateIds : DEFAULT_CRM_SETUP_ANSWERS.selectedTemplateIds,
    appliedPipelineTemplateIds: Array.isArray(data.appliedPipelineTemplateIds) ? data.appliedPipelineTemplateIds : [],
  }
}

export async function saveCrmSetupState(
  orgId: string,
  input: Partial<CrmSetupAnswers> & { appliedPipelineTemplateIds?: string[] },
  actor: MemberRef,
): Promise<CrmSetupState> {
  const existing = await getCrmSetupState(orgId)
  const answers = normalizeCrmSetupAnswers({ ...existing, ...input })
  const now = Timestamp.now()
  const appliedPipelineTemplateIds = Array.isArray(input.appliedPipelineTemplateIds)
    ? input.appliedPipelineTemplateIds
    : existing.appliedPipelineTemplateIds

  const data: Omit<CrmSetupState, 'id'> = {
    orgId,
    ...answers,
    appliedPipelineTemplateIds,
    createdAt: existing.createdAt ?? now,
    updatedAt: now,
    updatedBy: actor.uid,
    updatedByRef: actor,
  }

  await adminDb.collection(COLLECTION).doc(orgId).set(data, { merge: true })
  return { id: orgId, ...data }
}
