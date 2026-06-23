import { getSequence } from '@/lib/sequences/store'
import { adminDb } from '@/lib/firebase/admin'
import type { AutomationAction, ActionType } from './types'

const VALID_ACTION_TYPES: ReadonlySet<ActionType> = new Set<ActionType>([
  'send_email',
  'send_notification',
  'assign_owner',
  'dispatch_webhook',
  'enroll_in_sequence',
  'add_tag',
  'assign_to_segment',
])

export async function validateAutomationActionsForSave(
  orgId: string,
  actions: AutomationAction[],
): Promise<string | null> {
  for (const [index, action] of actions.entries()) {
    const field = `actions[${index}]`

    if (!action.type || !VALID_ACTION_TYPES.has(action.type)) {
      return `${field}.type is not a supported action type`
    }

    if (
      action.delayMinutes !== undefined &&
      (typeof action.delayMinutes !== 'number' ||
        !Number.isFinite(action.delayMinutes) ||
        action.delayMinutes < 0)
    ) {
      return `${field}.delayMinutes must be a non-negative number`
    }

    if (action.type === 'enroll_in_sequence') {
      const sequenceId = action.sequenceId?.trim()
      if (!sequenceId) {
        return `${field}.sequenceId is required for sequence enrollment`
      }
      const sequence = await getSequence(orgId, sequenceId)
      if (!sequence) {
        return `${field}.sequenceId was not found`
      }
      if (sequence.status !== 'active') {
        return `${field}.sequenceId must reference an active sequence`
      }
    }

    if (action.type === 'add_tag') {
      if (!action.tag?.trim()) {
        return `${field}.tag is required for add tag`
      }
    }

    if (action.type === 'assign_to_segment') {
      const segmentId = action.segmentId?.trim()
      if (!segmentId) {
        return `${field}.segmentId is required for assign to segment`
      }
      const segSnap = await adminDb.collection('segments').doc(segmentId).get()
      if (!segSnap.exists || segSnap.data()?.orgId !== orgId || segSnap.data()?.deleted === true) {
        return `${field}.segmentId was not found`
      }
    }
  }

  return null
}
