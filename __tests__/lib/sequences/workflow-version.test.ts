import { buildActivationVersion, buildWorkflowVersion, runtimeSequenceForEnrollment } from '@/lib/sequences/workflow-version'
import type { Sequence } from '@/lib/sequences/types'

const sequence = {
  id: 'seq-1',
  orgId: 'org-1',
  name: 'Welcome',
  description: '',
  status: 'draft',
  steps: [{ stepNumber: 0, delayDays: 0, subject: 'Hello', bodyHtml: '<p>Hello</p>', bodyText: 'Hello' }],
  topicId: 'newsletter',
  goals: [],
  createdAt: null,
  updatedAt: null,
} satisfies Sequence

describe('sequence workflow versions', () => {
  it('creates a stable content hash independent of object key insertion order', () => {
    const first = buildWorkflowVersion(sequence, { activatedAtIso: '2026-07-13T08:00:00.000Z', version: 1 })
    const reordered = buildWorkflowVersion({ ...sequence, steps: sequence.steps.map((step) => ({ bodyText: step.bodyText, subject: step.subject, stepNumber: step.stepNumber, bodyHtml: step.bodyHtml, delayDays: step.delayDays })) }, { activatedAtIso: '2026-07-13T09:00:00.000Z', version: 1 })

    expect(first.contentHash).toBe(reordered.contentHash)
    expect(first.id).toBe(reordered.id)
  })

  it('pins runtime execution to the enrollment snapshot after the editable sequence changes', () => {
    const version = buildWorkflowVersion(sequence, { activatedAtIso: '2026-07-13T08:00:00.000Z', version: 2 })
    const edited = { ...sequence, steps: [{ ...sequence.steps[0], subject: 'Changed later' }] }

    const runtime = runtimeSequenceForEnrollment(edited, {
      workflowVersionId: version.id,
      workflowVersion: version.version,
      workflowContentHash: version.contentHash,
      workflowSnapshot: version,
    })

    expect(runtime.steps[0].subject).toBe('Hello')
    expect(runtime.workflowVersionId).toBe(version.id)
  })

  it('uses the editable sequence only for a truly legacy unpinned enrollment', () => {
    expect(runtimeSequenceForEnrollment(sequence, {})).toBe(sequence)
  })

  it.each([
    ['missing snapshot', { workflowVersionId: 'claimed' }],
    ['mismatched id', { workflowVersionId: 'wrong', workflowVersion: 1, workflowContentHash: 'hash', workflowSnapshot: buildWorkflowVersion(sequence, { activatedAtIso: '2026-07-13T08:00:00.000Z', version: 1 }) }],
    ['mismatched organisation', (() => { const snapshot = buildWorkflowVersion(sequence, { activatedAtIso: '2026-07-13T08:00:00.000Z', version: 1 }); return { workflowVersionId: snapshot.id, workflowVersion: 1, workflowContentHash: snapshot.contentHash, workflowSnapshot: { ...snapshot, orgId: 'org-other' } } })()],
    ['mismatched sequence', (() => { const snapshot = buildWorkflowVersion(sequence, { activatedAtIso: '2026-07-13T08:00:00.000Z', version: 1 }); return { workflowVersionId: snapshot.id, workflowVersion: 1, workflowContentHash: snapshot.contentHash, workflowSnapshot: { ...snapshot, sequenceId: 'seq-other' } } })()],
    ['mismatched enrollment hash', (() => { const snapshot = buildWorkflowVersion(sequence, { activatedAtIso: '2026-07-13T08:00:00.000Z', version: 1 }); return { workflowVersionId: snapshot.id, workflowVersion: 1, workflowContentHash: 'tampered', workflowSnapshot: snapshot } })()],
    ['tampered snapshot content', (() => { const snapshot = buildWorkflowVersion(sequence, { activatedAtIso: '2026-07-13T08:00:00.000Z', version: 1 }); return { workflowVersionId: snapshot.id, workflowVersion: 1, workflowContentHash: snapshot.contentHash, workflowSnapshot: { ...snapshot, steps: [{ ...snapshot.steps[0], subject: 'Tampered' }] } } })()],
  ])('fails closed for a claimed workflow pin with %s', (_label, enrollment) => {
    expect(() => runtimeSequenceForEnrollment(sequence, enrollment)).toThrow(/workflow pin/i)
  })

  it('preserves approval evidence from v1 after the editable sequence advances to v2', () => {
    const approvalState = { status: 'approved' as const, approvedBy: 'human-1', approvedByType: 'user' as const, approvalTaskId: 'task-v1', approvedSnapshotHash: 'approval-v1' }
    const v1 = buildWorkflowVersion({ ...sequence, approvalState }, { activatedAtIso: '2026-07-13T08:00:00.000Z', version: 1 })
    const runtime = runtimeSequenceForEnrollment(
      { ...sequence, steps: [{ ...sequence.steps[0], subject: 'V2' }], approvalState: { ...approvalState, approvalTaskId: 'task-v2', approvedSnapshotHash: 'approval-v2' } },
      { workflowVersionId: v1.id, workflowVersion: 1, workflowContentHash: v1.contentHash, workflowSnapshot: v1 },
    )

    expect(runtime.approvalState?.approvalTaskId).toBe('task-v1')
    expect(runtime.steps[0].subject).toBe('Hello')
  })

  it('increments the immutable version and freezes the merged activation payload', () => {
    const activation = buildActivationVersion(
      { ...sequence, activeWorkflowVersion: 3 },
      { status: 'active', steps: [{ ...sequence.steps[0], subject: 'Approved subject' }] },
      '2026-07-13T10:00:00.000Z',
    )

    expect(activation.version).toBe(4)
    expect(activation.steps[0].subject).toBe('Approved subject')
    expect(activation.activatedAtIso).toBe('2026-07-13T10:00:00.000Z')
  })
})
