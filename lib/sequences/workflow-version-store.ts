import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { Sequence } from './types'
import { buildActivationVersion } from './workflow-version'

/**
 * Persists an activation pointer and its archive record in one Firestore
 * batch. Archive records are created (never merged), so a workflow version
 * cannot be silently overwritten.
 */
export async function persistSequenceUpdateWithVersion(args: {
  sequenceId: string
  existing: Sequence
  patch: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  const sequenceRef = adminDb.collection('sequences').doc(args.sequenceId)
  const activating = args.patch.status === 'active' && args.existing.status !== 'active'
  if (!activating) {
    await sequenceRef.update(args.patch)
    return args.patch
  }

  const snapshot = buildActivationVersion(
    { ...args.existing, id: args.sequenceId },
    args.patch as Partial<Sequence>,
    new Date().toISOString(),
  )
  const persistedPatch = {
    ...args.patch,
    activeWorkflowVersion: snapshot.version,
    activeWorkflowVersionId: snapshot.id,
    activeWorkflowSnapshot: snapshot,
  }
  const versionRef = adminDb.collection('sequence_workflow_versions').doc(snapshot.id)
  const batch = adminDb.batch()
  batch.create(versionRef, {
    ...snapshot,
    activatedAt: FieldValue.serverTimestamp(),
  })
  batch.update(sequenceRef, persistedPatch)
  await batch.commit()
  return persistedPatch
}
