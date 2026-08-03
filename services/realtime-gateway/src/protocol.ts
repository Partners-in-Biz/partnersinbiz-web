export const REALTIME_PROTOCOL_VERSION = 1 as const

export type GatewayDelivery = {
  schemaVersion: typeof REALTIME_PROTOCOL_VERSION
  eventId: string
  recipientUserIds: string[]
}

export type PubSubPushEnvelope = {
  message?: {
    data?: string
  }
}

export function parseGatewayDelivery(value: unknown): GatewayDelivery | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.schemaVersion !== REALTIME_PROTOCOL_VERSION) return null
  const eventId = typeof raw.eventId === 'string' ? raw.eventId.trim() : ''
  if (!eventId || eventId.length > 512) return null
  if (!Array.isArray(raw.recipientUserIds) || raw.recipientUserIds.length > 500) return null
  const recipientUserIds = Array.from(new Set(raw.recipientUserIds.filter(
    (uid): uid is string => typeof uid === 'string' && uid.trim().length > 0 && uid.length <= 256,
  ))).sort()
  return { schemaVersion: REALTIME_PROTOCOL_VERSION, eventId, recipientUserIds }
}

export function parsePubSubPush(body: unknown): GatewayDelivery | null {
  if (!body || typeof body !== 'object') return null
  const encoded = (body as PubSubPushEnvelope).message?.data
  if (typeof encoded !== 'string' || !encoded) return null
  try {
    return parseGatewayDelivery(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')))
  } catch {
    return null
  }
}
