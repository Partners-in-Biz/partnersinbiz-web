// lib/automations/trigger.ts
import { getMatchingRules, queuePendingAutomation } from './store'
import { executeActions } from './executor'
import type { TriggerEvent, TriggerContext } from './types'

export async function fireTrigger(
  event: TriggerEvent,
  context: TriggerContext,
): Promise<void> {
  try {
    const rules = await getMatchingRules(context.orgId, event, context)

    for (const rule of rules) {
      if (!rule.delayMinutes || rule.delayMinutes === 0) {
        await executeActions(rule.actions, context)
      } else {
        await queuePendingAutomation(context.orgId, rule, context)
      }
    }
  } catch (err) {
    console.error('[fireTrigger] Uncaught error:', err)
    // Never throw to caller
  }
}
