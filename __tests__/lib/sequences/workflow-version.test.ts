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

    const runtime = runtimeSequenceForEnrollment(edited, { workflowVersionId: version.id, workflowSnapshot: version })

    expect(runtime.steps[0].subject).toBe('Hello')
    expect(runtime.workflowVersionId).toBe(version.id)
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
