import { getSequence } from '@/lib/sequences/store'
import type { AutomationAction } from './types'

export async function validateAutomationActionsForSave(
  orgId: string,
  actions: AutomationAction[],
): Promise<string | null> {
  for (const [index, action] of actions.entries()) {
    if (action.type !== 'enroll_in_sequence') continue

    const sequenceId = action.sequenceId?.trim()
    const field = `actions[${index}].sequenceId`
    if (!sequenceId) {
      return `${field} is required for sequence enrollment`
    }

    const sequence = await getSequence(orgId, sequenceId)
    if (!sequence) {
      return `${field} was not found`
    }

    if (sequence.status !== 'active') {
      return `${field} must reference an active sequence`
    }
  }

  return null
}
