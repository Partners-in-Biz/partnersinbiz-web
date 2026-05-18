// lib/pipelines/migration.ts
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import { bootstrapDefaultPipeline } from './store'

export const legacyStageToStageId: Record<string, string> = {
  discovery: 'discovery',
  proposal: 'proposal',
  negotiation: 'negotiation',
  won: 'won',
  lost: 'lost',
}

export interface MigrationResult {
  orgId: string
  pipelineCreated: boolean
  pipelineId: string
  dealsUpdated: number
  errors: string[]
}

export async function migrateOrgToDefaultPipeline(
  orgId: string,
  actor: MemberRef,
  opts: { dryRun: boolean }
): Promise<MigrationResult> {
  const result: MigrationResult = { orgId, pipelineCreated: false, pipelineId: '', dealsUpdated: 0, errors: [] }
  try {
    // Idempotency: skip if any non-deleted pipeline exists
    const existing = await adminDb.collection('pipelines')
      .where('orgId', '==', orgId)
      .where('deleted', '!=', true)
      .orderBy('deleted')
      .limit(1)
      .get()

    let pipelineId: string
    if (!existing.empty) {
      pipelineId = existing.docs[0].id
    } else if (opts.dryRun) {
      pipelineId = '<DRYRUN_NEW_PIPELINE>'
      result.pipelineCreated = true
    } else {
      const p = await bootstrapDefaultPipeline(orgId, actor)
      pipelineId = p.id
      result.pipelineCreated = true
    }
    result.pipelineId = pipelineId

    // Find all deals with legacy `stage` field present + no pipelineId yet
    const dealsSnap = await adminDb.collection('deals')
      .where('orgId', '==', orgId)
      .limit(5000)
      .get()

    const toMigrate = dealsSnap.docs.filter(d => {
      const data = d.data() as Record<string, unknown>
      return typeof data.stage === 'string' && !data.pipelineId
    })

    if (toMigrate.length === 0) return result

    // Batch 30/chunk
    for (let i = 0; i < toMigrate.length; i += 30) {
      const chunk = toMigrate.slice(i, i + 30)
      if (opts.dryRun) {
        result.dealsUpdated += chunk.length
        continue
      }
      const batch = adminDb.batch()
      for (const doc of chunk) {
        const data = doc.data() as { stage?: string }
        const stageId = legacyStageToStageId[data.stage ?? 'discovery'] ?? 'discovery'
        batch.update(doc.ref, {
          pipelineId,
          stageId,
          stage: FieldValue.delete(),
          updatedAt: Timestamp.now(),
        })
      }
      await batch.commit()
      result.dealsUpdated += chunk.length
    }

    return result
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : String(e))
    return result
  }
}
