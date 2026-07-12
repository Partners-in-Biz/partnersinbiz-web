import type { EmailEventType } from './types'

interface ReconciliationEvent {
  id: string
  orgId: string
  messageId: string
  event: EmailEventType
  uniqueEventKey: string
}

const TOTAL_FIELD: Partial<Record<EmailEventType, string>> = {
  attempted: 'attempted', sent: 'sent', delivered: 'delivered', deferred: 'deferred',
  failed: 'failed', opened: 'opened', machine_opened: 'machineOpened', clicked: 'clicked',
  replied: 'replied', positive_reply: 'positiveReply', bounced: 'bounced',
  complained: 'complained', unsubscribed: 'unsubscribed', converted: 'converted',
}
const UNIQUE_FIELD: Partial<Record<EmailEventType, string>> = {
  opened: 'uniqueOpened', machine_opened: 'uniqueMachineOpened', clicked: 'uniqueClicked',
  replied: 'uniqueReplied', converted: 'uniqueConverted',
}

export function buildReconciliationReport(input: {
  orgId: string
  events: ReconciliationEvent[]
  stored: Record<string, number | undefined>
}) {
  const rebuilt: Record<string, number> = {}
  const seenIds = new Set<string>()
  const seenUnique = new Set<string>()
  for (const event of input.events) {
    if (event.orgId !== input.orgId || seenIds.has(event.id)) continue
    seenIds.add(event.id)
    const totalField = TOTAL_FIELD[event.event]
    if (totalField) rebuilt[totalField] = (rebuilt[totalField] ?? 0) + 1
    const uniqueField = UNIQUE_FIELD[event.event]
    const uniqueKey = `${uniqueField}:${event.uniqueEventKey}`
    if (uniqueField && !seenUnique.has(uniqueKey)) {
      seenUnique.add(uniqueKey)
      rebuilt[uniqueField] = (rebuilt[uniqueField] ?? 0) + 1
    }
  }
  const drift = Object.fromEntries(
    Object.keys({ ...input.stored, ...rebuilt }).map((key) => [key, (rebuilt[key] ?? 0) - (input.stored[key] ?? 0)]),
  )
  return { rebuilt, drift, hasDrift: Object.values(drift).some((value) => value !== 0) }
}
